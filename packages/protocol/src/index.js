export const PROTOCOL_VERSION = 1;

export const eventTypes = Object.freeze({
  connected: 'daemon.connected',
  previewInvalidate: 'preview.invalidate',
  diagnostic: 'hxml.diagnostic',
});

export function createEvent(type, payload, now = Date.now()) {
  if (!Object.values(eventTypes).includes(type)) {
    throw new TypeError(`Unknown protocol event: ${type}`);
  }
  return { version: PROTOCOL_VERSION, type, timestamp: now, payload };
}

export function encodeSse(event) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
