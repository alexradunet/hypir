export declare const RECOVERY_VERSION: 1;
export interface RecoveryStatus {
  recoveryVersion: 1;
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';
  baselineRevision: string;
  pid: number | null;
  failure:
    | 'startup-failed'
    | 'readiness-timeout'
    | 'backend-exited'
    | 'backend-unavailable'
    | 'stop-failed'
    | null;
}
export declare function parseRecoveryStatus(value: unknown): RecoveryStatus;
