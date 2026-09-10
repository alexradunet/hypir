import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDaemon } from './server.js';

const example = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/hello-hyperview');

test('serves status and Hyperview XML', async (t) => {
  const daemon = await createDaemon({ projectRoot: example, port: 0 });
  const address = await daemon.listen();
  t.after(() => daemon.close());
  const base = `http://127.0.0.1:${address.port}`;
  const status = await (await fetch(`${base}/api/status`)).json();
  assert.equal(status.project.name, 'Hello Hyperview');
  const response = await fetch(`${base}/preview/index.xml`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /hyperview\+xml/);
  assert.match(await response.text(), /Hello from Hypir/);
});

test('blocks traversal outside the screens directory', async (t) => {
  const daemon = await createDaemon({ projectRoot: example, port: 0 });
  const address = await daemon.listen();
  t.after(() => daemon.close());
  const response = await fetch(`http://127.0.0.1:${address.port}/preview/%2e%2e%2fhyperview.json`);
  assert.equal(response.status, 400);
});
