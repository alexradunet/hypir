// Credentials are runtime inputs, never part of the persisted registration.
export function requireToken(value, name) {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(value))
    throw new Error(`${name} is required (1–4096 printable ASCII characters without spaces)`);
  return value;
}

export function validateCredentials({ recoveryToken, backendToken }) {
  requireToken(recoveryToken, 'HYPIR_RECOVERY_TOKEN');
  requireToken(backendToken, 'HYPIR_TOKEN');
  if (recoveryToken === backendToken)
    throw new Error('HYPIR_RECOVERY_TOKEN and HYPIR_TOKEN must be distinct');
}
