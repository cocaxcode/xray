import type Database from 'better-sqlite3';
import type { Session, ToolEvent, PendingPermission, SessionSummary, ProjectGroup, McpServer, Agent } from '../types.js';

export class Queries {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ── Sessions ──

  insertSession(session: {
    id: string;
    projectPath: string;
    projectName: string;
    model: string;
    transcriptPath: string;
  }): void {
    this.db.prepare(`
      INSERT INTO sessions (id, project_path, project_name, model, status, started_at, last_event_at, transcript_path)
      VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'), ?)
    `).run(session.id, session.projectPath, session.projectName, session.model, session.transcriptPath);
  }

  private static ALLOWED_SESSION_COLUMNS = new Set([
    'model', 'status', 'context_percent', 'context_units', 'last_event_at',
    'last_message', 'topic', 'event_count', 'skills', 'mcps', 'agents',
    'transcript_path', 'transcript_offset', 'input_tokens', 'output_tokens',
  ]);

  updateSession(id: string, fields: Record<string, unknown>): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(fields)) {
      if (!Queries.ALLOWED_SESSION_COLUMNS.has(key)) {
        continue; // Silently skip invalid columns
      }
      sets.push(`${key} = ?`);
      values.push(value);
    }
    if (sets.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  getSession(id: string): Session | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToSession(row);
  }

  sessionExists(id: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(id);
    return !!row;
  }

  getAllSessions(includesStopped = false): Session[] {
    const sql = includesStopped
      ? "SELECT * FROM sessions ORDER BY last_event_at DESC"
      : "SELECT * FROM sessions WHERE status != 'stopped' ORDER BY last_event_at DESC";
    const rows = this.db.prepare(sql).all() as Record<string, unknown>[];
    return rows.map(r => this.rowToSession(r));
  }

  getProjectGroups(includeStopped = false): ProjectGroup[] {
    const sessions = this.getAllSessions(includeStopped);
    const pendingPerms = this.db.prepare(
      "SELECT session_id, COUNT(*) as count FROM pending_permissions WHERE status = 'pending' GROUP BY session_id"
    ).all() as Array<{ session_id: string; count: number }>;

    const permMap = new Map(pendingPerms.map(p => [p.session_id, p.count]));
    const groups = new Map<string, ProjectGroup>();

    for (const session of sessions) {
      const key = session.projectPath;
      if (!groups.has(key)) {
        groups.set(key, {
          name: session.projectName,
          path: session.projectPath,
          sessions: [],
          pendingPermissions: 0,
        });
      }
      const group = groups.get(key)!;
      group.sessions.push(session);
      group.pendingPermissions += permMap.get(session.id) ?? 0;
    }

    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  markStaleSessions(minutes = 30): string[] {
    const rows = this.db.prepare(
      "SELECT id FROM sessions WHERE status != 'stopped' AND last_event_at < datetime('now', ?)"
    ).all(`-${minutes} minutes`) as Array<{ id: string }>;

    if (rows.length === 0) return [];

    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(
      `UPDATE sessions SET status = 'stopped' WHERE id IN (${placeholders})`
    ).run(...ids);

    return ids;
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM events WHERE session_id = ?').run(id);
    this.db.prepare('DELETE FROM pending_permissions WHERE session_id = ?').run(id);
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  getSessionTranscriptInfo(id: string): { transcriptPath: string; transcriptOffset: number; inputTokens: number; outputTokens: number } | null {
    const row = this.db.prepare(
      'SELECT transcript_path, transcript_offset, input_tokens, output_tokens FROM sessions WHERE id = ?'
    ).get(id) as Record<string, unknown> | undefined;
    if (!row || !row.transcript_path) return null;
    return {
      transcriptPath: row.transcript_path as string,
      transcriptOffset: (row.transcript_offset as number) || 0,
      inputTokens: (row.input_tokens as number) || 0,
      outputTokens: (row.output_tokens as number) || 0,
    };
  }

  updateSessionTokens(id: string, inputTokens: number, outputTokens: number, transcriptOffset: number): void {
    this.db.prepare(
      'UPDATE sessions SET input_tokens = ?, output_tokens = ?, transcript_offset = ? WHERE id = ?'
    ).run(inputTokens, outputTokens, transcriptOffset, id);
  }

  // ── Events ──

  insertEvent(event: {
    sessionId: string;
    eventType: string;
    toolName?: string;
    toolInput?: string;
    toolResponse?: string;
    toolUseId?: string;
    agentId?: string;
    agentType?: string;
    success?: boolean;
    durationMs?: number;
  }): number {
    const result = this.db.prepare(`
      INSERT INTO events (session_id, event_type, tool_name, tool_input, tool_response, tool_use_id, agent_id, agent_type, success, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.sessionId,
      event.eventType,
      event.toolName ?? null,
      event.toolInput ?? null,
      event.toolResponse ? event.toolResponse.substring(0, 1024) : null,
      event.toolUseId ?? null,
      event.agentId ?? null,
      event.agentType ?? null,
      event.success !== false ? 1 : 0,
      event.durationMs ?? null,
    );

    // Update session event count and last_event_at
    this.db.prepare(
      "UPDATE sessions SET event_count = event_count + 1, last_event_at = datetime('now') WHERE id = ?"
    ).run(event.sessionId);

    // Update FTS index
    this.db.prepare(
      'INSERT INTO events_fts(rowid, tool_name, tool_input, tool_response) VALUES (?, ?, ?, ?)'
    ).run(result.lastInsertRowid, event.toolName ?? '', event.toolInput ?? '', event.toolResponse?.substring(0, 1024) ?? '');

    return Number(result.lastInsertRowid);
  }

  getEventsBySession(sessionId: string, page = 1, pageSize = 50): { events: ToolEvent[]; total: number } {
    const offset = (page - 1) * pageSize;

    const total = (this.db.prepare(
      'SELECT COUNT(*) as count FROM events WHERE session_id = ?'
    ).get(sessionId) as { count: number }).count;

    const rows = this.db.prepare(
      'SELECT * FROM events WHERE session_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(sessionId, pageSize, offset) as Record<string, unknown>[];

    return {
      events: rows.map(r => this.rowToToolEvent(r)),
      total,
    };
  }

  getPreToolTimestamp(sessionId: string, toolUseId: string): string | null {
    const row = this.db.prepare(
      "SELECT created_at FROM events WHERE session_id = ? AND tool_use_id = ? AND event_type = 'PreToolUse' LIMIT 1"
    ).get(sessionId, toolUseId) as { created_at: string } | undefined;
    return row?.created_at ?? null;
  }

  // ── Permissions ──

  insertPendingPermission(sessionId: string, toolName: string, toolInput: string): number {
    const result = this.db.prepare(
      'INSERT INTO pending_permissions (session_id, tool_name, tool_input) VALUES (?, ?, ?)'
    ).run(sessionId, toolName, toolInput);
    return Number(result.lastInsertRowid);
  }

  updatePermission(id: number, status: string): void {
    this.db.prepare(
      "UPDATE pending_permissions SET status = ?, resolved_at = datetime('now') WHERE id = ?"
    ).run(status, id);
  }

  getPendingPermission(id: number): PendingPermission | null {
    const row = this.db.prepare('SELECT * FROM pending_permissions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as number,
      sessionId: row.session_id as string,
      toolName: row.tool_name as string,
      toolInput: JSON.parse(row.tool_input as string),
      status: row.status as PendingPermission['status'],
      createdAt: row.created_at as string,
    };
  }

  getPendingPermissionsBySession(sessionId: string): PendingPermission[] {
    const rows = this.db.prepare(
      "SELECT * FROM pending_permissions WHERE session_id = ? AND status = 'pending'"
    ).all(sessionId) as Record<string, unknown>[];
    return rows.map(row => ({
      id: row.id as number,
      sessionId: row.session_id as string,
      toolName: row.tool_name as string,
      toolInput: JSON.parse(row.tool_input as string),
      status: row.status as PendingPermission['status'],
      createdAt: row.created_at as string,
    }));
  }

  // ── Summary ──

  getSessionSummary(sessionId: string): SessionSummary {
    const session = this.getSession(sessionId);
    const startedAt = session ? new Date(session.startedAt).getTime() : Date.now();
    const duration = Date.now() - startedAt;

    // Files touched
    const files = this.db.prepare(`
      SELECT json_extract(tool_input, '$.file_path') as path, COUNT(*) as edit_count
      FROM events
      WHERE session_id = ? AND tool_name IN ('Edit', 'Write', 'Read') AND json_extract(tool_input, '$.file_path') IS NOT NULL
      GROUP BY path ORDER BY edit_count DESC
    `).all(sessionId) as Array<{ path: string; edit_count: number }>;

    // Tool breakdown
    const tools = this.db.prepare(`
      SELECT tool_name as tool, COUNT(*) as count
      FROM events WHERE session_id = ? AND tool_name IS NOT NULL
      GROUP BY tool_name ORDER BY count DESC
    `).all(sessionId) as Array<{ tool: string; count: number }>;

    // Errors
    const errorCount = (this.db.prepare(
      'SELECT COUNT(*) as count FROM events WHERE session_id = ? AND success = 0'
    ).get(sessionId) as { count: number }).count;

    // MCPs
    const mcps = this.db.prepare(`
      SELECT
        SUBSTR(tool_name, 6, INSTR(SUBSTR(tool_name, 6), '__') - 1) as name,
        COUNT(*) as call_count
      FROM events
      WHERE session_id = ? AND tool_name LIKE 'mcp__%'
      GROUP BY name ORDER BY call_count DESC
    `).all(sessionId) as Array<{ name: string; call_count: number }>;

    // Agents
    const agents = this.db.prepare(`
      SELECT agent_type as type, COUNT(DISTINCT agent_id) as count, SUM(duration_ms) as total_duration
      FROM events
      WHERE session_id = ? AND agent_type IS NOT NULL
      GROUP BY agent_type
    `).all(sessionId) as Array<{ type: string; count: number; total_duration: number }>;

    return {
      duration,
      filesTouched: files.map(f => ({ path: f.path, editCount: f.edit_count })),
      toolBreakdown: tools,
      errorCount,
      mcpsUsed: mcps.map(m => ({ name: m.name, callCount: m.call_count })),
      agentsSpawned: agents.map(a => ({ type: a.type, count: a.count, totalDuration: a.total_duration ?? 0 })),
      totalInputTokens: session?.inputTokens ?? 0,
      totalOutputTokens: session?.outputTokens ?? 0,
      tokensByAgent: [],
    };
  }

  // ── Helpers ──

  private rowToSession(row: Record<string, unknown>): Session {
    return {
      id: row.id as string,
      projectPath: row.project_path as string,
      projectName: row.project_name as string,
      model: row.model as string,
      status: row.status as Session['status'],
      contextPercent: row.context_percent as number,
      startedAt: row.started_at as string,
      lastEventAt: row.last_event_at as string,
      skills: JSON.parse((row.skills as string) || '[]'),
      mcps: JSON.parse((row.mcps as string) || '[]'),
      agents: JSON.parse((row.agents as string) || '[]'),
      lastMessage: row.last_message as string | null,
      topic: row.topic as string | null,
      eventCount: row.event_count as number,
      inputTokens: row.input_tokens as number,
      outputTokens: row.output_tokens as number,
      inputTokensAtStop: 0,
      outputTokensAtStop: 0,
    };
  }

  private safeJsonParse(str: string | null | undefined): Record<string, unknown> | undefined {
    if (!str) return undefined;
    try { return JSON.parse(str); } catch { return { raw: str }; }
  }

  private rowToToolEvent(row: Record<string, unknown>): ToolEvent {
    return {
      id: row.id as number,
      sessionId: row.session_id as string,
      eventType: row.event_type as string,
      toolName: (row.tool_name as string) || '',
      toolInput: this.safeJsonParse(row.tool_input as string) || {},
      toolResponse: this.safeJsonParse(row.tool_response as string),
      agentId: row.agent_id as string | undefined,
      agentType: row.agent_type as string | undefined,
      success: row.success === 1,
      durationMs: row.duration_ms as number | undefined,
      createdAt: row.created_at as string,
    };
  }
}
