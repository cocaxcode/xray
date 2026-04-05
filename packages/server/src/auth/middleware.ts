import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AuthState } from '../types.js';
import { validateToken } from './token.js';

/**
 * Registra el middleware de autenticacion para modo expose.
 * - /api/hook/* siempre pasa (hooks de Claude Code desde localhost)
 * - /api/auth/pin siempre pasa (intercambio de PIN por token)
 * - Todo lo demas requiere Bearer token valido
 */
export function registerAuthMiddleware(
  fastify: FastifyInstance,
  authState: AuthState
): void {
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.url;

    // Hook endpoints siempre pasan (vienen de Claude Code local)
    if (url.startsWith('/api/hook/')) return;

    // PIN exchange siempre pasa (el usuario aun no tiene token)
    if (url === '/api/auth/pin') return;

    // Health check siempre pasa (para monitoring y verificacion de tunel)
    if (url === '/api/health') return;

    // Dashboard HTML siempre pasa (la auth se hace en el frontend via PIN/QR)
    if (url === '/' || url.startsWith('/assets/')) return;

    // Static files (dashboard) y WebSocket necesitan auth
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
