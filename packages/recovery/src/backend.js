import { spawn } from 'node:child_process';
import path from 'node:path';
import { RECOVERY_VERSION } from './contract.js';
import { requireToken } from './credentials.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function managedBackend(home, config, backendToken) {
  requireToken(backendToken, 'HYPIR_TOKEN');
  let child;
  let exited;
  let state = 'stopped';
  let failure = config.previousFailure ?? null;
  let operation;
  let closing = false;
  const snapshot = () => ({
    recoveryVersion: RECOVERY_VERSION,
    state,
    baselineRevision: config.baselineRevision,
    pid: child?.pid ?? null,
    failure,
  });
  async function healthy() {
    const target = child;
    if (!target) return false;
    try {
      const host =
        config.backendHost === '0.0.0.0'
          ? '127.0.0.1'
          : config.backendHost === '::'
            ? '[::1]'
            : config.backendHost.includes(':')
              ? `[${config.backendHost}]`
              : config.backendHost;
      const res = await fetch(`http://${host}:${config.backendPort}/api/status`, {
        headers: { authorization: `Bearer ${backendToken}` },
        redirect: 'error',
        signal: AbortSignal.timeout(750),
      });
      await res.body?.cancel();
      // The runner signals only after its listener binds. Probe liveness without
      // coupling recovery to the normal daemon's versioned JSON status envelope.
      return (
        res.status === 200 &&
        child === target &&
        target.exitCode === null &&
        target.signalCode === null
      );
    } catch {
      return false;
    }
  }
  async function stop() {
    if (!child) {
      state = 'stopped';
      return;
    }
    state = 'stopping';
    const target = child;
    target.kill('SIGTERM');
    await Promise.race([exited, delay(2000)]);
    if (child === target) {
      target.kill('SIGKILL');
      await Promise.race([exited, delay(2000)]);
    }
    if (child === target) {
      state = 'failed';
      failure = 'stop-failed';
      throw new Error('stop-failed');
    }
    state = 'stopped';
  }
  async function start() {
    if (state === 'running' && (await healthy())) return;
    if (child) await stop();
    state = 'starting';
    const target = spawn(
      path.join(home, 'runtime/node'),
      [
        path.join(home, 'base/runner.js'),
        path.join(home, 'baseline'),
        config.project,
        config.backendHost,
        String(config.backendPort),
      ],
      {
        cwd: config.project,
        // Only the backend credential crosses this boundary. Recovery/provider
        // credentials, NODE_OPTIONS and source-based loaders are not inherited.
        env: {
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          PREFIX: process.env.PREFIX,
          PATH: process.env.PATH,
          LD_LIBRARY_PATH: path.join(home, 'runtime/lib'),
          HYPIR_TOKEN: backendToken,
        },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    );
    child = target;
    let ready = false;
    target.on('message', (message) => {
      if (message?.ready === true) ready = true;
    });
    exited = new Promise((resolve) => {
      const finish = () => {
        if (child === target) {
          child = undefined;
          if (state !== 'stopping') {
            failure = state === 'starting' ? 'startup-failed' : 'backend-exited';
            state = 'failed';
          }
        }
        resolve();
      };
      target.once('error', finish);
      target.once('exit', finish);
    });
    const deadline = Date.now() + 7000;
    while (child === target && Date.now() < deadline) {
      if (ready && (await healthy())) {
        state = 'running';
        return;
      }
      await delay(40);
    }
    const reason = failure === 'startup-failed' ? failure : 'readiness-timeout';
    if (child) await stop();
    failure = reason;
    state = 'failed';
  }
  async function action(name) {
    if (closing) throw new Error('Recovery is closing');
    if (operation) {
      if (operation.name === name || (operation.name !== 'stop' && name !== 'stop'))
        return operation.promise;
      throw new Error('Another lifecycle action is in progress');
    }
    const promise = (async () => {
      if (name === 'stop') await stop();
      else await start();
      return snapshot();
    })();
    operation = { name, promise };
    try {
      return await promise;
    } finally {
      operation = undefined;
    }
  }
  async function status() {
    if (!operation && state === 'running' && !(await healthy())) {
      // A listener that hangs is not a healthy backend. A recover request can
      // terminate it, but observing status never starts a replacement process.
      if (state === 'running') {
        state = 'failed';
        failure = 'backend-unavailable';
      }
    }
    return snapshot();
  }
  async function close() {
    closing = true;
    await operation?.promise.catch(() => {});
    await stop();
  }
  return { action, status, close };
}
