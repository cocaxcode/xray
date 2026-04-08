import type { FastifyInstance } from 'fastify';
import type { HookHandlers } from './handlers.js';
import type { PermissionHandler } from './permission.js';
import type { SessionManager } from '../sessions/manager.js';
import type { ServerWSEvent } from '../types.js';
import { readModelFromTranscript, readTopicFromTranscript } from '../sessions/transcript-reader.js';

export function registerHookRoutes(
  fastify: FastifyInstance,
  handlers: HookHandlers,
  permissionHandler: PermissionHandler,
  manager: SessionManager,
  broadcast: (event: ServerWSEvent) => void,
): void {
  /**
   * Ensure session exists before processing any event.
   * If hooks were installed mid-session, the SessionStart was missed.
   * Also updates model if it was unknown and the payload has one.
   */
  function ensureSession(payload: Record<string, unknown>): void {
    const sessionId = payload.session_id as string;
    if (!sessionId) return;
    const session = manager.getSession(sessionId);
    if (!session) {
      // Auto-create session — try to get model from transcript if not in payload
      let model = (payload.model as string) || null;
      if (!model && payload.transcript_path) {
        model = readModelFromTranscript(payload.transcript_path as string);
      }
      const newSession = manager.handleSessionStart({
        session_id: sessionId,
        cwd: (payload.cwd as string) || 'unknown',
        model: model || 'unknown',
        source: 'startup',
        transcript_path: (payload.transcript_path as string) || '',
      });
      // Leer topic del transcript
      if (payload.transcript_path) {
        const topic = readTopicFromTranscript(payload.transcript_path as string);
        if (topic) {
          manager.updateTopic(sessionId, topic);
          newSession.topic = topic;
        }
      }
      // Leer tokens acumulados del transcript
      manager.updateTokens(sessionId);
      const updated = manager.getSession(sessionId);
      if (updated) {
        newSession.inputTokens = updated.inputTokens;
        newSession.outputTokens = updated.outputTokens;
      }
      // Broadcast para que el dashboard muestre la sesion inmediatamente
      broadcast({ type: 'session:start', data: newSession });
    } else {
      // Fix unknown model from payload or transcript
      if (session.model === 'unknown') {
        const model = (payload.model as string)
          || (payload.transcript_path ? readModelFromTranscript(payload.transcript_path as string) : null);
        if (model) manager.updateModel(sessionId, model);
      }
      // Fix missing transcript_path y leer tokens
      if (payload.transcript_path) {
        manager.fixTranscriptPath(sessionId, payload.transcript_path as string);
      }
    }
  }

  fastify.post('/api/hook/session-start', async (request) => {
    const payload = request.body as Record<string, unknown>;
    handlers.handleSessionStart(payload as never);
    return {};
  });

  fastify.post('/api/hook/session-end', async (request) => {
    const payload = request.body as Record<string, unknown>;
    ensureSession(payload);
    handlers.handleSessionEnd(payload.session_id as string);
    return {};
  });

  fastify.post('/api/hook/pre-tool-use', async (request) => {
    const payload = request.body as Record<string, unknown>;
    try { ensureSession(payload); handlers.handlePreToolUse(payload as never); } catch (e) { fastify.log.error(e, 'pre-tool-use handler error'); }
    return {};
  });

  fastify.post('/api/hook/post-tool-use', async (request) => {
    const payload = request.body as Record<string, unknown>;
    try { ensureSession(payload); handlers.handlePostToolUse(payload as never); } catch (e) { fastify.log.error(e, 'post-tool-use handler error'); }
    return {};
  });

  fastify.post('/api/hook/post-tool-use-failure', async (request) => {
    const payload = request.body as Record<string, unknown>;
    try { ensureSession(payload); handlers.handlePostToolUseFailure(payload as never); } catch (e) { fastify.log.error(e, 'post-tool-use-failure handler error'); }
    return {};
  });

  // PermissionRequest — SINCRONO: mantiene conexion abierta para aprobar desde xray
  // Limpieza de permisos stale via eventos (PreToolUse/Stop) — no via on('close')
  fastify.post('/api/hook/permission-request', async (request) => {
    const payload = request.body as Record<string, unknown>;
    const sessionId = payload.session_id as string;

    try {
      ensureSession(payload);

      // Skip waiting_permission state when auto-approve is active
      if (!permissionHandler.autoApprove) {
        manager.transitionTo(sessionId, 'waiting_permission');
        broadcast({ type: 'session:update', data: { id: sessionId, status: 'waiting_permission' } });
      }

      const response = await permissionHandler.handlePermissionRequest(
        sessionId,
        payload.tool_name as string,
        (payload.tool_input as Record<string, unknown>) ?? {},
      );

      if (!permissionHandler.autoApprove) {
        manager.transitionTo(sessionId, 'active');
        broadcast({ type: 'session:update', data: { id: sessionId, status: 'active' } });
      }
      return response;
    } catch (e) {
      fastify.log.error(e, 'permission-request handler error');
      permissionHandler.cleanupBySession(sessionId);
      try { manager.transitionTo(sessionId, 'active'); } catch {}
      return {};
    }
  });

  fastify.post('/api/hook/notification', async (request) => {
    const payload = request.body as Record<string, unknown>;
    try { ensureSession(payload); handlers.handleNotification(payload as never); } catch (e) { fastify.log.error(e, 'notification handler error'); }
    return {};
  });

  fastify.post('/api/hook/subagent-start', async (request) => {
    const payload = request.body as Record<string, unknown>;
    try { ensureSession(payload); handlers.handleSubagentStart(payload as never); } catch (e) { fastify.log.error(e, 'subagent-start handler error'); }
    return {};
  });

  fastify.post('/api/hook/subagent-stop', async (request) => {
    const payload = request.body as Record<string, unknown>;
    try { ensureSession(payload); handlers.handleSubagentStop(payload as never); } catch (e) { fastify.log.error(e, 'subagent-stop handler error'); }
    return {};
  });

  fastify.post('/api/hook/stop', async (request) => {
    const payload = request.body as Record<string, unknown>;
    try { ensureSession(payload); handlers.handleStop(payload as never); } catch (e) { fastify.log.error(e, 'stop handler error'); }
    return {};
  });
}
