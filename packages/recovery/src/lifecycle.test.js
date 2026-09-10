import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const cli = path.join(repo, 'packages/recovery/src/cli.js');
const token = 'recovery-test-credential';
const backendToken = 'backend-test-credential';
const xml = '<doc xmlns="https://hyperview.org/hyperview"><screen><body /></screen></doc>';
async function port() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
function run(args, { executable = process.execPath, prefix = [cli], env = {} } = {}) {
  const child = spawn(executable, [...prefix, ...args], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      HYPIR_RECOVERY_TOKEN: token,
      HYPIR_TOKEN: backendToken,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const exited = once(child, 'exit');
  return { child, exited, output: () => output };
}
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hypir-recovery-'));
  const source = path.join(root, 'source');
  const home = path.join(root, 'recovery');
  const project = path.join(root, 'project');
  await mkdir(source);
  for (const name of ['daemon', 'protocol']) {
    await cp(path.join(repo, 'packages', name), path.join(source, 'packages', name), {
      recursive: true,
    });
  }
  await mkdir(path.join(project, 'screens'), { recursive: true });
  await writeFile(
    path.join(project, 'hyperview.json'),
    JSON.stringify({ name: 'Recovery fixture', screens: 'screens', entrypoint: '/index.xml' }),
  );
  await writeFile(path.join(project, 'screens/index.xml'), xml);
  await writeFile(path.join(project, 'private-session'), 'retain-session');
  const backendPort = await port();
  const recoveryPort = await port();
  const children = [];
  t.after(async () => {
    for (const process of children.reverse()) {
      if (process.child.exitCode === null && process.child.signalCode === null)
        process.child.kill('SIGTERM');
      await process.exited;
      for (const secret of [token, backendToken])
        assert.equal(process.output().includes(secret), false);
    }
    await rm(root, { recursive: true, force: true });
  });
  const install = run([
    'install',
    '--home',
    home,
    '--source',
    source,
    '--project',
    project,
    '--backend-port',
    String(backendPort),
    '--port',
    String(recoveryPort),
  ]);
  children.push(install);
  assert.equal((await install.exited)[0], 0, install.output());
  const launch = () => run([], { executable: path.join(home, 'start'), prefix: [] });
  const base = launch();
  children.push(base);
  const origin = `http://127.0.0.1:${recoveryPort}`;
  const request = (route = 'status', init = {}) =>
    fetch(`${origin}/recovery/v1/${route}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...init.headers },
      signal: AbortSignal.timeout(12000),
    });
  for (let attempt = 0; ; attempt++) {
    try {
      await request();
      break;
    } catch (error) {
      if (attempt > 100 || base.child.exitCode !== null)
        throw new Error(base.output() || error.message);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }
  const restartBase = async () => {
    base.child.kill('SIGTERM');
    await base.exited;
    const replacement = launch();
    children.push(replacement);
    for (let attempt = 0; ; attempt++) {
      try {
        await request();
        break;
      } catch (error) {
        if (attempt > 100) throw error;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    }
  };
  return { home, source, project, backendPort, request, restartBase };
}

test(
  'independent authenticated recovery starts and stops the real retained backend after source loss',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    assert.equal((await f.request('status', { headers: { authorization: '' } })).status, 401);
    assert.equal(
      (
        await f.request('start', {
          method: 'POST',
          headers: { origin: 'https://untrusted.example' },
        })
      ).status,
      403,
    );
    assert.equal((await f.request()).status, 200);
    assert.equal((await (await f.request()).json()).state, 'stopped');
    const started = await (await f.request('start', { method: 'POST' })).json();
    assert.equal(started.recoveryVersion, 1);
    assert.equal(started.state, 'running');
    assert.ok(started.pid > 0);
    assert.equal(
      (
        await fetch(`http://127.0.0.1:${f.backendPort}/api/status`, {
          headers: { authorization: `Bearer ${backendToken}` },
        })
      ).status,
      200,
    );
    const stopped = await (await f.request('stop', { method: 'POST' })).json();
    assert.equal(stopped.state, 'stopped');
    await assert.rejects(fetch(`http://127.0.0.1:${f.backendPort}/api/status`));
    await rm(f.source, { recursive: true });
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        f.request('recover', { method: 'POST' }).then((r) => r.json()),
      ),
    );
    assert.ok(
      responses.every((value) => value.state === 'running' && value.pid === responses[0].pid),
    );
    assert.equal(responses[0].baselineRevision, started.baselineRevision);
    assert.notEqual(responses[0].pid, started.pid);
    const backendStatus = await (
      await fetch(`http://127.0.0.1:${f.backendPort}/api/status`, {
        headers: { authorization: `Bearer ${backendToken}` },
      })
    ).json();
    assert.equal(backendStatus.protocolVersion, 2);
    assert.equal(
      await (
        await fetch(`http://127.0.0.1:${f.backendPort}${backendStatus.app.entrypoint}`, {
          headers: { authorization: `Bearer ${backendToken}` },
        })
      ).text(),
      xml,
    );
    assert.equal(await readFile(path.join(f.project, 'private-session'), 'utf8'), 'retain-session');
  },
);

