import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { mkdtemp, mkdir, writeFile, rename, symlink, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { eventTypes, parseEvent, parseStatus } from '@hypir/protocol';
import { createDaemon } from './server.js';

const xml = '<doc xmlns="https://hyperview.org/hyperview"><screen><body /></screen></doc>';

async function fixture(t) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'hypir-'));
  const root = path.join(parent, 'project');
  const screens = path.join(root, 'screens');
  const outside = path.join(parent, 'outside');
  const closers = [];
  t.after(async () => {
    try {
      for (const close of closers.reverse()) await close();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
  await mkdir(path.join(screens, 'flows'), { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(screens, 'flows', 'start.xml'), xml);
  await writeFile(path.join(outside, 'secret.xml'), 'outside-secret');
  const manifest = {
    name: 'Temporary preview',
    entrypoint: '/flows/start.xml',
    screens: 'screens',
  };
  const manifestFile = path.join(root, 'hyperview.json');
  await writeFile(manifestFile, JSON.stringify(manifest));
  return { root, screens, outside, manifest, manifestFile, closers };
}

async function start(f, options = {}) {
  const daemon = await createDaemon({ projectRoot: f.root, port: 0, ...options });
  f.closers.push(() => daemon.close());
  const address = await daemon.listen();
  return { daemon, port: address.port };
}

function request(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: '127.0.0.1', port, path: pathname, headers, agent: false },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
  });
}

async function stream(f, port, headers = {}) {
  const response = await new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: '127.0.0.1', port, path: '/api/events', headers, agent: false },
      resolve,
    );
    req.on('error', reject);
    f.closers.push(() => req.destroy());
  });
  assert.equal(response.statusCode, 200);
  async function* frames() {
    let buffered = '';
    for await (const chunk of response) {
      buffered += chunk.toString();
      let end;
      while ((end = buffered.indexOf('\n\n')) !== -1) {
        const frame = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        yield frame;
      }
    }
  }
  const iterator = frames();
  return {
    response,
    async frame() {
      return (await iterator.next()).value;
    },
    async event(type, matches = () => true) {
      for (;;) {
        const { value, done } = await iterator.next();
        if (done) throw new Error('Event stream ended');
        const data = value.split('\n').find((line) => line.startsWith('data: '));
        if (!data) continue;
        const event = parseEvent(data.slice(6));
        if (event.type === type && matches(event)) return event;
      }
    },
  };
}

test('serves a validated manifest and nested regular XML without browser CORS', async (t) => {
  const f = await fixture(t);
  const { port } = await start(f);
  const status = await request(port, '/api/status');
  assert.equal(status.status, 200);
  assert.deepEqual(parseStatus(JSON.parse(status.body)).project, f.manifest);
  const response = await request(port, `/preview${f.manifest.entrypoint}?generation=2`);
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /hyperview\+xml/u);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  assert.equal(response.body, xml);
  assert.equal((await request(port, '/preview/missing.xml')).status, 404);
});

