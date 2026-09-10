import assert from 'node:assert/strict';
import test from 'node:test';
import { createEvent, encodeSse, eventTypes, PROTOCOL_VERSION } from './index.js';

test('creates versioned events', () => {
  assert.deepEqual(createEvent(eventTypes.previewInvalidate, { path: 'index.xml' }, 42), {
    version: PROTOCOL_VERSION,
    type: 'preview.invalidate',
    timestamp: 42,
    payload: { path: 'index.xml' },
  });
});

test('rejects unknown event types', () => {
  assert.throws(() => createEvent('unknown', {}), /Unknown protocol event/);
});

test('encodes events for EventSource clients', () => {
  const event = createEvent(eventTypes.connected, { project: 'demo' }, 1);
  assert.match(encodeSse(event), /^event: daemon\.connected\ndata: .*\n\n$/);
});
