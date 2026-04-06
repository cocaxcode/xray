import type { FastifyInstance } from 'fastify';
import type { WebSocket, RawData } from 'ws';
import type { ServerWSEvent, ClientWSEvent, AuthState } from './types.js';
import { validateToken } from './auth/token.js';

export function registerWebSocket(
  fastify: FastifyInstance,
  authState: AuthState,
  onClientMessage: (event: ClientWSEvent) => void
): void {
  fastify.get('/ws', { websocket: true }, (socket: WebSocket, request) => {
    // Auth validation — bypass para conexiones locales sin proxy
    const forwarded = request.headers['x-forwarded-for'];
    const ip = request.ip;
    const isLocal = !forwarded && (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1');
    if (!isLocal) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const token = url.searchParams.get('token');
      if (!token || !validateToken(token, authState)) {
        socket.close(4001, 'Unauthorized');
        return;
      }
    }

    fastify.log.info(`WebSocket client connected (total: ${fastify.websocketServer.clients.size})`);

    socket.on('message', (data: RawData) => {
      try {
        const event = JSON.parse(data.toString()) as ClientWSEvent;
        onClientMessage(event);
      } catch {
        fastify.log.warn('Invalid WebSocket message received');
      }
    });

    socket.on('close', () => {
      fastify.log.info(`WebSocket client disconnected (total: ${fastify.websocketServer.clients.size})`);
    });
  });
}

/**
 * Broadcast un evento a todos los clientes WebSocket conectados
 */
export function createBroadcast(fastify: FastifyInstance): (event: ServerWSEvent) => void {
  return (event: ServerWSEvent) => {
    if (!fastify.websocketServer) return;
    const message = JSON.stringify(event);
    for (const client of fastify.websocketServer.clients) {
      if (client.readyState === 1) { // OPEN
        client.send(message);
      }
    }
  };
}
