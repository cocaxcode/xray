import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateToken,
  generatePin,
  createAuthState,
  validatePin,
  rotatePin,
  validateToken,
} from '../auth/token.js';

describe('generateToken', () => {
  it('should generate a 64-char hex string (256 bits)', () => {
    const token = generateToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should generate unique tokens', () => {
    const t1 = generateToken();
    const t2 = generateToken();
    expect(t1).not.toBe(t2);
  });
});

describe('generatePin', () => {
  it('should generate a 6-digit numeric string', () => {
    const pin = generatePin();
    expect(pin).toMatch(/^\d{6}$/);
  });

  it('should generate values between 100000 and 999999', () => {
    for (let i = 0; i < 100; i++) {
      const pin = parseInt(generatePin());
      expect(pin).toBeGreaterThanOrEqual(100000);
      expect(pin).toBeLessThanOrEqual(999999);
    }
  });
});

describe('createAuthState', () => {
  it('should auto-generate token and pin', () => {
    const state = createAuthState();
    expect(state.token).toMatch(/^[a-f0-9]{64}$/);
    expect(state.pin).toMatch(/^\d{6}$/);
    expect(state.pinExpiresAt).toBeGreaterThan(Date.now());
  });

  it('should accept custom token', () => {
    const state = createAuthState('myCustomToken');
    expect(state.token).toBe('myCustomToken');
    expect(state.pin).toMatch(/^\d{6}$/);
  });
});

describe('validatePin', () => {
  it('should return token for valid pin', () => {
    const state = createAuthState();
    const result = validatePin(state.pin!, state);
    expect(result).toBe(state.token);
  });

  it('should return null for wrong pin', () => {
    const state = createAuthState();
    const result = validatePin('000000', state);
    expect(result).toBeNull();
  });

  it('should return null for expired pin', () => {
    const state = createAuthState();
    state.pinExpiresAt = Date.now() - 1000; // Expired
    const result = validatePin(state.pin!, state);
    expect(result).toBeNull();
  });

  it('should return null when pin is null', () => {
    const state = createAuthState();
    state.pin = null;
    const result = validatePin('123456', state);
    expect(result).toBeNull();
  });
});

describe('rotatePin', () => {
  it('should generate a new pin', () => {
    const state = createAuthState();
    const oldPin = state.pin;
    const newState = rotatePin(state);

    // Pin should be different (very high probability)
    // Token should remain the same
    expect(newState.token).toBe(state.token);
    expect(newState.pinExpiresAt).toBeGreaterThan(Date.now());
  });

  it('should not modify the original state', () => {
    const state = createAuthState();
    const oldToken = state.token;
    const oldPin = state.pin;

    rotatePin(state);

    expect(state.token).toBe(oldToken);
    expect(state.pin).toBe(oldPin);
  });
});

describe('validateToken', () => {
  it('should return true for matching token', () => {
    const state = createAuthState();
    expect(validateToken(state.token, state)).toBe(true);
  });

  it('should return false for wrong token', () => {
    const state = createAuthState();
    expect(validateToken('wrong', state)).toBe(false);
  });
});
