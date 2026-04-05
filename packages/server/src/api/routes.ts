import type { FastifyInstance } from 'fastify';
import type { Queries } from '../db/queries.js';
import type { SessionManager } from '../sessions/manager.js';
import type { PermissionHandler } from '../hooks/permission.js';
import type { AuthState } from '../types.js';
import { validatePin, rotatePin } from '../auth/token.js';

export function registerApiRoutes(
  fastify: FastifyInstance,
  queries: Queries,
  manager: SessionManager,
  permissionHandler: PermissionHandler,
  authState: AuthState | null,
): void {
  // ── Projects (agrupados) ──
  fastify.get('/api/projects', async (request) => {
    const { include_stopped } = request.query as Record<string, string>;
    const projects = manager.getProjectGroups(include_stopped === 'true');

    let activeSessions = 0;
    let idleSessions = 0;
    let pendingPermissions = 0;

    for (const group of projects) {
      pendingPermissions += group.pendingPermissions;
      for (const session of group.sessions) {
        if (session.status === 'active' || session.status === 'waiting_permission' || session.status === 'waiting_input') {
          activeSessions++;
        } else if (session.status === 'idle') {
          idleSessions++;
        }
      }
    }

    return {
      projects,
      totals: {
        projects: projects.length,
        activeSessions,
        idleSessions,
        pendingPermissions,
      },
    };
  });

  // ── Session detail ──
  fastify.get('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = queries.getSession(id);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    return session;
  });

  // ── Session events (paginated) ──
  fastify.get('/api/sessions/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { page = '1', pageSize = '50' } = request.query as Record<string, string>;

    if (!queries.sessionExists(id)) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    return queries.getEventsBySession(id, parseInt(page), parseInt(pageSize));
  });

  // ── Session summary ──
  fastify.get('/api/sessions/:id/summary', async (request, reply) => {
    const { id } = request.params as { id: string };

    if (!queries.sessionExists(id)) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    return queries.getSessionSummary(id);
  });

  // ── Permission resolve ──
  fastify.post('/api/permissions/:id/resolve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { decision } = request.body as { decision: 'approve' | 'deny' };

    if (!decision || !['approve', 'deny'].includes(decision)) {
      return reply.status(400).send({ error: 'Invalid decision. Must be "approve" or "deny".' });
    }

    const resolved = permissionHandler.resolvePermission(parseInt(id), decision);
    return { success: resolved };
  });

  // ── Active pending permissions (only those with active deferred promises) ──
  fastify.get('/api/permissions/pending', async () => {
    return permissionHandler.getActivePending();
  });

  // ── PIN exchange (for remote auth) ──
  fastify.post('/api/auth/pin', async (request, reply) => {
    if (!authState) {
      return reply.status(404).send({ error: 'Auth not enabled (local mode)' });
    }

    const { pin } = request.body as { pin: string };
    if (!pin) {
      return reply.status(400).send({ error: 'PIN required' });
    }

    const token = validatePin(pin, authState);
    if (!token) {
      const isExpired = authState.pin && Date.now() > authState.pinExpiresAt;
      const message = isExpired
        ? 'PIN expirado. Ejecuta "cxc-xray pin" para generar uno nuevo.'
        : 'PIN incorrecto';
      return reply.status(401).send({ error: message });
    }

    return { token };
  });

  // ── PIN rotation (called by CLI `cxc-xray pin`) ──
  fastify.post('/api/auth/rotate-pin', async (_request, reply) => {
    if (!authState) {
      return reply.status(404).send({ error: 'Auth not enabled' });
    }

    const newState = rotatePin(authState);
    // Mutate in place (authState is shared reference)
    authState.pin = newState.pin;
    authState.pinExpiresAt = newState.pinExpiresAt;

    return { pin: newState.pin, expiresIn: '5 minutes' };
  });

  // ── Health ──
  fastify.get('/api/health', async () => {
    const projects = manager.getProjectGroups();
    let totalSessions = 0;
    for (const g of projects) totalSessions += g.sessions.length;

    return {
      status: 'ok',
      uptime: process.uptime(),
      sessions: totalSessions,
      version: '0.1.0',
    };
  });
}
