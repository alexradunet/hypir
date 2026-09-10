export declare const PROTOCOL_VERSION: 2;
export declare const eventTypes: Readonly<{
  connected: 'daemon.connected';
  workspaceChanged: 'workspace.changed';
  previewInvalidate: 'preview.invalidate';
}>;

export interface ProjectManifest {
  name: string;
  entrypoint: string;
  screens: string;
  capabilities?: string[];
}

export interface WorkspaceSnapshot {
  project: ProjectManifest;
  app: {
    id: string;
    kind: 'app';
    execution: 'active';
    name: string;
    projectRoot: string;
    entrypoint: string;
    unsupportedCapabilities: string[];
  };
  workspace: {
    id: 'hypir.workspace';
    kind: 'workspace';
    path: '/workspace';
    selectedAppId: string | null;
    revision: number;
  };
}

export interface DaemonStatus extends WorkspaceSnapshot {
  protocolVersion: 2;
  project: ProjectManifest;
  connectedClients: number;
}

type EventPayloads = {
  'daemon.connected': WorkspaceSnapshot;
  'workspace.changed': WorkspaceSnapshot;
  'preview.invalidate': { path: string; revision: number };
};

type EventOf<T extends keyof EventPayloads> = {
  version: 2;
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

export declare function validateManifest(value: unknown): value is ProjectManifest;

export declare const SHARED_HXML_CAPABILITIES: readonly string[];
export declare function unsupportedCapabilities(required?: string[]): string[];
