import { PROTOCOL_VERSION } from '@hypir/protocol';
export type DaemonConnection = { endpoint: string; token: string };

export function normalizeEndpoint(value: string): string {
  const url = new URL(value.trim());
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Use an HTTP(S) daemon origin, without credentials, path, query or fragment.');
  }
  return url.origin;
}

export function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : 'url' in input ? input.url : input.toString();
}

export function daemonHeaders(connection: DaemonConnection): Record<string, string> {
  return connection.token ? { Authorization: `Bearer ${connection.token}` } : {};
}

// The Android host disables OkHttp redirects for fetch AND SSE. RN Android does
// not implement fetch's redirect option; the native policy is the security boundary.
function fetchWithScopedAuth(
  connection: DaemonConnection,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  accepts: (url: URL) => boolean,
  protocolVersion?: number,
): Promise<Response> {
  const url = new URL(requestUrl(input));
  const isDaemon = url.origin === connection.endpoint && accepts(url);
  const requestHeaders =
    typeof input === 'object' && 'headers' in input ? input.headers : undefined;
  const headers = new Headers(init?.headers ?? requestHeaders);
  if (isDaemon) {
    if (connection.token) headers.set('Authorization', `Bearer ${connection.token}`);
    headers.set('Cache-Control', 'no-cache');
    if (protocolVersion !== undefined) {
      headers.set('X-Hypir-Protocol-Version', String(protocolVersion));
    }
  } else if (connection.token && headers.get('Authorization') === `Bearer ${connection.token}`) {
    headers.delete('Authorization');
  }
  // Do not reconstruct the Request or consume/clone its body: retain native FormData,
  // multipart boundaries and the original Response for Hyperview's XML parser.
  return fetch(input, { ...init, headers, redirect: 'error' }).then((response) => {
    if (response.status >= 300 && response.status < 400) {
      throw new Error('Redirects are disabled to protect daemon credentials. Use the final URL.');
    }
    return response;
  });
}

export function fetchWithDaemonAuth(
  connection: DaemonConnection,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return fetchWithScopedAuth(
    connection,
    input,
    init,
    (url) =>
      url.pathname.startsWith('/api/') ||
      url.pathname === '/workspace' ||
      url.pathname.startsWith('/workspace/') ||
      url.pathname.startsWith('/apps/'),
    PROTOCOL_VERSION,
  );
}

export function fetchWithRecoveryAuth(
  connection: DaemonConnection,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return fetchWithScopedAuth(
    connection,
    input,
    init,
    (url) =>
      !url.search &&
      [
        '/recovery/v1/status',
        '/recovery/v1/start',
        '/recovery/v1/stop',
        '/recovery/v1/recover',
      ].includes(url.pathname),
  );
}
