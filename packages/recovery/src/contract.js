// Recovery is independently versioned; this is not the normal daemon protocol.
export const RECOVERY_VERSION = 1;
export function parseRecoveryStatus(value) {
  if (!value || value.recoveryVersion !== RECOVERY_VERSION)
    throw new TypeError('Unsupported recovery version');
  if (
    !['stopped', 'starting', 'running', 'stopping', 'failed'].includes(value.state) ||
    !/^[a-f0-9]{64}$/.test(value.baselineRevision) ||
    !(value.pid === null || (Number.isSafeInteger(value.pid) && value.pid > 0)) ||
    !(
      value.failure === null ||
      [
        'startup-failed',
        'readiness-timeout',
        'backend-exited',
        'backend-unavailable',
        'stop-failed',
      ].includes(value.failure)
    )
  )
    throw new TypeError('Invalid recovery status');
  return value;
}
