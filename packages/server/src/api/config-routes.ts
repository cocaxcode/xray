import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { Queries } from '../db/queries.js';
import type { ServerWSEvent } from '../types.js';
import { getConfig, updateConfig } from '../db/config.js';

export function registerConfigRoutes(
  fastify: FastifyInstance,
  db: Database.Database,
  queries: Queries,
  broadcast: (event: ServerWSEvent) => void,
): void {
  // ── Get full config ──
  fastify.get('/api/config', async () => {
    return getConfig(db);
  });

  // ── Update config (partial merge) ──
  fastify.put('/api/config', async (request) => {
    const updates = request.body as Record<string, unknown>;
    updateConfig(db, updates);
    const newConfig = getConfig(db);

    // Broadcast config update to all connected dashboards
    broadcast({ type: 'config:updated', data: newConfig } as never);

    return newConfig;
  });

  // ── Dismiss session (mark as stopped immediately) ──
  fastify.post('/api/sessions/:id/dismiss', async (request, reply) => {
    const { id } = request.params as { id: string };

    if (!queries.sessionExists(id)) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    queries.updateSession(id, { status: 'stopped' });
    broadcast({ type: 'session:end', data: { id } });

    return { success: true };
  });

  // ── Delete session + all its data ──
  fastify.delete('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    if (!queries.sessionExists(id)) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    queries.deleteSession(id);
    broadcast({ type: 'session:end', data: { id } });

    return { success: true };
  });
}
