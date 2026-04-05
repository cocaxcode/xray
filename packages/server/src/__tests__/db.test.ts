import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema, purgeOldEvents } from '../db/schema.js';
import { Queries } from '../db/queries.js';

let db: Database.Database;
let queries: Queries;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  queries = new Queries(db);
});

afterEach(() => {
  db.close();
});

describe('Schema', () => {
  it('should create all tables', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as Array<{ name: string }>;
    const names = tables.map(t => t.name);

    expect(names).toContain('sessions');
    expect(names).toContain('events');
    expect(names).toContain('pending_permissions');
    expect(names).toContain('events_fts');
  });

  it('should be idempotent (run twice without error)', () => {
    expect(() => initSchema(db)).not.toThrow();
  });
});

describe('Sessions CRUD', () => {
  it('should insert and retrieve a session', () => {
    queries.insertSession({
      id: 'sess-001',
      projectPath: '/projects/api',
      projectName: 'api',
      model: 'claude-opus-4-6',
      transcriptPath: '/tmp/transcript.jsonl',
    });

    const session = queries.getSession('sess-001');
    expect(session).not.toBeNull();
    expect(session!.id).toBe('sess-001');
    expect(session!.projectName).toBe('api');
    expect(session!.model).toBe('claude-opus-4-6');
    expect(session!.status).toBe('active');
    expect(session!.inputTokens).toBe(0);
    expect(session!.outputTokens).toBe(0);
  });

  it('should update session fields', () => {
    queries.insertSession({
      id: 'sess-001',
      projectPath: '/projects/api',
      projectName: 'api',
      model: 'claude-opus-4-6',
      transcriptPath: '/tmp/t.jsonl',
    });

    queries.updateSession('sess-001', { status: 'idle', last_message: 'Done' });

    const session = queries.getSession('sess-001');
    expect(session!.status).toBe('idle');
    expect(session!.lastMessage).toBe('Done');
  });

  it('should check session existence', () => {
    expect(queries.sessionExists('nope')).toBe(false);

    queries.insertSession({
      id: 'sess-001',
      projectPath: '/p',
      projectName: 'p',
      model: 'm',
      transcriptPath: '/t',
    });

    expect(queries.sessionExists('sess-001')).toBe(true);
  });

  it('should update token counts', () => {
    queries.insertSession({
      id: 'sess-001',
      projectPath: '/p',
      projectName: 'p',
      model: 'm',
      transcriptPath: '/t',
    });

    queries.updateSessionTokens('sess-001', 5000, 3000, 1024);

    const session = queries.getSession('sess-001');
    expect(session!.inputTokens).toBe(5000);
    expect(session!.outputTokens).toBe(3000);
  });
});

describe('Events', () => {
  beforeEach(() => {
    queries.insertSession({
      id: 'sess-001',
      projectPath: '/p',
      projectName: 'p',
      model: 'm',
      transcriptPath: '/t',
    });
  });

  it('should insert an event and increment session count', () => {
    const id = queries.insertEvent({
      sessionId: 'sess-001',
      eventType: 'PreToolUse',
      toolName: 'Bash',
      toolInput: '{"command":"npm test"}',
    });

    expect(id).toBeGreaterThan(0);

    const session = queries.getSession('sess-001');
    expect(session!.eventCount).toBe(1);
  });

  it('should truncate tool_response to 1KB', () => {
    const longJson = JSON.stringify({ output: 'x'.repeat(2000) });
    queries.insertEvent({
      sessionId: 'sess-001',
      eventType: 'PostToolUse',
      toolName: 'Bash',
      toolResponse: longJson,
    });

    // Verify via raw SQL that stored value is <= 1024 chars
    const row = db.prepare(
      'SELECT tool_response FROM events WHERE session_id = ?'
    ).get('sess-001') as { tool_response: string };
    expect(row.tool_response.length).toBeLessThanOrEqual(1024);
  });

  it('should paginate events', () => {
    for (let i = 0; i < 10; i++) {
      queries.insertEvent({
        sessionId: 'sess-001',
        eventType: 'PreToolUse',
        toolName: `Tool${i}`,
      });
    }

    const page1 = queries.getEventsBySession('sess-001', 1, 3);
    expect(page1.events.length).toBe(3);
    expect(page1.total).toBe(10);

    const page2 = queries.getEventsBySession('sess-001', 2, 3);
    expect(page2.events.length).toBe(3);
  });

  it('should store failure events with success=0', () => {
    queries.insertEvent({
      sessionId: 'sess-001',
      eventType: 'PostToolUseFailure',
      toolName: 'Bash',
      success: false,
    });

    const { events } = queries.getEventsBySession('sess-001');
    expect(events[0].success).toBe(false);
  });
});

