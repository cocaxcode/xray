import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AuthState } from '../types.js';
import { validateToken } from './token.js';

// Rate limiting para PIN
const pinAttempts = new Map<string, { count: number; firstAttempt: number; lockedUntil?: number }>();
const MAX_PIN_ATTEMPTS = 5;
const PIN_WINDOW_MS = 5 * 60 * 1000;      // 5 min
const PIN_LOCKOUT_MS = 15 * 60 * 1000;    // 15 min lockout

function checkPinRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = pinAttempts.get(ip);

  if (record) {
    if (record.lockedUntil && now < record.lockedUntil) {
      return { allowed: false, retryAfter: Math.ceil((record.lockedUntil - now) / 1000) };
    }
    if (now - record.firstAttempt > PIN_WINDOW_MS) {
      pinAttempts.delete(ip);
    }
  }

  return { allowed: true };
}

export function recordFailedPinAttempt(ip: string): void {
  const now = Date.now();
  const record = pinAttempts.get(ip) || { count: 0, firstAttempt: now };
  record.count++;

  if (record.count >= MAX_PIN_ATTEMPTS) {
    record.lockedUntil = now + PIN_LOCKOUT_MS;
  }

  pinAttempts.set(ip, record);
}

export function clearPinAttempts(ip: string): void {
  pinAttempts.delete(ip);
}

/**
 * Registra el middleware de autenticacion para modo expose.
 */
export function registerAuthMiddleware(
  fastify: FastifyInstance,
  authState: AuthState
): void {
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.url;

    // Hook endpoints: solo aceptar de localhost (Claude Code corre local)
    // Incluye /api/hook/* (hooks nativos) y /hooks/* (token-optimizer)
    if (url.startsWith('/api/hook/') || url.startsWith('/hooks/')) {
      const ip = request.ip;
      const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
      if (!isLocal) {
        return reply.status(403).send({ error: 'Hooks only accepted from localhost' });
      }
      return;
    }

    // PIN exchange: rate limiting
    if (url === '/api/auth/pin') {
      const ip = request.ip;
      const { allowed, retryAfter } = checkPinRateLimit(ip);
      if (!allowed) {
        return reply.status(429).send({ error: 'Demasiados intentos. Reintenta en ' + retryAfter + 's' });
      }
      return;
    }

    // Health check siempre pasa
    if (url === '/api/health') return;

    // Acceso local no requiere auth (solo remoto)
    // Si hay X-Forwarded-For, viene de un proxy/tunel → es remoto
    const forwarded = request.headers['x-forwarded-for'];
    if (!forwarded) {
      const ip = request.ip;
      const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
      if (isLocal) return;
    }

    // Dashboard HTML/assets/templates siempre pasan (auth via PIN/QR en el frontend)
    // url puede ser / o /?auth=TOKEN (QR scan)
    if (url === '/' || url.startsWith('/?') || url.startsWith('/assets/') || url.startsWith('/templates/')) return;

    // WebSocket pasa (tiene su propia validacion de token)
    if (url.startsWith('/ws')) return;

    // Todo lo demas requiere Bearer token
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const token = authHeader.slice(7);
    if (!validateToken(token, authState)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });
}
