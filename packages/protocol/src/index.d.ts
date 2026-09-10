export declare const PROTOCOL_VERSION: 1;
export declare const eventTypes: Readonly<{
  connected: 'daemon.connected';
  previewInvalidate: 'preview.invalidate';
}>;

export interface ProjectManifest {
  name: string;
  entrypoint: string;
  screens: string;
}

export interface DaemonStatus {
  protocolVersion: 1;
  project: ProjectManifest;
  connectedClients: number;
}

type EventPayloads = {
  'daemon.connected': { project: ProjectManifest };
  'preview.invalidate': { path: string; revision: number };
};

type EventOf<T extends keyof EventPayloads> = {
  version: 1;
  type: T;
  timestamp: number;
  payload: EventPayloads[T];
};

export type DaemonEvent = {
  [T in keyof EventPayloads]: EventOf<T>;
}[keyof EventPayloads];

export declare function createEvent<T extends keyof EventPayloads>(
  type: T,
  payload: EventPayloads[T],
  now?: number,
): EventOf<T>;
export declare function encodeSse(event: DaemonEvent): string;
/** Throws TypeError for malformed JSON or unsupported event envelopes/payloads. */
export declare function parseEvent(json: string): DaemonEvent;
/** Throws TypeError for incompatible versions or invalid manifest/status fields. */
export declare function parseStatus(value: unknown): DaemonStatus;
