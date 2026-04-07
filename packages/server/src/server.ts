import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyWebSocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
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
    bodyLimit: 102400, // 100KB max body (protege contra payloads enormes)
  });

  // CORS
  await fastify.register(fastifyCors, { origin: true });

  // WebSocket
  await fastify.register(fastifyWebSocket);

  // Static files: templates (served BEFORE dashboard to avoid SPA catch-all)
  const builtInTemplatesPath = join(__dirname, '..', 'templates');
  const communityTemplatesPath = join(homedir(), '.xray', 'templates');

  const templateRoots: string[] = [];
  if (existsSync(communityTemplatesPath)) templateRoots.push(communityTemplatesPath);
  if (existsSync(builtInTemplatesPath)) templateRoots.push(builtInTemplatesPath);

  if (templateRoots.length > 0) {
    await fastify.register(fastifyStatic, {
      root: templateRoots,
      prefix: '/templates/',
      decorateReply: false,
    });
  }

  // Static files (dashboard) — only if built
  const dashboardPath = join(__dirname, 'dashboard');
  if (existsSync(dashboardPath)) {
    await fastify.register(fastifyStatic, {
      root: dashboardPath,
      prefix: '/',
      decorateReply: true,
    });

    // Serve index.html with NO cache (so new builds load immediately)
    fastify.get('/', async (_request, reply) => {
      return reply.sendFile('index.html', dashboardPath, {
        maxAge: 0,
        immutable: false,
        cacheControl: false,
      });
    });

    // SPA catch-all: also no cache for index.html
    fastify.setNotFoundHandler(async (_request, reply) => {
      return reply.sendFile('index.html', dashboardPath, {
        maxAge: 0,
        immutable: false,
        cacheControl: false,
      });
    });
  }

  return fastify;
}
