const { isIP } = require('node:net');

const APP_ORIGIN = 'http://hypir.local';
const APP_URL = `${APP_ORIGIN}/index.html`;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_REQUESTS = 32;
const REQUEST_HEADERS = [
  'accept',
  'content-type',
  'range',
  'if-none-match',
  'if-modified-since',
  'last-event-id',
  'x-requested-with',
  'x-hyperview-version',
  'x-hyperview-dimensions',
];
const RESPONSE_HEADERS = [
  'content-type',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
  'x-network-retry-action',
  'x-network-retry-event',
  'x-response-stale-reason',
];
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

function normalizeEndpoint(value) {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    /[\s\\\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError('Endpoint must be an HTTP(S) origin');
  }
  const match = /^(https?):\/\/(\[[0-9a-f:.]+\]|[^/:?#@]+)(?::([0-9]+))?\/?$/iu.exec(value);
  if (!match) throw new TypeError('Endpoint must be an HTTP(S) origin');
  const [, , host, port] = match;
  if (
    port !== undefined &&
    (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535)
  ) {
    throw new TypeError('Invalid endpoint port');
  }
  const address = host.startsWith('[') ? host.slice(1, -1) : host;
  if (host.startsWith('[')) {
    if (isIP(address) !== 6) throw new TypeError('Invalid endpoint host');
  } else if (
    host.length > 253 ||
    !host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(label))
  ) {
    throw new TypeError('Invalid endpoint host');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('Invalid endpoint origin');
  }
  // Reject WHATWG's surprising abbreviated, hexadecimal and integer IPv4 aliases.
  if (!host.startsWith('[') && url.hostname !== host.toLowerCase()) {
    throw new TypeError('Invalid endpoint host');
  }
  return url.origin;
}

function validateConnection(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'endpoint') ||
    !Object.hasOwn(value, 'token') ||
    typeof value.token !== 'string' ||
    value.token.length > 4096 ||
    (value.token !== '' && !/^[\x21-\x7e]+$/u.test(value.token))
  ) {
    throw new TypeError('Invalid connection settings');
  }
  return { endpoint: normalizeEndpoint(value.endpoint), token: value.token };
}

function isAppSender(event, contents) {
  return Boolean(
    contents &&
      !contents.isDestroyed() &&
      event.sender === contents &&
      event.senderFrame &&
      event.senderFrame === contents.mainFrame &&
      event.senderFrame.url === APP_URL,
  );
}

function corsHeaders() {
  return {
    'access-control-allow-origin': APP_ORIGIN,
    'access-control-expose-headers': RESPONSE_HEADERS.join(', '),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    vary: 'Origin',
  };
}

function failure(status, message) {
  return new Response(message, {
    status,
    headers: { ...corsHeaders(), 'content-type': 'text/plain; charset=utf-8' },
  });
}

