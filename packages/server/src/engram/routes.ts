import type { FastifyInstance } from 'fastify';
import { engramClient } from './client.js';

export function registerEngramRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/engram/status', async () => {
    return await engramClient.status();
  });

  fastify.get('/api/engram/facets', async (_req, reply) => {
    const status = await engramClient.status();
    if (!status.available) return reply.status(503).send({ error: status.reason });
    return engramClient.facets();
  });

  fastify.get('/api/engram/observations', async (request, reply) => {
    const status = await engramClient.status();
    if (!status.available) return reply.status(503).send({ error: status.reason });
    const q = request.query as Record<string, string>;
    return engramClient.searchObservations({
      query: q.q,
      project: q.project,
      type: q.type,
      scope: q.scope,
      session_id: q.session_id,
      from: q.from,
      to: q.to,
      limit: q.limit ? parseInt(q.limit) : undefined,
      offset: q.offset ? parseInt(q.offset) : undefined,
    });
  });

  fastify.get('/api/engram/observations/:id', async (request, reply) => {
    const status = await engramClient.status();
    if (!status.available) return reply.status(503).send({ error: status.reason });
    const { id } = request.params as { id: string };
    const obs = engramClient.getObservation(parseInt(id));
    if (!obs) return reply.status(404).send({ error: 'Observation not found' });
    return obs;
  });

  fastify.get('/api/engram/sessions', async (request, reply) => {
    const status = await engramClient.status();
    if (!status.available) return reply.status(503).send({ error: status.reason });
    const q = request.query as Record<string, string>;
    return engramClient.listSessions({
      project: q.project,
      limit: q.limit ? parseInt(q.limit) : undefined,
      offset: q.offset ? parseInt(q.offset) : undefined,
    });
  });

  fastify.get('/api/engram/prompts', async (request, reply) => {
    const status = await engramClient.status();
    if (!status.available) return reply.status(503).send({ error: status.reason });
    const q = request.query as Record<string, string>;
    return engramClient.listPrompts({
      project: q.project,
      session_id: q.session_id,
      query: q.q,
      limit: q.limit ? parseInt(q.limit) : undefined,
      offset: q.offset ? parseInt(q.offset) : undefined,
    });
  });

  fastify.get('/api/engram/timeline', async (request, reply) => {
    const status = await engramClient.status();
    if (!status.available) return reply.status(503).send({ error: status.reason });
    const q = request.query as Record<string, string>;
    return {
      points: engramClient.timeline({
        project: q.project,
        days: q.days ? parseInt(q.days) : undefined,
      }),
    };
  });

  fastify.get('/api/engram/topics', async (request, reply) => {
    const status = await engramClient.status();
    if (!status.available) return reply.status(503).send({ error: status.reason });
    const q = request.query as Record<string, string>;
    return {
      items: engramClient.topicKeys({
        project: q.project,
        limit: q.limit ? parseInt(q.limit) : undefined,
      }),
    };
  });
}
