import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEvent,
  encodeSse,
  eventTypes,
  parseEvent,
  parseStatus,
  PROTOCOL_VERSION,
} from './index.js';

const project = { name: 'Preview', entrypoint: '/flows/start.xml', screens: 'ui/screens' };
const snapshot = {
  project,
  app: {
    id: 'test-app',
    kind: 'app',
    execution: 'active',
    name: project.name,
    projectRoot: '/tmp/project',
    entrypoint: '/apps/test-app/screens/flows/start.xml',
    unsupportedCapabilities: [],
  },
  workspace: {
    id: 'hypir.workspace',
    kind: 'workspace',
    path: '/workspace',
    selectedAppId: null,
    revision: 0,
  },
};

test('round trips typed events through SSE data and JSON parsers', () => {
  for (const event of [
    createEvent(eventTypes.connected, snapshot, 42),
    createEvent(eventTypes.previewInvalidate, { path: '/flows/start.xml', revision: 1 }, 43),
  ]) {
    const [typeLine, dataLine, ...separator] = encodeSse(event).split('\n');
    assert.equal(typeLine, `event: ${event.type}`);
    assert.deepEqual(parseEvent(dataLine.slice('data: '.length)), event);
    assert.deepEqual(separator, ['', '']);
  }
  assert.deepEqual(
    parseStatus({ protocolVersion: PROTOCOL_VERSION, ...snapshot, connectedClients: 2 }),
    {
      protocolVersion: PROTOCOL_VERSION,
      ...snapshot,
      connectedClients: 2,
    },
  );
});

test('rejects incompatible and malformed event envelopes or payloads', () => {
  const event = createEvent(eventTypes.previewInvalidate, { path: '/start.xml', revision: 1 }, 42);
  for (const invalid of [
    null,
    [],
    {},
    { ...event, version: PROTOCOL_VERSION + 1 },
    { ...event, type: 'unknown' },
    { ...event, timestamp: -1 },
    { ...event, timestamp: '42' },
    { ...event, payload: null },
    { ...event, payload: { path: '/start.xml' } },
    { ...event, payload: { path: '/start.xml', revision: -1 } },
    { ...event, payload: { path: '/start.xml', revision: 0.5 } },
    { ...event, payload: { path: '/../start.xml', revision: 1 } },
    { ...event, type: eventTypes.connected, payload: { project: 'old-schema' } },
  ]) {
    assert.throws(() => parseEvent(JSON.stringify(invalid)), TypeError);
    assert.throws(() => encodeSse(invalid), TypeError);
  }
  assert.throws(() => parseEvent('{'), TypeError);
  assert.throws(() => parseEvent(event), TypeError);
  assert.throws(() => createEvent(eventTypes.previewInvalidate, { path: '/start.xml' }), TypeError);
});

test('rejects unsafe or unusable project manifests in status and connection events', () => {
  const invalidProjects = [
    null,
    [],
    {},
    { ...project, name: '' },
    { ...project, name: 5 },
    { ...project, capabilities: 'text' },
    { ...project, capabilities: ['text', 'text'] },
    { ...project, screens: undefined },
    { ...project, screens: '/tmp/screens' },
    { ...project, screens: '../screens' },
    { ...project, screens: 'screens/../outside' },
    { ...project, screens: 'screens\\outside' },
    ...[
      'start.xml',
      '//start.xml',
      '/../start.xml',
      '/%2e%2e/start.xml',
      '/start.xml?x=1',
      '/start.xml#x',
      '/bad%.xml',
      '/start.json',
      '/%00.xml',
    ].map((entrypoint) => ({ ...project, entrypoint })),
  ];
  for (const invalid of invalidProjects) {
    assert.throws(
      () =>
        parseStatus({
          protocolVersion: PROTOCOL_VERSION,
          ...snapshot,
          project: invalid,
          connectedClients: 0,
        }),
      TypeError,
    );
    assert.throws(
      () => createEvent(eventTypes.connected, { ...snapshot, project: invalid }),
      TypeError,
    );
  }
  for (const invalid of [
    { protocolVersion: PROTOCOL_VERSION + 1, ...snapshot, connectedClients: 0 },
    { protocolVersion: PROTOCOL_VERSION, ...snapshot, connectedClients: -1 },
    { protocolVersion: PROTOCOL_VERSION, ...snapshot, connectedClients: '1' },
    {
      protocolVersion: PROTOCOL_VERSION,
      ...snapshot,
      connectedClients: Number.MAX_SAFE_INTEGER + 1,
    },
  ])
    assert.throws(() => parseStatus(invalid), TypeError);
});
