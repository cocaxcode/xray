import type { FastifyInstance } from 'fastify';
import type { Queries } from '../db/queries.js';
import type { SessionManager } from '../sessions/manager.js';
import type { PermissionHandler } from '../hooks/permission.js';
import type { AuthState } from '../types.js';
import { validatePin, rotatePin } from '../auth/token.js';
import { recordFailedPinAttempt, clearPinAttempts } from '../auth/middleware.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function registerApiRoutes(
  fastify: FastifyInstance,
  queries: Queries,
  manager: SessionManager,
  permissionHandler: PermissionHandler,
  authState: AuthState,
  broadcast?: (event: import('../types.js').ServerWSEvent) => void,
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
    const { decision } = request.body as { decision: 'approve' | 'deny' | 'allowAlways' };

    if (!decision || !['approve', 'deny', 'allowAlways'].includes(decision)) {
      return reply.status(400).send({ error: 'Invalid decision. Must be "approve", "deny" or "allowAlways".' });
    }

    const permId = parseInt(id);
    // Load tool info from DB for the updatedInput field in the hook response
    const permInfo = queries.getPendingPermission(permId);
    const resolved = permissionHandler.resolvePermission(
      permId,
      decision,
      permInfo?.toolName,
      permInfo?.toolInput,
    );
    return { success: resolved };
  });

  // ── Active pending permissions (only those with active deferred promises) ──
  fastify.get('/api/permissions/pending', async () => {
    return permissionHandler.getActivePendingFull();
  });

  // ── Auto-approve toggle ──
  fastify.get('/api/permissions/auto-approve', async () => {
    return { enabled: permissionHandler.autoApprove };
  });

  fastify.post('/api/permissions/auto-approve', async (request) => {
    const { enabled } = request.body as { enabled: boolean };
    permissionHandler.autoApprove = !!enabled;
    broadcast?.({ type: 'config:auto-approve', data: { enabled: permissionHandler.autoApprove } });
    return { enabled: permissionHandler.autoApprove };
  });

  // ── PIN exchange ──
  fastify.post('/api/auth/pin', async (request, reply) => {
    const { pin } = request.body as { pin: string };
    if (!pin) {
      return reply.status(400).send({ error: 'PIN required' });
    }

    const token = validatePin(pin, authState);
    if (!token) {
      // Registrar intento fallido para rate limiting
      recordFailedPinAttempt(request.ip);
      const isExpired = authState.pin && Date.now() > authState.pinExpiresAt;
      const message = isExpired
        ? 'PIN expirado. Ejecuta "cxc-xray pin" para generar uno nuevo.'
        : 'PIN incorrecto';
      return reply.status(401).send({ error: message });
    }

    // PIN correcto: limpiar intentos
    clearPinAttempts(request.ip);

    return { token };
  });

  // ── PIN rotation (called by CLI `cxc-xray pin`) ──
  fastify.post('/api/auth/rotate-pin', async (_request, reply) => {
    const newState = rotatePin(authState);
    // Mutate in place (authState is shared reference)
    authState.pin = newState.pin;
    authState.pinExpiresAt = newState.pinExpiresAt;

    return { pin: newState.pin, expiresIn: '5 minutes' };
  });

  // ── Templates ──
  fastify.get('/api/templates', async () => {
    const builtInDir = join(__dirname, '..', '..', 'templates');
    const communityDir = join(homedir(), '.xray', 'templates');
    const templates: Array<{ name: string; author: string; version: string; description: string; tileSize: number; preview: string }> = [];
    const seen = new Set<string>();

    // Community first (priority override)
    for (const dir of [communityDir, builtInDir]) {
      if (!existsSync(dir)) continue;
      let entries: string[];
      try { entries = readdirSync(dir); } catch { continue; }

      for (const name of entries) {
        if (seen.has(name)) continue;
        const jsonPath = join(dir, name, 'template.json');
        if (!existsSync(jsonPath)) continue;
        try {
          const config = JSON.parse(readFileSync(jsonPath, 'utf-8'));
          templates.push({
            name: config.name || name,
            author: config.author || 'unknown',
            version: config.version || '0.0.0',
            description: config.description || '',
            tileSize: config.tileSize || 64,
            preview: `/templates/${name}/preview.png`,
          });
          seen.add(name);
        } catch {
          // Invalid JSON — skip
        }
      }
    }

    return templates;
  });

  // ── Optimization (token-optimizer data) ──

  fastify.get('/api/sessions/:id/optimization', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!queries.sessionExists(id)) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return queries.getOptimizationData(id);
  });

  fastify.get('/api/sessions/:id/optimization/events', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { page = '1', pageSize = '100' } = request.query as Record<string, string>;
    if (!queries.sessionExists(id)) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const events = queries['db'].prepare(
      'SELECT * FROM optimization_events WHERE session_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(id, parseInt(pageSize), offset);
    const total = queries.getOptimizationEventCount(id);
    return { events, total, page: parseInt(page), pageSize: parseInt(pageSize) };
  });

  fastify.get('/api/projects/:path/optimization', async (request) => {
    const { path: projectPath } = request.params as { path: string };
    const decoded = decodeURIComponent(projectPath);
    return queries.getOptimizationAggregateByProject(decoded);
  });

  // Global optimization stats (all projects)
  fastify.get('/api/optimization', async (request) => {
    const { from, to } = request.query as { from?: string; to?: string };
    return queries.getOptimizationGlobalStats(from, to);
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
