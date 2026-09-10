const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const { once } = require('node:events');
const {
  APP_ORIGIN,
  APP_URL,
  createDaemonProxy,
  isAppSender,
  normalizeEndpoint,
} = require('./proxy.cjs');

async function fixture(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const proxy = createDaemonProxy();
  t.after(async () => {
    proxy.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const actual = `http://127.0.0.1:${server.address().port}`;
  const connection = proxy.connect({ endpoint: actual, token: 'main-owned-secret' });
  return { server, proxy, actual, connection };
}

function request(connection, pathname = '/api/status', options = {}) {
  return new Request(`${connection.endpoint}${pathname}`, {
    ...options,
    headers: { origin: APP_ORIGIN, ...options.headers },
  });
}

test('accepts origins, not URL parser aliases, credentials, paths or malformed authorities', () => {
  assert.equal(normalizeEndpoint('HTTPS://Example.com:443/'), 'https://example.com');
  assert.equal(normalizeEndpoint('http://[::1]:4747'), 'http://[::1]:4747');
  for (const value of [
    'file:///etc/passwd',
    'http://user:password@localhost:4747',
    'http://localhost:4747/preview/',
    'http://localhost:4747?token=secret',
    'http://localhost:4747#fragment',
    'http://localhost:65536',
    'http://localhost:0',
    'http://localhost:',
    'http://-bad-host:4747',
    'http://127.1:4747',
    'http://0x7f000001:4747',
    'http://[not-an-ip]:4747',
    'http://localhost\\@evil.example',
    'http://localhost\n:4747',
  ])
    assert.throws(() => normalizeEndpoint(value), TypeError);
});

test('connect IPC accepts only the owned top-level app frame', () => {
  const mainFrame = { url: APP_URL };
  const contents = { mainFrame, isDestroyed: () => false };
  const event = { sender: contents, senderFrame: mainFrame };
  assert.equal(isAppSender(event, contents), true);
  assert.equal(isAppSender({ ...event, sender: {} }, contents), false);
  assert.equal(isAppSender({ ...event, senderFrame: { url: APP_URL } }, contents), false);
  assert.equal(isAppSender({ ...event, senderFrame: null }, contents), false);
  mainFrame.url = `${APP_URL}#other`;
  assert.equal(isAppSender(event, contents), false);
  mainFrame.url = 'https://example.com/index.html';
  assert.equal(isAppSender(event, contents), false);
});

test('invalid IPC payload cannot replace an existing connection', async (t) => {
  const f = await fixture(t, (_req, res) => res.end('connected'));
  for (const payload of [
    { endpoint: f.actual, token: '\r\ninjected: header' },
    { endpoint: f.actual, token: 'a'.repeat(4097) },
    { endpoint: f.actual, token: '', extra: true },
    { endpoint: f.actual },
    [f.actual, ''],
    null,
  ])
    assert.throws(() => f.proxy.connect(payload), TypeError);
  assert.equal(await (await f.proxy.handle(request(f.connection))).text(), 'connected');
});

test(
  'proxy scopes credentials and preserves forms, media metadata and exact-origin CORS',
  { timeout: 10000 },
  async (t) => {
    let observed;
    const f = await fixture(t, async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      observed = {
        headers: req.headers,
        method: req.method,
        url: req.url,
        body: Buffer.concat(chunks).toString(),
      };
      res.writeHead(206, {
        'content-type': 'application/xml',
        'content-range': 'bytes 0-3/4',
        'set-cookie': 'remote-cookie=secret',
        'access-control-allow-origin': '*',
        refresh: '0;url=https://example.com',
        'x-network-retry-action': 'replace',
      });
      res.end('<ok>');
    });
    assert.deepEqual(f.connection, { endpoint: 'http://daemon-1.hypir.local', token: '' });
    const response = await f.proxy.handle(
      request(f.connection, '/preview/form.xml?step=2', {
        method: 'POST',
        body: 'name=Alice&message=Hello%20world',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: 'Bearer renderer-supplied',
          cookie: 'client-cookie=secret',
          'x-hyperview-version': '0.110.2',
        },
      }),
    );
    assert.equal(await response.text(), '<ok>');
    assert.equal(observed.headers.authorization, 'Bearer main-owned-secret');
    assert.equal(observed.headers.origin, undefined);
    assert.equal(observed.headers.cookie, undefined);
    assert.equal(observed.headers['x-hyperview-version'], '0.110.2');
    assert.equal(observed.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.equal(observed.body, 'name=Alice&message=Hello%20world');
    assert.equal(observed.method, 'POST');
    assert.equal(observed.url, '/preview/form.xml?step=2');
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 0-3/4');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('refresh'), null);
    assert.equal(response.headers.get('access-control-allow-origin'), APP_ORIGIN);
    assert.equal(response.headers.get('x-network-retry-action'), 'replace');
  },
);

test('rejects foreign origins, unexpected routes and unsupported preflight before networking', async (t) => {
  let hits = 0;
  const f = await fixture(t, (_req, res) => {
    hits += 1;
    res.end('unexpected');
  });
  for (const denied of [
    request(f.connection, '/api/status', { headers: { origin: 'https://evil.example' } }),
    request(f.connection, '/api/status', { headers: { origin: 'null' } }),
    request(f.connection, '/private'),
    new Request(`${f.actual}/api/status`),
    new Request('http://daemon-1.hypir.local.evil.example/api/status'),
    request(f.connection, '/api/status', {
      method: 'OPTIONS',
      headers: {
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization',
      },
    }),
  ])
    assert.equal((await f.proxy.handle(denied)).status, 403);
  const allowed = await f.proxy.handle(
    request(f.connection, '/api/status', {
      method: 'OPTIONS',
      headers: {
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-hyperview-version',
      },
    }),
  );
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), APP_ORIGIN);
  const sse = await f.proxy.handle(
    request(f.connection, '/api/events', {
      method: 'OPTIONS',
      headers: {
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'cache-control,x-requested-with,last-event-id',
      },
    }),
  );
  assert.equal(sse.status, 204);
  assert.ok(sse.headers.get('access-control-allow-headers').includes('x-requested-with'));
  assert.equal(hits, 0);
});