describe('Project Grouping', () => {
  it('should group sessions by project path', () => {
    queries.insertSession({ id: 's1', projectPath: '/projects/api', projectName: 'api', model: 'm', transcriptPath: '/t' });
    queries.insertSession({ id: 's2', projectPath: '/projects/api', projectName: 'api', model: 'm', transcriptPath: '/t' });
    queries.insertSession({ id: 's3', projectPath: '/projects/web', projectName: 'web', model: 'm', transcriptPath: '/t' });

    const groups = queries.getProjectGroups();
    expect(groups.length).toBe(2);

    const apiGroup = groups.find(g => g.name === 'api');
    expect(apiGroup!.sessions.length).toBe(2);

    const webGroup = groups.find(g => g.name === 'web');
    expect(webGroup!.sessions.length).toBe(1);
  });

  it('should not include stopped sessions by default', () => {
    queries.insertSession({ id: 's1', projectPath: '/p', projectName: 'p', model: 'm', transcriptPath: '/t' });
    queries.updateSession('s1', { status: 'stopped' });

    const groups = queries.getProjectGroups();
    expect(groups.length).toBe(0);
  });
});

describe('Stale Sessions', () => {
  it('should mark old sessions as stopped', () => {
    queries.insertSession({ id: 's1', projectPath: '/p', projectName: 'p', model: 'm', transcriptPath: '/t' });

    // Force last_event_at to 31 minutes ago
    db.prepare(
      "UPDATE sessions SET last_event_at = datetime('now', '-31 minutes') WHERE id = 's1'"
    ).run();

    const stale = queries.markStaleSessions(30);
    expect(stale).toContain('s1');

    const session = queries.getSession('s1');
    expect(session!.status).toBe('stopped');
  });
});

describe('Permissions', () => {
  beforeEach(() => {
    queries.insertSession({ id: 's1', projectPath: '/p', projectName: 'p', model: 'm', transcriptPath: '/t' });
  });

  it('should insert and retrieve pending permission', () => {
    const id = queries.insertPendingPermission('s1', 'Bash', '{"command":"rm -rf"}');

    const perm = queries.getPendingPermission(id);
    expect(perm).not.toBeNull();
    expect(perm!.toolName).toBe('Bash');
    expect(perm!.status).toBe('pending');
  });

  it('should update permission status', () => {
    const id = queries.insertPendingPermission('s1', 'Bash', '{}');
    queries.updatePermission(id, 'approved');

    const perm = queries.getPendingPermission(id);
    expect(perm!.status).toBe('approved');
    expect(perm!.createdAt).toBeDefined();
  });

  it('should get pending permissions by session', () => {
    queries.insertPendingPermission('s1', 'Bash', '{}');
    queries.insertPendingPermission('s1', 'Write', '{}');

    const perms = queries.getPendingPermissionsBySession('s1');
    expect(perms.length).toBe(2);
  });
});

describe('Session Summary', () => {
  it('should aggregate tool breakdown', () => {
    queries.insertSession({ id: 's1', projectPath: '/p', projectName: 'p', model: 'm', transcriptPath: '/t' });

    queries.insertEvent({ sessionId: 's1', eventType: 'PostToolUse', toolName: 'Read' });
    queries.insertEvent({ sessionId: 's1', eventType: 'PostToolUse', toolName: 'Read' });
    queries.insertEvent({ sessionId: 's1', eventType: 'PostToolUse', toolName: 'Edit' });

    const summary = queries.getSessionSummary('s1');
    expect(summary.toolBreakdown.length).toBe(2);

    const readTool = summary.toolBreakdown.find(t => t.tool === 'Read');
    expect(readTool!.count).toBe(2);
  });
});

describe('Event Cleanup', () => {
  it('should purge events older than N days', () => {
    queries.insertSession({ id: 's1', projectPath: '/p', projectName: 'p', model: 'm', transcriptPath: '/t' });
    queries.insertEvent({ sessionId: 's1', eventType: 'Test', toolName: 'x' });

    // Force event to be old
    db.prepare(
      "UPDATE events SET created_at = datetime('now', '-8 days')"
    ).run();

    const purged = purgeOldEvents(db, 7);
    expect(purged).toBe(1);
  });
});