function createDaemonProxy() {
  let generation = 0;
  let connection;
  let closed = false;
  const pending = new Set();

  function abortPending() {
    for (const cancel of [...pending]) cancel();
  }

  function connect(value) {
    if (closed) throw new Error('Desktop session is closed');
    const validated = validateConnection(value);
    abortPending();
    generation += 1;
    connection = { ...validated, origin: `http://daemon-${generation}.hypir.local` };
    return { endpoint: connection.origin, token: '' };
  }

  function accepts(raw) {
    if (!connection || closed || typeof raw !== 'string' || raw.length > 16384) return false;
    try {
      const url = new URL(raw);
      return (
        url.origin === connection.origin &&
        !url.username &&
        !url.password &&
        !url.hash &&
        (url.pathname.startsWith('/api/') || url.pathname.startsWith('/preview/'))
      );
    } catch {
      return false;
    }
  }

  async function handle(request) {
    if (!accepts(request.url)) return failure(403, 'Request is not allowed');
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== APP_ORIGIN) return failure(403, 'Origin is not allowed');
    if (request.method === 'OPTIONS') {
      const method = request.headers.get('access-control-request-method');
      const requested = (request.headers.get('access-control-request-headers') || '')
        .toLowerCase()
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
      if (
        origin !== APP_ORIGIN ||
        !METHODS.has(method) ||
        requested.some((name) => !REQUEST_HEADERS.includes(name) && name !== 'cache-control')
      ) {
        return failure(403, 'Preflight is not allowed');
      }
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(),
          'access-control-allow-methods': [...METHODS].join(', '),
          'access-control-allow-headers': [...REQUEST_HEADERS, 'cache-control'].join(', '),
        },
      });
    }
    if (!METHODS.has(request.method)) return failure(405, 'Method is not allowed');
    if (pending.size >= MAX_REQUESTS) return failure(429, 'Too many active requests');
    const length = request.headers.get('content-length');
    if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_BODY_BYTES)) {
      return failure(413, 'Request body is too large');
    }
    const current = connection;
    const target = new URL(request.url);
    const headers = new Headers();
    for (const name of REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value !== null) {
        if (value.length > 4096) return failure(431, 'Request header is too large');
        headers.set(name, value);
      }
    }
    // Never forward browser Origin, Cookie, Authorization, Host or proxy headers.
    headers.set('cache-control', 'no-cache');
    if (current.token) headers.set('authorization', `Bearer ${current.token}`);
    const controller = new AbortController();
    let timer;
    let finished = false;
    let reader;
    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      pending.delete(cancel);
      request.signal.removeEventListener('abort', cancel);
    }
    function cancel() {
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
      finish();
    }
    function deadline(ms) {
      clearTimeout(timer);
      timer = setTimeout(cancel, ms);
      timer.unref?.();
    }
    pending.add(cancel);
    request.signal.addEventListener('abort', cancel, { once: true });
    if (request.signal.aborted) {
      cancel();
      return failure(502, 'Daemon request was cancelled');
    }
    deadline(15000);
    try {
      let body;
      if (request.body && request.method !== 'GET' && request.method !== 'HEAD') {
        let received = 0;
        body = request.body.pipeThrough(
          new TransformStream({
            transform(chunk, stream) {
              received += chunk.byteLength;
              if (received > MAX_BODY_BYTES) throw new Error('Request body is too large');
              stream.enqueue(chunk);
            },
          }),
        );
      }
      const upstream = await fetch(`${current.endpoint}${target.pathname}${target.search}`, {
        method: request.method,
        headers,
        body,
        ...(body ? { duplex: 'half' } : {}),
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
      });
      if (controller.signal.aborted || connection !== current || closed) {
        await upstream.body?.cancel();
        finish();
        return failure(502, 'Daemon request was cancelled');
      }
      // No redirect, cookies, authentication challenges, refresh or upstream CORS headers escape.
      if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304) {
        await upstream.body?.cancel();
        finish();
        return failure(502, 'Daemon redirects are not allowed');
      }
      const responseHeaders = new Headers(corsHeaders());
      for (const name of RESPONSE_HEADERS) {
        const value = upstream.headers.get(name);
        if (value !== null) responseHeaders.set(name, value);
      }
      if (
        !upstream.body ||
        request.method === 'HEAD' ||
        [204, 205, 304].includes(upstream.status)
      ) {
        await upstream.body?.cancel();
        finish();
        return new Response(null, { status: upstream.status, headers: responseHeaders });
      }
      reader = upstream.body.getReader();
      deadline(90000);
      const stream = new ReadableStream(
        {
          async pull(sink) {
            try {
              const result = await reader.read();
              if (controller.signal.aborted) throw new Error('Daemon request was cancelled');
              if (result.done) {
                finish();
                sink.close();
              } else {
                deadline(90000);
                sink.enqueue(result.value);
              }
            } catch {
              cancel();
              sink.error(new Error('Daemon stream ended unexpectedly'));
            }
          },
          cancel,
        },
        { highWaterMark: 65536, size: (chunk) => chunk.byteLength },
      );
      // fetch decompresses bodies; deliberately omit Content-Encoding and Content-Length.
      return new Response(stream, { status: upstream.status, headers: responseHeaders });
    } catch {
      cancel();
      return failure(502, 'Unable to reach daemon');
    }
  }

  function close() {
    closed = true;
    connection = undefined;
    abortPending();
  }

  return { connect, accepts, handle, close };
}

module.exports = { APP_ORIGIN, APP_URL, createDaemonProxy, isAppSender, normalizeEndpoint };
