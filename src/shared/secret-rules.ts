import { AUTH } from './constants';

export type SecretProblem = 'pin_format' | 'pin_too_simple' | 'password_too_short';

/** Frequent PINs that are refused in addition to repeats and runs. */
const COMMON_PINS = new Set([
  '123123', '121212', '112233', '111222', '101010', '696969', '131313', '159753', '147258', '102030',
  '123321', '000123', '123000', '789456', '456789', '147369', '258369', '212121',
]);

function isRun(pin: string, step: number): boolean {
  for (let i = 1; i < pin.length; i++) {
    if ((Number(pin[i]) - Number(pin[i - 1]) + 10) % 10 !== (step + 10) % 10) return false;
  }
  return true;
}

/** PIN: exactly 6 digits, not 000000/111111…, not 123456/654321 (with wrap), not a frequent PIN. */
export function checkPin(pin: string): SecretProblem | null {
  if (!new RegExp(`^\\d{${AUTH.pinLength}}$`).test(pin)) return 'pin_format';
  if (/^(\d)\1+$/.test(pin) || isRun(pin, 1) || isRun(pin, -1) || COMMON_PINS.has(pin)) return 'pin_too_simple';
  return null;
}

export function checkPassword(password: string): SecretProblem | null {
  return password.length < AUTH.passwordMinLength ? 'password_too_short' : null;
}

export function checkSecret(kind: 'pin' | 'password', secret: string): SecretProblem | null {
  return kind === 'pin' ? checkPin(secret) : checkPassword(secret);
}
