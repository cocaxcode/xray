import type { FastifyInstance } from 'fastify';
import type { HookHandlers } from './handlers.js';
import type { PermissionHandler } from './permission.js';
import type { SessionManager } from '../sessions/manager.js';

export function registerHookRoutes(
  fastify: FastifyInstance,
  handlers: HookHandlers,
  permissionHandler: PermissionHandler,
  manager: SessionManager,
): void {
  // Todas las rutas de hooks reciben POST

  fastify.post('/api/hook/session-start', async (request) => {
    const payload = request.body as Record<string, unknown>;
    handlers.handleSessionStart(payload as never);
    return {};
  });

  fastify.post('/api/hook/session-end', async (request) => {
    const payload = request.body as Record<string, unknown>;
    handlers.handleSessionEnd(payload.session_id as string);
    return {};
  });

  fastify.post('/api/hook/pre-tool-use', async (request) => {
    const payload = request.body as Record<string, unknown>;
    handlers.handlePreToolUse(payload as never);
    return {};
  });

  fastify.post('/api/hook/post-tool-use', async (request) => {
    const payload = request.body as Record<string, unknown>;
    handlers.handlePostToolUse(payload as never);
    return {};
  });

  fastify.post('/api/hook/post-tool-use-failure', async (request) => {
    const payload = request.body as Record<string, unknown>;
    handlers.handlePostToolUseFailure(payload as never);
    return {};
  });

  // PermissionRequest — SINCRONO: mantiene la conexion abierta
  fastify.post('/api/hook/permission-request', async (request) => {
    const payload = request.body as Record<string, unknown>;

    // Transition session to waiting_permission
    manager.transitionTo(payload.session_id as string, 'waiting_permission');

    // Await user decision (up to 9 min)
    const response = await permissionHandler.handlePermissionRequest(
      payload.session_id as string,
      payload.tool_name as string,
      (payload.tool_input as Record<string, unknown>) ?? {},
    );

    // Restore session to active
    manager.transitionTo(payload.session_id as string, 'active');

    return response;
  });

  fastify.post('/api/hook/notification', async (request) => {
    const payload = request.body as Record<string, unknown>;
    handlers.handleNotification(payload as never);
    return {};
  });

  fastify.post('/api/hook/subagent-start', async (request) => {
    const payload = request.body as Record<string, unknown>;
    handlers.handleSubagentStart(payload as never);
    return {};
  });

  fastify.post('/api/hook/subagent-stop', async (request) => {
    const payload = request.body as Record<string, unknown>;
    handlers.handleSubagentStop(payload as never);
    return {};
  });

  fastify.post('/api/hook/stop', async (request) => {
    const payload = request.body as Record<string, unknown>;
    handlers.handleStop(payload as never);
    return {};
  });
}