test(
  'failed startup stays observable across base restart and recovers after an occupied listener is removed',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    // A different listener returning 200 cannot stand in for the managed child.
    const blocker = net.createServer((socket) =>
      socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}'),
    );
    blocker.listen(f.backendPort, '127.0.0.1');
    await once(blocker, 'listening');
    t.after(() => new Promise((resolve) => blocker.close(resolve)));
    const failed = await f.request('start', { method: 'POST' });
    assert.equal(failed.status, 503);
    const failure = await failed.json();
    assert.equal(failure.state, 'failed');
    assert.equal(failure.failure, 'startup-failed');
    assert.equal(failure.pid, null);
    await f.restartBase();
    assert.equal((await (await f.request()).json()).failure, 'startup-failed');
    await new Promise((resolve) => blocker.close(resolve));
    assert.equal(
      (
        await f.request('recover', {
          method: 'POST',
          body: JSON.stringify({ executable: '/bin/sh', path: '/tmp' }),
        })
      ).status,
      400,
    );
    const recovered = await (await f.request('recover', { method: 'POST' })).json();
    assert.equal(recovered.state, 'running');
    process.kill(recovered.pid, 'SIGKILL');
    for (let attempt = 0; ; attempt++) {
      const status = await (await f.request()).json();
      if (status.state === 'failed') {
        assert.notEqual(status.failure, null);
        break;
      }
      assert.ok(attempt < 100, 'child exit must become visible');
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.equal((await (await f.request('recover', { method: 'POST' })).json()).state, 'running');
  },
);

test(
  'desktop recovery has a separate credential scope and reaches real lifecycle controls with the workspace stopped',
  { timeout: 30000 },
  async (t) => {
    const { createDaemonProxy, APP_ORIGIN } = createRequire(import.meta.url)(
      '../../../apps/desktop/proxy.cjs',
    );
    const f = await fixture(t);
    const statusResponse = await f.request();
    const recoveryOrigin = new URL(statusResponse.url).origin;
    const normal = createDaemonProxy();
    const recovery = createDaemonProxy({ scope: 'recovery' });
    t.after(() => {
      normal.close();
      recovery.close();
    });
    const normalConnection = normal.connect({
      endpoint: `http://127.0.0.1:${f.backendPort}`,
      token: backendToken,
    });
    const connection = recovery.connect({ endpoint: recoveryOrigin, token });
    assert.notEqual(connection.endpoint, normalConnection.endpoint);
    assert.equal(connection.token, '');
    const call = (route, method = 'GET') =>
      recovery.handle(
        new Request(`${connection.endpoint}/recovery/v1/${route}`, {
          method,
          headers: { origin: APP_ORIGIN },
        }),
      );
    assert.equal((await call('status')).status, 200);
    assert.equal(recovery.accepts(`${connection.endpoint}/api/status`), false);
    assert.equal(normal.accepts(`${normalConnection.endpoint}/recovery/v1/recover`), false);
    assert.equal((await call('recover', 'POST')).status, 200);
    normal.connect({ endpoint: 'http://127.0.0.1:1', token: 'different-normal-credential' });
    assert.equal((await (await call('status')).json()).state, 'running');
    assert.equal((await call('stop', 'POST')).status, 200);
    assert.equal((await (await call('status')).json()).state, 'stopped');
  },
);

test(
  'recovery and backend credentials remain independent through recover and base restart',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const verifyScopes = async () => {
      assert.equal((await f.request()).status, 200);
      for (const route of ['status', 'stop']) {
        assert.equal(
          (
            await f.request(route, {
              method: route === 'status' ? 'GET' : 'POST',
              headers: { authorization: `Bearer ${backendToken}` },
            })
          ).status,
          401,
        );
      }
      const endpoint = `http://127.0.0.1:${f.backendPort}/api/status`;
      assert.equal(
        (await fetch(endpoint, { headers: { authorization: `Bearer ${token}` } })).status,
        401,
      );
      assert.equal(
        (await fetch(endpoint, { headers: { authorization: `Bearer ${backendToken}` } })).status,
        200,
      );
      const status = await (await f.request()).text();
      for (const secret of [token, backendToken]) {
        assert.equal(status.includes(secret), false);
        for (const name of ['registration.json', 'diagnostics.json', 'start']) {
          assert.equal((await readFile(path.join(f.home, name), 'utf8')).includes(secret), false);
        }
      }
    };
    assert.equal((await f.request('start', { method: 'POST' })).status, 200);
    await verifyScopes();
    assert.equal((await f.request('stop', { method: 'POST' })).status, 200);
    assert.equal((await f.request('recover', { method: 'POST' })).status, 200);
    await verifyScopes();
    await f.restartBase();
    assert.equal((await (await f.request()).json()).state, 'stopped');
    assert.equal((await f.request('recover', { method: 'POST' })).status, 200);
    await verifyScopes();
  },
);

test('install and serve require valid distinct credentials for both scopes', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hypir-recovery-auth-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const command of ['install', 'serve']) {
    for (const env of [
      { HYPIR_RECOVERY_TOKEN: '' },
      { HYPIR_TOKEN: '' },
      { HYPIR_RECOVERY_TOKEN: 'invalid recovery token' },
      { HYPIR_TOKEN: 'invalid backend token' },
      { HYPIR_RECOVERY_TOKEN: 'x'.repeat(4097) },
      { HYPIR_TOKEN: 'x'.repeat(4097) },
      { HYPIR_TOKEN: token },
    ]) {
      const invocation = run([command, '--home', path.join(root, 'unregistered')], { env });
      assert.equal((await invocation.exited)[0], 1);
      assert.match(invocation.output(), /HYPIR_(?:RECOVERY_)?TOKEN/);
      for (const secret of [token, backendToken, ...Object.values(env).filter(Boolean)]) {
        assert.equal(invocation.output().includes(secret), false);
      }
    }
  }
});