test(
  'rejects redirects without sending credentials to their destination',
  { timeout: 10000 },
  async (t) => {
    let redirectedHits = 0;
    const destination = await fixture(t, (_req, res) => {
      redirectedHits += 1;
      res.end('leak');
    });
    const source = await fixture(t, (_req, res) => {
      res.writeHead(302, { location: `${destination.actual}/api/secret` });
      res.end();
    });
    assert.equal((await source.proxy.handle(request(source.connection))).status, 502);
    assert.equal(redirectedHits, 0);
  },
);

test(
  'reconnect aborts live SSE and invalidates old origins even for the same daemon',
  { timeout: 10000 },
  async (t) => {
    let onClosed;
    let hits = 0;
    const upstreamClosed = new Promise((resolve) => {
      onClosed = resolve;
    });
    const f = await fixture(t, (req, res) => {
      hits += 1;
      if (req.url === '/api/events') {
        res.on('close', onClosed);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: connected\n\n');
      } else res.end(req.headers.authorization);
    });
    const response = await f.proxy.handle(request(f.connection, '/api/events'));
    const reader = response.body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: connected\n\n');
    const next = reader.read();
    const rejected = assert.rejects(next, /Daemon stream ended unexpectedly/);
    const current = f.proxy.connect({ endpoint: f.actual, token: 'replacement-secret' });
    assert.notEqual(current.endpoint, f.connection.endpoint);
    await rejected;
    await upstreamClosed;
    assert.equal((await f.proxy.handle(request(f.connection))).status, 403);
    assert.equal(
      await (await f.proxy.handle(request(current))).text(),
      'Bearer replacement-secret',
    );
    assert.equal(hits, 2);
  },
);

test(
  'request abort, response cancellation and host close release upstream streams',
  { timeout: 10000 },
  async (t) => {
    const closed = [];
    const f = await fixture(t, (_req, res) => {
      closed.push(new Promise((resolve) => res.on('close', resolve)));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: connected\n\n');
    });
    const controller = new AbortController();
    const first = await f.proxy.handle(
      request(f.connection, '/api/events', { signal: controller.signal }),
    );
    controller.abort();
    await closed[0];
    await assert.rejects(first.text(), /Daemon stream ended unexpectedly/);
    const second = await f.proxy.handle(request(f.connection, '/api/events'));
    await second.body.cancel();
    await closed[1];
    const third = await f.proxy.handle(request(f.connection, '/api/events'));
    f.proxy.close();
    await closed[2];
    await assert.rejects(third.text(), /Daemon stream ended unexpectedly/);
    assert.equal((await f.proxy.handle(request(f.connection))).status, 403);
    assert.throws(() => f.proxy.connect({ endpoint: f.actual, token: '' }), /closed/);
  },
);
