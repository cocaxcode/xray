import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from '../db/schema.js';
import { Queries } from '../db/queries.js';
import { PermissionHandler } from '../hooks/permission.js';
import type { ServerWSEvent } from '../types.js';

let db: Database.Database;
let queries: Queries;
let handler: PermissionHandler;
let broadcastedEvents: ServerWSEvent[];

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  queries = new Queries(db);
  broadcastedEvents = [];

  queries.insertSession({ id: 'sess-001', projectPath: '/p', projectName: 'p', model: 'm', transcriptPath: '/t' });

  handler = new PermissionHandler(queries, (event) => {
    broadcastedEvents.push(event);
  });
});

afterEach(() => {
  db.close();
});

function behaviorOf(result: unknown): string | undefined {
  const r = result as { hookSpecificOutput?: { decision?: { behavior?: string } } };
  return r.hookSpecificOutput?.decision?.behavior;
}

describe('autoApprove OFF — Xray se abstiene', () => {
  it('devuelve {} para que Claude Code pida permiso de forma nativa (Edit)', async () => {
    handler.autoApprove = false;
    const result = await handler.handlePermissionRequest(
      'sess-001',
      'Edit',
      { file_path: '/home/u/.claude/skills/foo/SKILL.md' },
    );
    expect(result).toEqual({});
    expect(broadcastedEvents.length).toBe(0);
  });

  it('también se abstiene para Bash cuando OFF', async () => {
    handler.autoApprove = false;
    const result = await handler.handlePermissionRequest('sess-001', 'Bash', { command: 'ls' });
    expect(result).toEqual({});
  });
});

describe('autoApprove ON — Xray aprueba, nunca rechaza', () => {
  it('auto-aprueba una edición de skill con behavior allow', async () => {
    handler.autoApprove = true;
    const result = await handler.handlePermissionRequest(
      'sess-001',
      'Edit',
      { file_path: '/home/u/.claude/skills/foo/SKILL.md' },
    );
    expect(behaviorOf(result)).toBe('allow');
    expect(broadcastedEvents.some(e => e.type === 'permission:auto-approved')).toBe(true);
  });

  it('auto-aprueba Bash con behavior allow', async () => {
    handler.autoApprove = true;
    const result = await handler.handlePermissionRequest('sess-001', 'Bash', { command: 'ls' });
    expect(behaviorOf(result)).toBe('allow');
  });

  it('devuelve el tool input original como updatedInput', async () => {
    handler.autoApprove = true;
    const input = { file_path: '/home/u/.claude/skills/foo/SKILL.md' };
    const result = await handler.handlePermissionRequest('sess-001', 'Write', input);
    const r = result as { hookSpecificOutput: { decision: { updatedInput: unknown } } };
    expect(r.hookSpecificOutput.decision.updatedInput).toEqual(input);
  });

  it('se abstiene para AskUserQuestion aunque el toggle esté ON', async () => {
    handler.autoApprove = true;
    const result = await handler.handlePermissionRequest('sess-001', 'AskUserQuestion', { questions: [] });
    expect(result).toEqual({});
  });

  it('se abstiene para ExitPlanMode aunque el toggle esté ON', async () => {
    handler.autoApprove = true;
    const result = await handler.handlePermissionRequest('sess-001', 'ExitPlanMode', {});
    expect(result).toEqual({});
  });
});

describe('willAutoApprove', () => {
  it('refleja el toggle y la lista de exclusión', () => {
    handler.autoApprove = false;
    expect(handler.willAutoApprove('Bash')).toBe(false);
    expect(handler.willAutoApprove('Edit')).toBe(false);

    handler.autoApprove = true;
    expect(handler.willAutoApprove('Bash')).toBe(true);
    expect(handler.willAutoApprove('Edit')).toBe(true);
    expect(handler.willAutoApprove('AskUserQuestion')).toBe(false);
    expect(handler.willAutoApprove('ExitPlanMode')).toBe(false);
  });
});

describe('constructor', () => {
  it('toma el estado inicial de autoApprove del constructor', () => {
    const on = new PermissionHandler(queries, () => {}, true);
    expect(on.autoApprove).toBe(true);
    const off = new PermissionHandler(queries, () => {}, false);
    expect(off.autoApprove).toBe(false);
  });
});
