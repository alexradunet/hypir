export const PROTOCOL_VERSION = 2;

// Existing Hyperview element/behavior names supported by the shared hosts.
// This is a conservative rendering contract, not a sandbox or fidelity promise.
export const SHARED_HXML_CAPABILITIES = Object.freeze([
  'view',
  'text',
  'image',
  'list',
  'section-list',
  'text-field',
  'date-field',
  'picker-field',
  'option',
  'select-single',
  'select-multiple',
  'switch',
  'spinner',
  'form',
  'behavior',
  'navigator',
  'push',
  'back',
  'replace',
  'replace-inner',
  'reload',
  'append',
  'prepend',
]);
const capabilities = (value) =>
  Array.isArray(value) &&
  value.length <= 64 &&
  value.every((name) => typeof name === 'string' && /^[a-z][a-z0-9.-]{0,63}$/.test(name)) &&
  new Set(value).size === value.length;
export const unsupportedCapabilities = (required = []) =>
  required.filter((name) => !SHARED_HXML_CAPABILITIES.includes(name));

export const eventTypes = Object.freeze({
  connected: 'daemon.connected',
  workspaceChanged: 'workspace.changed',
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

export function validateManifest(value) {
  return (
    record(value) &&
    text(value.name) &&
    (value.capabilities === undefined || capabilities(value.capabilities)) &&
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

function snapshot(value) {
  return (
    record(value) &&
    validateManifest(value.project) &&
    record(value.app) &&
    text(value.app.id) &&
    /^[a-zA-Z0-9_-]+$/.test(value.app.id) &&
    value.app.kind === 'app' &&
    value.app.execution === 'active' &&
    value.app.name === value.project.name &&
    text(value.app.projectRoot) &&
    value.app.projectRoot.startsWith('/') &&
    capabilities(value.app.unsupportedCapabilities) &&
    JSON.stringify(value.app.unsupportedCapabilities) ===
      JSON.stringify(unsupportedCapabilities(value.project.capabilities)) &&
    value.app.entrypoint === `/apps/${value.app.id}/screens${value.project.entrypoint}` &&
    record(value.workspace) &&
    value.workspace.id === 'hypir.workspace' &&
    value.workspace.kind === 'workspace' &&
    value.workspace.path === '/workspace' &&
    (value.workspace.selectedAppId === null || value.workspace.selectedAppId === value.app.id) &&
    integer(value.workspace.revision)
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
  if (
    [eventTypes.connected, eventTypes.workspaceChanged].includes(event.type) &&
    snapshot(event.payload)
  )
    return event;
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
    !snapshot(value) ||
    !integer(value.connectedClients)
  ) {
    throw new TypeError('Invalid daemon status');
  }
  return value;
}
