import { describe, expect, it } from 'vitest';
import { checkPassword, checkPin } from '../src/shared/secret-rules';

describe('checkPin', () => {
  it('requires exactly 6 digits', () => {
    expect(checkPin('12345')).toBe('pin_format');
    expect(checkPin('1234567')).toBe('pin_format');
    expect(checkPin('12a456')).toBe('pin_format');
  });
  it('refuses repeats, runs and frequent PINs', () => {
    for (const pin of ['000000', '111111', '123456', '654321', '890123', '210987', '123123', '121212', '112233']) {
      expect(checkPin(pin), pin).toBe('pin_too_simple');
    }
  });
  it('accepts an ordinary PIN', () => {
    expect(checkPin('482913')).toBeNull();
    expect(checkPin('305718')).toBeNull();
  });
});

describe('checkPassword', () => {
  it('needs at least 10 characters', () => {
    expect(checkPassword('short')).toBe('password_too_short');
    expect(checkPassword('dziesiecznakow')).toBeNull();
  });
});
