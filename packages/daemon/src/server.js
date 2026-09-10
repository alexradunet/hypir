import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createEvent, encodeSse, eventTypes, PROTOCOL_VERSION } from '../../protocol/src/index.js';
import { loadProject, resolveScreen } from './project.js';

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
};

export async function createDaemon({ projectRoot, host = '127.0.0.1', port = 4747 }) {
  const project = await loadProject(projectRoot);
  const clients = new Set();
  const broadcast = (event) => clients.forEach((client) => client.write(encodeSse(event)));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? `${host}:${port}`}`);
    if (req.method === 'GET' && url.pathname === '/api/status') {
      return json(res, 200, { protocolVersion: PROTOCOL_VERSION, project: project.manifest, connectedClients: clients.size });
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': '*' });
      clients.add(res);
      res.write(encodeSse(createEvent(eventTypes.connected, { project: project.manifest.name })));
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/preview/')) {
      try {
        const contents = await readFile(resolveScreen(project, url.pathname.slice('/preview/'.length)), 'utf8');
        res.writeHead(200, { 'content-type': 'application/vnd.hyperview+xml; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
        return res.end(contents);
      } catch (error) {
        return json(res, error.code === 'ENOENT' ? 404 : 400, { error: error.message });
      }
    }
    json(res, 404, { error: 'Not found' });
  });

  const watcher = watch(project.screens, { recursive: true }, (_kind, filename) => {
    if (filename?.endsWith('.xml')) broadcast(createEvent(eventTypes.previewInvalidate, { path: filename, revision: Date.now() }));
  });

  return {
    project,
    async listen() { await new Promise((resolve, reject) => server.listen(port, host, resolve).once('error', reject)); return server.address(); },
    async close() { watcher.close(); clients.forEach((client) => client.end()); await new Promise((resolve) => server.close(resolve)); },
  };
}
