import { getDb } from './db/connection.js';
import { initSchema, purgeOldEvents, purgeOldSessions } from './db/schema.js';
import { initConfigTable, getConfig as getFullConfig } from './db/config.js';

function getConfigDomain(db: import('better-sqlite3').Database): string | null {
  const config = getFullConfig(db);
  return config.server.domain || null;
}
import { registerConfigRoutes } from './api/config-routes.js';
import { Queries } from './db/queries.js';
import { SessionManager } from './sessions/manager.js';
import { HookHandlers } from './hooks/handlers.js';
import { PermissionHandler } from './hooks/permission.js';
import { registerHookRoutes } from './hooks/router.js';
import { registerApiRoutes } from './api/routes.js';
import { registerWebSocket, createBroadcast } from './websocket.js';
import { registerAuthMiddleware } from './auth/middleware.js';
import { createAuthState } from './auth/token.js';
import { displayAuthInfo } from './auth/qr.js';
import { createServer } from './server.js';
import type { CliOptions, AuthState, ClientWSEvent } from './types.js';

export async function startServer(options: CliOptions): Promise<void> {
  // Init database
  const db = getDb();
  initSchema(db);
  initConfigTable(db);
  purgeOldEvents(db);
  purgeOldSessions(db);

  const queries = new Queries(db);
  const fastify = await createServer(options);

  // Create broadcast function
  const broadcast = createBroadcast(fastify);

  // Auth state (only in expose mode)
  let authState: AuthState | null = null;
  if (options.expose) {
    authState = createAuthState(options.authToken);
  }

  // Register auth middleware (expose mode only)
  if (authState) {
    registerAuthMiddleware(fastify, authState);
  }

  // Init managers
  const manager = new SessionManager(queries);
  const permissionHandler = new PermissionHandler(queries, broadcast);
  const handlers = new HookHandlers(manager, queries, broadcast);
  handlers.setPermissionHandler(permissionHandler);

  // Register WebSocket
  registerWebSocket(fastify, authState, (event: ClientWSEvent) => {
    fastify.log.info({ wsEvent: event }, 'WebSocket client message received');
    if (event.type === 'permission:resolve') {
      const resolved = permissionHandler.resolvePermission(event.data.id, event.data.decision);
      fastify.log.info({ permissionId: event.data.id, decision: event.data.decision, resolved }, 'Permission resolved');
    }
  });

  // Register routes
  registerHookRoutes(fastify, handlers, permissionHandler, manager, broadcast);
  registerApiRoutes(fastify, queries, manager, permissionHandler, authState);
  registerConfigRoutes(fastify, db, queries, broadcast);

  // Staleness check every 5 minutes
  const stalenessInterval = setInterval(() => {
    const staleIds = manager.markStaleSessions();
    for (const id of staleIds) {
      broadcast({ type: 'session:end', data: { id } });
    }
  }, 5 * 60 * 1000);

  // Start server
  const host = options.expose ? '0.0.0.0' : '127.0.0.1';
  try {
    await fastify.listen({ port: options.port, host });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  // Display auth info (expose mode)
  if (authState && authState.pin) {
    // Use custom domain for QR if provided, or fallback to config, or localhost
    const url = options.domain
      || getConfigDomain(db)
      || `http://localhost:${options.port}`;
    displayAuthInfo(url, authState.pin, authState.token);
  }

  console.log(`\n  xray corriendo en ${host}:${options.port}\n`);

  // Graceful shutdown
  const shutdown = async () => {
    clearInterval(stalenessInterval);
    permissionHandler.cleanup();
    await fastify.close();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
