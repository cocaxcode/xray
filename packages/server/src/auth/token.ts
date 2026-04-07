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
 * Crea un nuevo AuthState con token y PIN.
 * Si se pasa una DB, intenta reutilizar el token persistido.
 * Si no existe, genera uno nuevo y lo guarda.
 */
export function createAuthState(customToken?: string, db?: import('better-sqlite3').Database): AuthState {
  let token = customToken;

  if (!token && db) {
    // Try to load persisted token
    try {
      const row = db.prepare('SELECT value FROM config WHERE key = ?').get('auth.token') as { value: string } | undefined;
      if (row?.value) {
        token = row.value;
      }
    } catch {
      // Config table might not exist yet
    }
  }

  if (!token) {
    token = generateToken();
  }

  // Persist token to DB for reuse across restarts
  if (db) {
    try {
      db.prepare(
        "INSERT INTO config (key, value, updated_at) VALUES ('auth.token', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')"
      ).run(token, token);
    } catch {
      // Config table might not exist yet
    }
  }

  return {
    token,
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
