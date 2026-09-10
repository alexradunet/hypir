import fs from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { isIP } from 'node:net';
import {
  createEvent,
  encodeSse,
  eventTypes,
  PROTOCOL_VERSION,
  unsupportedCapabilities,
} from '@hypir/protocol';
import { loadProject, readScreen } from './project.js';

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const digest = (text) => createHash('sha256').update(text).digest();

export function validateOptions({ host, port, token }) {
  if (typeof host !== 'string' || (host !== 'localhost' && !isIP(host)))
    throw new TypeError('Host must be an IP address or localhost');
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new TypeError('Port must be an integer between 0 and 65535');
  if (token !== undefined && (typeof token !== 'string' || !/^[\x21-\x7e]+$/u.test(token)))
    throw new TypeError('Token must be a nonempty printable ASCII string without spaces');
  const loopback =
    host === 'localhost' || host === '::1' || (isIP(host) === 4 && host.startsWith('127.'));
  if (!loopback && !token) throw new TypeError('A token is required when binding outside loopback');
}

function requestPath(req) {
  const authority = req.headers.host;
  if (authority !== undefined) {
    if (!/^(?:\[[\da-fA-F:.]+\]|[a-zA-Z0-9.-]+)(?::\d{1,5})?$/u.test(authority))
      throw new TypeError('Invalid request');
    new URL(`http://${authority}`);
  }
  if (
    !req.url?.startsWith('/') ||
    req.url.startsWith('//') ||
    /[\\#\u0000-\u0020\u007f]/u.test(req.url)
  )
    throw new TypeError('Invalid request');
  // Do not normalize dot segments: traversal must be rejected, not rerouted.
  return req.url.split('?', 1)[0];
}

export async function createDaemon({
  projectRoot,
  host = '127.0.0.1',
  port = 4747,
  token,
  onError = () => {},
}) {
  validateOptions({ host, port, token });
  const project = await loadProject(projectRoot);
  const authorization = token === undefined ? undefined : digest(`Bearer ${token}`);
  const appId = createHash('sha256').update(project.root).digest('hex');
  const app = {
    id: appId,
    kind: 'app',
    execution: 'active',
    name: project.manifest.name,
    unsupportedCapabilities: unsupportedCapabilities(project.manifest.capabilities),
    projectRoot: project.root,
    entrypoint: `/apps/${appId}/screens${project.manifest.entrypoint}`,
  };
  const workspace = {
    id: 'hypir.workspace',
    kind: 'workspace',
    path: '/workspace',
    selectedAppId: null,
    revision: 0,
  };
  const snapshot = () => ({ project: project.manifest, app, workspace: { ...workspace } });
  const escapeXml = (value) =>
    String(value).replace(
      /[<>&"']/g,
      (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c],
    );
  const hxml = (res, contents, context) => {
    res.writeHead(200, {
      'content-type': 'application/vnd.hyperview+xml; charset=utf-8',
      'cache-control': 'no-store',
      'x-hypir-context': context,
    });
    res.end(contents);
  };
  const workspaceContent =
    () => `<view xmlns="https://hyperview.org/hyperview" id="workspace-content">
    <text style="title">Development workspace</text>
    <text>${escapeXml(app.name)}</text><text>Project: ${escapeXml(project.root)}</text>
    <text>Identity: ${appId}</text><text>Entrypoint: ${escapeXml(project.manifest.entrypoint)}</text>
    <text>Context: active app (static HXML)</text>
    <text>Required capabilities: ${escapeXml((project.manifest.capabilities ?? []).join(', ') || 'basic HXML')}</text>
    ${app.unsupportedCapabilities.length ? `<text>Unsupported capabilities: ${escapeXml(app.unsupportedCapabilities.join(', '))}. This app cannot be opened with the shared host capabilities.</text>` : ''}
    ${!authorization ? '<text>Project selection requires a daemon token. Restart with HYPIR_TOKEN and reconnect.</text>' : ''}
    <text style="link" href="/workspace/select/${appId}" verb="post" action="replace" target="workspace-content">Select project</text>
    ${workspace.selectedAppId ? `<text style="link" href="${escapeXml(app.entrypoint)}" action="push">Open application</text>` : ''}
    </view>`;
  const workspaceScreen =
    () => `<doc xmlns="https://hyperview.org/hyperview"><screen id="workspace">
    <styles><style id="page" padding="24"/><style id="title" fontSize="26" fontWeight="700"/><style id="link" color="#41630b" padding="12"/></styles>
    <body style="page" scroll="true">${workspaceContent()}</body></screen></doc>`;
  const clients = new Set();
  const sockets = new Set();
  const requests = new Set();
  let revision = 0;
  let watcher;
  let heartbeat;
  let closing;
  let listening = false;
  let starting;
  let failure;

  const send = (client, frame) => {
    if (client.destroyed || client.writableLength > 65536 || !client.write(frame)) {
      clients.delete(client);
      client.destroy();
    }
  };
  const broadcast = (event) => {
    const frame = encodeSse(event);
    for (const client of clients) send(client, frame);
  };

  const handleRequest = async (req, res) => {
    let pathname;
    try {
      pathname = requestPath(req);
    } catch {
      return json(res, 400, { error: 'Invalid request' });
    }
    if (req.headers.origin !== undefined)
      return json(res, 403, { error: 'Browser origins are not allowed' });
    if (authorization && !timingSafeEqual(authorization, digest(req.headers.authorization ?? ''))) {
      res.setHeader('www-authenticate', 'Bearer');
      return json(res, 401, { error: 'Unauthorized' });
    }
    if (req.method === 'GET' && pathname === '/api/status') {
      return json(res, 200, {
        protocolVersion: PROTOCOL_VERSION,
        ...snapshot(),
        connectedClients: clients.size,
      });
    }
    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      clients.add(res);
      res.on('close', () => clients.delete(res));
      send(res, encodeSse(createEvent(eventTypes.connected, snapshot())));
      return;
    }
    if (req.method === 'GET' && pathname === '/workspace/navigation') {
      return hxml(
        res,
        '<doc xmlns="https://hyperview.org/hyperview"><navigator id="workspace-stack" type="stack"><nav-route id="workspace" href="/workspace" /></navigator></doc>',
        'workspace',
      );
    }
    if (req.method === 'GET' && pathname === '/workspace')
      return hxml(res, workspaceScreen(), 'workspace');
    if (req.method === 'POST' && pathname.startsWith('/workspace/select/')) {
      if (!authorization)
        return json(res, 401, { error: 'Configure a daemon token to select a project' });
      if (req.headers['x-hypir-protocol-version'] !== String(PROTOCOL_VERSION))
        return json(res, 409, { error: 'Incompatible mutation protocol version' });
      if (pathname !== `/workspace/select/${appId}` || req.url.includes('?'))
        return json(res, 400, { error: 'Unknown registered project' });
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 0) return json(res, 400, { error: 'This action does not accept a payload' });
      }
      if (app.unsupportedCapabilities.length)
        return json(res, 422, {
          error: 'Unsupported capabilities',
          capabilities: app.unsupportedCapabilities,
        });
      await readScreen(project, project.manifest.entrypoint.slice(1));
      workspace.selectedAppId = appId;
      workspace.revision += 1;
      broadcast(createEvent(eventTypes.workspaceChanged, snapshot()));
      return hxml(res, workspaceContent(), 'workspace');
    }
    const appPrefix = `/apps/${appId}/screens/`;
    if (req.method === 'GET' && pathname.startsWith(appPrefix)) {
      if (app.unsupportedCapabilities.length)
        return json(res, 422, {
          error: 'Unsupported capabilities',
          capabilities: app.unsupportedCapabilities,
        });
      try {
        const contents = await readScreen(project, pathname.slice(appPrefix.length));
        if (res.destroyed) return;
        return hxml(res, contents, 'app:active');
      } catch (error) {
        if (res.destroyed) return;
        return json(res, error.code === 'ENOENT' ? 404 : 400, {
          error: error.code === 'ENOENT' ? 'Screen not found' : 'Invalid screen path',
        });
      }
    }
    json(res, 404, { error: 'Not found' });
  };

  const server = http.createServer((req, res) => {
    res.on('error', () => res.destroy());
    if (closing) return res.destroy();
    const request = handleRequest(req, res)
      .catch(() => {
        if (!res.headersSent && !res.destroyed) json(res, 500, { error: 'Request failed' });
        else res.destroy();
      })
      .finally(() => requests.delete(request));
    requests.add(request);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
  });
  server.on('clientError', (_error, socket) => {
    socket.destroy();
  });

  function close() {
    if (closing) return closing;
    closing = (async () => {
      clearInterval(heartbeat);
      watcher?.close();
      // Wait for an in-flight bind before closing so shutdown cannot leave a
      // late-listening server behind. listen() failure also enters this path.
      await starting?.catch(() => {});
      const stopped = new Promise((resolve) => server.close(() => resolve()));
      for (const client of clients) client.destroy();
      clients.clear();
      for (const socket of sockets) socket.destroy();
      await stopped;
      await Promise.allSettled([...requests]);
      await project.directory.close();
    })();
    return closing;
  }

  const fail = (error) => {
    if (failure || closing) return;
    failure = error;
    void close().then(
      () => onError(error),
      () => onError(new Error('Daemon shutdown failed')),
    );
  };
  server.on('error', (error) => {
    if (listening) fail(error);
  });

  try {
    watcher = fs.watch(
      `/proc/self/fd/${project.directory.fd}`,
      { recursive: true },
      (_kind, filename) => {
        if (closing) return;
        // Missing names and directory renames can affect whole XML subtrees.
        // Reload the entrypoint when a change has no individual XML pathname.
        const name = filename == null ? null : String(filename);
        if (
          name !== null &&
          name
            .split('/')
            .some(
              (part) =>
                !part || part === '.' || part === '..' || /[\\\u0000-\u001f\u007f]/u.test(part),
            )
        )
          return;
        const changedPath = name?.endsWith('.xml')
          ? `/${name.split('/').map(encodeURIComponent).join('/')}`
          : project.manifest.entrypoint;
        broadcast(
          createEvent(eventTypes.previewInvalidate, { path: changedPath, revision: ++revision }),
        );
      },
    );
    watcher.on('error', fail);
    heartbeat = setInterval(() => {
      for (const client of clients) send(client, ': heartbeat\n\n');
    }, 15000);
    heartbeat.unref();
  } catch (error) {
    await close();
    throw error;
  }

  return {
    project,
    async listen() {
      if (closing || starting) throw new Error('Daemon is already started or closed');
      starting = new Promise((resolve, reject) => {
        const failed = (error) => {
          server.off('listening', started);
          reject(error);
        };
        const started = () => {
          server.off('error', failed);
          listening = true;
          resolve();
        };
        server.once('error', failed);
        server.once('listening', started);
        server.listen(port, host);
      });
      try {
        await starting;
        if (closing) throw new Error('Daemon closed during startup');
        return server.address();
      } catch (error) {
        await close();
        throw error;
      }
    },
    close,
  };
}