test('loads real projects on Android without weakening descriptor-relative containment', async (t) => {
  const f = await fixture(t);
  await symlink(path.join(f.outside, 'secret.xml'), path.join(f.screens, 'external.xml'));
  await symlink(path.join(f.screens, 'flows', 'start.xml'), path.join(f.screens, 'internal.xml'));
  await symlink(f.outside, path.join(f.screens, 'external'));
  // Isolate the platform override from concurrent tests and Node's watcher selection.
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        import assert from 'node:assert/strict';
        import { rename, symlink } from 'node:fs/promises';
        import path from 'node:path';

        Object.defineProperty(process, 'platform', { value: 'android' });
        const { loadProject, readScreen } = await import(process.argv[1]);
        const root = process.argv[2];
        const project = await loadProject(root);
        try {
          assert.equal(await readScreen(project, 'flows/start.xml'), process.argv[3]);
          for (const name of ['external.xml', 'internal.xml', 'external/secret.xml']) {
            await assert.rejects(readScreen(project, name));
          }
          await assert.rejects(readScreen(project, '../outside/secret.xml'), TypeError);

          Object.defineProperty(process, 'platform', { value: 'win32' });
          await assert.rejects(loadProject(root), Error);
          Object.defineProperty(process, 'platform', { value: 'android' });

          await rename(project.screens, path.join(root, 'original-screens'));
          await symlink(path.join(root, '..', 'outside'), project.screens);
          assert.equal(await readScreen(project, 'flows/start.xml'), process.argv[3]);
          await assert.rejects(readScreen(project, 'secret.xml'));
          await assert.rejects(loadProject(root));
        } finally {
          await project.directory.close();
        }
      `,
      new URL('./project.js', import.meta.url).href,
      f.root,
      xml,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const [code] = await once(child, 'close');
  assert.equal(code, 0, stderr);
});

test('rejects malformed URLs and Host without losing subsequent requests or leaking paths', async (t) => {
  const f = await fixture(t);
  const { port } = await start(f);
  for (const [pathname, headers] of [
    ['/preview/%', {}],
    ['/preview/%2e%2e/outside/secret.xml', {}],
    ['/preview/%2fetc/passwd.xml', {}],
    ['/preview/flows%5cstart.xml', {}],
    ['/preview/%00.xml', {}],
    ['/api/status', { host: '[' }],
    ['/api/status', { host: 'localhost:99999' }],
    ['/api/status', { host: 'user@localhost' }],
  ]) {
    const response = await request(port, pathname, headers);
    assert.equal(response.status, 400);
    assert.ok(!response.body.includes(f.root));
    assert.ok(!response.body.includes('outside-secret'));
  }
  assert.equal((await request(port, '/api/status')).status, 200);
});

test('denies external and internal symlinks including swapped path components', async (t) => {
  const f = await fixture(t);
  const { port } = await start(f);
  await symlink(path.join(f.outside, 'secret.xml'), path.join(f.screens, 'secret.xml'));
  await symlink(f.outside, path.join(f.screens, 'external'));
  await symlink(path.join(f.screens, 'flows', 'start.xml'), path.join(f.screens, 'internal.xml'));
  await rename(path.join(f.screens, 'flows'), path.join(f.screens, 'original'));
  await symlink(f.outside, path.join(f.screens, 'flows'));
  for (const name of ['secret.xml', 'external/secret.xml', 'internal.xml', 'flows/secret.xml']) {
    const response = await request(port, `/preview/${name}`);
    assert.equal(response.status, 400);
    assert.ok(!response.body.includes('outside-secret'));
    assert.ok(!response.body.includes(f.outside));
  }
  assert.equal((await request(port, '/preview/original/start.xml')).body, xml);
  // Replacing the entire screens pathname cannot redirect the pinned root FD.
  await rename(f.screens, path.join(f.root, 'original-screens'));
  await symlink(f.outside, f.screens);
  const swapped = await request(port, '/preview/secret.xml');
  assert.equal(swapped.status, 400);
  assert.ok(!swapped.body.includes('outside-secret'));
});

test('validates screens containment, manifest types, and entrypoint existence before startup', async (t) => {
  const f = await fixture(t);
  await symlink(f.outside, path.join(f.root, 'linked-screens'));
  await symlink(path.join(f.outside, 'secret.xml'), path.join(f.screens, 'linked.xml'));
  await mkdir(path.join(f.screens, 'directory.xml'));
  for (const change of [
    { screens: f.outside },
    { screens: '../outside' },
    { screens: 'linked-screens', entrypoint: '/secret.xml' },
    { screens: 42 },
    { name: [] },
    { entrypoint: '/missing.xml' },
    { entrypoint: '/linked.xml' },
    { entrypoint: '/directory.xml' },
    { entrypoint: 'flows/start.xml' },
    { entrypoint: '/%2e%2e/outside/secret.xml' },
  ]) {
    await writeFile(f.manifestFile, JSON.stringify({ ...f.manifest, ...change }));
    await assert.rejects(createDaemon({ projectRoot: f.root, port: 0 }));
  }
  await writeFile(f.manifestFile, '{');
  await assert.rejects(createDaemon({ projectRoot: f.root, port: 0 }), SyntaxError);
});

test('requires tokens off loopback and enforces bearer auth and Origin rejection on every route', async (t) => {
  const f = await fixture(t);
  await assert.rejects(createDaemon({ projectRoot: f.root, host: '0.0.0.0', port: 0 }), TypeError);
  await assert.rejects(createDaemon({ projectRoot: f.root, host: '::', port: 0 }), TypeError);
  await assert.rejects(createDaemon({ projectRoot: f.root, port: NaN }), TypeError);
  const { port } = await start(f, { token: 'a-private-token' });
  for (const pathname of ['/api/status', '/api/events', '/preview/flows/start.xml']) {
    assert.equal((await request(port, pathname)).status, 401);
    assert.equal((await request(port, pathname, { authorization: 'Bearer wrong' })).status, 401);
    assert.equal(
      (await request(port, pathname, { authorization: 'Bearer a-private-token', origin: 'null' }))
        .status,
      403,
    );
  }
  assert.equal(
    (await request(port, '/api/status', { authorization: 'Bearer a-private-token' })).status,
    200,
  );
  assert.equal(
    (await request(port, '/preview/flows/start.xml', { authorization: 'Bearer a-private-token' }))
      .body,
    xml,
  );
  const events = await stream(f, port, { authorization: 'Bearer a-private-token' });
  assert.deepEqual((await events.event(eventTypes.connected)).payload.project, f.manifest);
  const publicDaemon = await start(f);
  assert.equal(
    (await request(publicDaemon.port, '/api/status', { origin: 'https://example.com' })).status,
    403,
  );
});

test(
  'watches nested edits, deletion, and reconnection with monotonic revisions and closes live clients',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    await writeFile(path.join(f.screens, 'flows', 'removed.xml'), xml);
    const { daemon, port } = await start(f);
    const events = await stream(f, port);
    assert.deepEqual((await events.event(eventTypes.connected)).payload.project, f.manifest);
    assert.equal(JSON.parse((await request(port, '/api/status')).body).connectedClients, 1);
    await writeFile(path.join(f.screens, 'flows', 'start.xml'), `${xml}\n`);
    const first = await events.event(eventTypes.previewInvalidate);
    assert.equal(first.payload.path, '/flows/start.xml');
    await rm(path.join(f.screens, 'flows', 'removed.xml'));
    const second = await events.event(
      eventTypes.previewInvalidate,
      (event) => event.payload.path === '/flows/removed.xml',
    );
    assert.ok(second.payload.revision > first.payload.revision);
    assert.equal((await request(port, '/preview/flows/removed.xml')).status, 404);
    const reconnect = await stream(f, port);
    assert.deepEqual((await reconnect.event(eventTypes.connected)).payload.project, f.manifest);
    const disconnected = new Promise((resolve) => {
      reconnect.response.on('error', () => {});
      reconnect.response.once('close', resolve);
      reconnect.response.resume();
    });
    await Promise.all([daemon.close(), daemon.close()]);
    await disconnected;
    await assert.rejects(request(port, '/api/status'));
  },
);

test(
  'sends SSE heartbeats without inventing invalidation events',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    const originalInterval = globalThis.setInterval;
    let heartbeat;
    t.mock.method(globalThis, 'setInterval', (callback, delay, ...args) => {
      heartbeat = () => callback(...args);
      return originalInterval(callback, delay, ...args);
    });
    const { port } = await start(f);
    const events = await stream(f, port);
    await events.event(eventTypes.connected);
    heartbeat();
    assert.equal(await events.frame(), ': heartbeat');
  },
);

test(
  'disconnects a backpressured SSE client instead of buffering further events',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    const { port } = await start(f);
    const events = await stream(f, port);
    await events.event(eventTypes.connected);
    const disconnected = new Promise((resolve) => {
      events.response.on('error', () => {});
      events.response.once('close', resolve);
      events.response.resume();
    });
    const originalWrite = http.ServerResponse.prototype.write;
    t.mock.method(http.ServerResponse.prototype, 'write', function (...args) {
      originalWrite.apply(this, args);
      return false;
    });
    await writeFile(path.join(f.screens, 'flows', 'start.xml'), `${xml}\n`);
    await disconnected;
    assert.equal(JSON.parse((await request(port, '/api/status')).body).connectedClients, 0);
  },
);

test(
  'fatal watcher errors stop the listener and active SSE before reporting failure',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    const originalWatch = fs.watch;
    let watcher;
    t.mock.method(fs, 'watch', (...args) => {
      watcher = originalWatch(...args);
      return watcher;
    });
    let reported;
    const failure = new Promise((resolve) => {
      reported = resolve;
    });
    const { daemon, port } = await start(f, { onError: reported });
    const events = await stream(f, port);
    await events.event(eventTypes.connected);
    const error = new Error('watch failed');
    watcher.emit('error', error);
    assert.equal(await failure, error);
    await assert.rejects(request(port, '/api/status'));
    await daemon.close();
  },
);

test('bind failure closes the watcher and allows idempotent shutdown', async (t) => {
  const f = await fixture(t);
  const first = await start(f);
  const second = await createDaemon({ projectRoot: f.root, port: first.port });
  f.closers.push(() => second.close());
  await assert.rejects(second.listen(), { code: 'EADDRINUSE' });
  await second.close();
  assert.equal((await request(first.port, '/api/status')).status, 200);
});

const cli = fileURLToPath(new URL('./cli.js', import.meta.url));
async function runCli(t, args, env = {}) {
  const child = spawn(process.execPath, [cli, ...args], {
    env: {
      ...process.env,
      HYPIR_HOST: '127.0.0.1',
      HYPIR_PORT: '4747',
      HYPIR_TOKEN: undefined,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });
  child.stdout.resume();
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const [code] = await once(child, 'exit');
  return { code, stderr };
}

test(
  'CLI rejects bad arguments and exits on bind failure rather than hanging watchers',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    for (const args of [
      ['--port'],
      ['--port', '0'],
      ['--port', '65536'],
      ['--port', '4.5'],
      ['--port', 'NaN'],
      ['--host', ''],
      ['--unknown', 'x'],
      ['--port', '4747', '--port', '4748'],
      ['--host', '0.0.0.0'],
    ])
      assert.equal((await runCli(t, ['--project', f.root, ...args])).code, 1);
    const { port } = await start(f);
    assert.equal((await runCli(t, ['--project', f.root, '--port', String(port)])).code, 1);
  },
);

test(
  'CLI applies HYPIR_TOKEN and exits cleanly on SIGTERM with an open SSE client',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    const reserved = await start(f);
    const port = reserved.port;
    await reserved.daemon.close();
    const child = spawn(process.execPath, [cli, '--project', f.root, '--port', String(port)], {
      env: { ...process.env, HYPIR_HOST: '127.0.0.1', HYPIR_TOKEN: 'cli-secret' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    f.closers.push(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    });
    child.stderr.resume();
    const exited = once(child, 'exit');
    await Promise.race([
      once(child.stdout, 'data'),
      exited.then(() => {
        throw new Error('CLI exited before listening');
      }),
    ]);
    child.stdout.resume();
    assert.equal((await request(port, '/api/status')).status, 401);
    const events = await stream(f, port, { authorization: 'Bearer cli-secret' });
    await events.event(eventTypes.connected);
    child.kill('SIGTERM');
    assert.deepEqual(await exited, [0, null]);
    await assert.rejects(request(port, '/api/status'));
  },
);
