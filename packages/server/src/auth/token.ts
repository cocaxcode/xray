import { randomBytes, randomInt } from 'node:crypto';
import type { AuthState } from '../types.js';

const PIN_TTL_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Genera un token criptograficamente seguro de 256 bits
 */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Genera un PIN numerico de 6 digitos
 */
export function generatePin(): string {
  return String(randomInt(100000, 999999));
}

/**
 * Crea un nuevo AuthState con token y PIN
 */
export function createAuthState(customToken?: string): AuthState {
  return {
    token: customToken || generateToken(),
    pin: generatePin(),
    pinExpiresAt: Date.now() + PIN_TTL_MS,
  };
}

/**
 * Valida un PIN contra el AuthState. Devuelve el token si es valido, null si no.
 */
export function validatePin(pin: string, state: AuthState): string | null {
  if (!state.pin) return null;
  if (Date.now() > state.pinExpiresAt) return null;
  if (pin !== state.pin) return null;
  return state.token;
}

/**
 * Rota el PIN sin cambiar el token. Las sesiones existentes no se ven afectadas.
 */
export function rotatePin(state: AuthState): AuthState {
  return {
    ...state,
    pin: generatePin(),
    pinExpiresAt: Date.now() + PIN_TTL_MS,
  };
}

/**
 * Valida un Bearer token
 */
export function validateToken(token: string, state: AuthState): boolean {
  return token === state.token;
}
