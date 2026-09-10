import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { managedBackend } from './backend.js';
import { validateCredentials } from './credentials.js';
import { parseRecoveryStatus } from './contract.js';
const digest = (value) => createHash('sha256').update(value).digest();
export async function serve(home, credentials) {
  validateCredentials(credentials);
  const { recoveryToken, backendToken } = credentials;
  const config = JSON.parse(await readFile(path.join(home, 'registration.json'), 'utf8'));
  if (config.recoveryVersion !== 1) throw new Error('Unsupported recovery registration');
  try {
    const previous = parseRecoveryStatus(
      JSON.parse(await readFile(path.join(home, 'diagnostics.json'), 'utf8')),
    );
    config.previousFailure = previous.failure;
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Invalid recovery diagnostics');
  }
  const backend = managedBackend(home, config, backendToken);
  let recording = Promise.resolve();
  const record = (status) => {
    const pending = recording.then(async () => {
      await writeFile(path.join(home, 'diagnostics.json.tmp'), JSON.stringify(status), {
        mode: 0o600,
      });
      await rename(path.join(home, 'diagnostics.json.tmp'), path.join(home, 'diagnostics.json'));
      return status;
    });
    recording = pending.catch(() => {});
    return pending;
  };
  const authorization = digest(`Bearer ${recoveryToken}`);
  let closing = false;
  const reply = (res, code, value) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(code, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(JSON.stringify(value));
  };
  const server = http.createServer(async (req, res) => {
    res.on('error', () => res.destroy());
    try {
      if (closing) return reply(res, 503, { error: 'Recovery is closing' });
      if (req.headers.origin !== undefined)
        return reply(res, 403, { error: 'Browser origins are not allowed' });
      if (!timingSafeEqual(authorization, digest(req.headers.authorization ?? '')))
        return reply(res, 401, { error: 'Unauthorized' });
      if (req.method === 'GET' && req.url === '/recovery/v1/status')
        return reply(res, 200, await record(await backend.status()));
      if (
        req.method !== 'POST' ||
        !['/recovery/v1/start', '/recovery/v1/stop', '/recovery/v1/recover'].includes(req.url)
      )
        return reply(res, 404, { error: 'Unknown recovery control' });
      // No executable, revision, filesystem path, or other client parameters.
      if (
        req.headers['transfer-encoding'] ||
        (req.headers['content-length'] && req.headers['content-length'] !== '0')
      )
        return reply(res, 400, { error: 'Lifecycle actions take no request body' });
      const status = await record(await backend.action(req.url.split('/').at(-1)));
      reply(res, status.state === 'failed' ? 503 : 200, status);
    } catch {
      reply(res, 409, { error: 'Lifecycle action could not complete; inspect status' });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  let shutdown;
  const close = () =>
    (shutdown ??= (async () => {
      closing = true;
      const stopped = new Promise((resolve) => server.close(resolve));
      try {
        await backend.close();
        await record(await backend.status());
      } finally {
        server.closeAllConnections();
        await stopped;
      }
    })());
  return { close };
}
