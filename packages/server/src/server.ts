import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyWebSocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CliOptions } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function createServer(options: CliOptions) {
  const fastify = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    },
  });

  // CORS
  await fastify.register(fastifyCors, { origin: true });

  // WebSocket
  await fastify.register(fastifyWebSocket);

  // Static files (dashboard) — only if built
  const dashboardPath = join(__dirname, '..', 'dashboard');
  if (existsSync(dashboardPath)) {
    await fastify.register(fastifyStatic, {
      root: dashboardPath,
      prefix: '/',
      decorateReply: true,
      maxAge: '30d',
      immutable: true,
    });

    // SPA catch-all: serve index.html for non-API, non-WS routes
    fastify.setNotFoundHandler(async (_request, reply) => {
      return reply.sendFile('index.html', dashboardPath, {
        maxAge: 0,
        immutable: false,
      });
    });
  }

  return fastify;
}
