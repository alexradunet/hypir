export const PROTOCOL_VERSION = 1;

export const eventTypes = Object.freeze({
  connected: 'daemon.connected',
  previewInvalidate: 'preview.invalidate',
});

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const text = (value) => typeof value === 'string' && value.trim().length > 0;

function screenPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || /[?#\\\u0000-\u0020]/u.test(value))
    return false;
  try {
    const parts = decodeURIComponent(value).slice(1).split('/');
    return (
      parts.every(
        (part) => part && part !== '.' && part !== '..' && !/[\\\u0000-\u001f\u007f]/u.test(part),
      ) && parts.at(-1).endsWith('.xml')
    );
  } catch {
    return false;
  }
}

function manifest(value) {
  return (
    record(value) &&
    text(value.name) &&
    screenPath(value.entrypoint) &&
    text(value.screens) &&
    !value.screens.startsWith('/') &&
    value.screens
      .split('/')
      .every(
        (part) => part && part !== '.' && part !== '..' && !/[\\\u0000-\u001f\u007f]/u.test(part),
      )
  );
}

function validateEvent(event) {
  if (
    !record(event) ||
    event.version !== PROTOCOL_VERSION ||
    !integer(event.timestamp) ||
    !record(event.payload)
  ) {
    throw new TypeError('Invalid protocol event');
  }
  if (event.type === eventTypes.connected && manifest(event.payload.project)) return event;
  if (
    event.type === eventTypes.previewInvalidate &&
    screenPath(event.payload.path) &&
    integer(event.payload.revision)
  )
    return event;
  throw new TypeError('Invalid protocol event');
}

export function createEvent(type, payload, now = Date.now()) {
  return validateEvent({ version: PROTOCOL_VERSION, type, timestamp: now, payload });
}

export function encodeSse(event) {
  validateEvent(event);
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function parseEvent(json) {
  if (typeof json !== 'string') throw new TypeError('Invalid protocol event');
  try {
    return validateEvent(JSON.parse(json));
  } catch {
    throw new TypeError('Invalid protocol event');
  }
}

export function parseStatus(value) {
  if (
    !record(value) ||
    value.protocolVersion !== PROTOCOL_VERSION ||
    !manifest(value.project) ||
    !integer(value.connectedClients)
  ) {
    throw new TypeError('Invalid daemon status');
  }
  return value;
}
