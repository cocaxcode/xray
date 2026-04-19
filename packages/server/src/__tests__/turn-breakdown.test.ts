import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initSchema } from '../db/schema.js';
import { Queries } from '../db/queries.js';
import { SessionManager } from '../sessions/manager.js';
import { HookHandlers } from '../hooks/handlers.js';
import type { ServerWSEvent } from '../types.js';

let db: Database.Database;
let queries: Queries;
let manager: SessionManager;
let handlers: HookHandlers;
let broadcasts: ServerWSEvent[];
let tmpDir: string;
let transcriptPath: string;

const makeAssistant = (id: string, blocks: Array<Record<string, unknown>>, model = 'claude-sonnet-4-6-20250514') =>
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-04-19T12:00:00Z',
    message: { id, model, content: blocks, usage: { input_tokens: 10, output_tokens: 20 } },
  });

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  queries = new Queries(db);
  manager = new SessionManager(queries);
  broadcasts = [];
  handlers = new HookHandlers(manager, queries, (ev) => { broadcasts.push(ev); });
  tmpDir = mkdtempSync(join(tmpdir(), 'xray-turn-'));
  transcriptPath = join(tmpDir, 't.jsonl');
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('processTurnBreakdown via handleStop', () => {
  it('emits thinking/response/tool_use events for a single turn', () => {
    manager.handleSessionStart({
      session_id: 's1',
      cwd: '/tmp/proj',
      model: 'claude-sonnet-4-6-20250514',
      source: 'startup',
      transcript_path: transcriptPath,
    });

    writeFileSync(transcriptPath, makeAssistant('msg_01', [
      { type: 'thinking', thinking: 'a'.repeat(400) },
      { type: 'text', text: 'b'.repeat(200) },
      { type: 'tool_use', id: 'toolu_01', name: 'Bash', input: { command: 'ls' } },
    ]) + '\n');

    handlers.handleStop({ session_id: 's1' });

    const rows = db.prepare(
      "SELECT source, tool_name, tokens_estimated, input_hash, command_preview FROM optimization_events WHERE source IN ('thinking','response') ORDER BY source"
    ).all() as Array<{ source: string; tool_name: string; tokens_estimated: number; input_hash: string; command_preview: string }>;

    expect(rows).toHaveLength(2);
    const byType = Object.fromEntries(rows.map((r) => [r.source, r]));

    expect(byType.thinking.input_hash).toBe('thinking:msg_01');
    expect(byType.thinking.tokens_estimated).toBe(Math.ceil(400 * 0.27));
    expect(byType.thinking.command_preview).toBe('sonnet-4.6');

    expect(byType.response.input_hash).toBe('response:msg_01');
    expect(byType.response.tokens_estimated).toBe(Math.ceil(200 * 0.27));

    // tool_use NO se emite: la tool call real ya se cuenta en su source
    // original (mcp/builtin/rtk…) vía PostToolUse.
    const toolUseRows = db.prepare("SELECT * FROM optimization_events WHERE source = 'tool_use'").all();
    expect(toolUseRows).toHaveLength(0);

    // Watermark persisted
    expect(queries.getLastParsedMessageId('s1')).toBe('msg_01');

    // Broadcasts: thinking + response (no tool_use)
    const optEvents = broadcasts.filter((b) => b.type === 'optimization:event');
    expect(optEvents).toHaveLength(2);
  });

  it('estimates thinking tokens from signature when thinking text is encrypted (Claude 4.7+)', () => {
    manager.handleSessionStart({
      session_id: 's5', cwd: '/tmp/p', model: 'claude-opus-4-7',
      source: 'startup', transcript_path: transcriptPath,
    });

    // Simulate Claude 4.7+ behaviour: thinking="" and signature is base64
    writeFileSync(transcriptPath, makeAssistant('msg_enc', [
      { type: 'thinking', thinking: '', signature: 'a'.repeat(800) },
    ], 'claude-opus-4-7') + '\n');

    handlers.handleStop({ session_id: 's5' });

    const row = db.prepare(
      "SELECT tokens_estimated, command_preview FROM optimization_events WHERE source='thinking'"
    ).get() as { tokens_estimated: number; command_preview: string };

    // signature_chars × 0.75 × 0.27
    const expected = Math.ceil(Math.round(800 * 0.75) * 0.27);
    expect(row.tokens_estimated).toBe(expected);
    expect(row.command_preview).toContain('cifrado');
  });

  it('is idempotent across multiple handleStop invocations (DB + broadcast)', () => {
    manager.handleSessionStart({
      session_id: 's2', cwd: '/tmp/p', model: 'claude-opus-4-7',
      source: 'startup', transcript_path: transcriptPath,
    });

    writeFileSync(transcriptPath, makeAssistant('msg_A', [
      { type: 'thinking', thinking: 'xxx' },
    ]) + '\n');

    handlers.handleStop({ session_id: 's2' });
    handlers.handleStop({ session_id: 's2' });
    handlers.handleStop({ session_id: 's2' });

    const count = (db.prepare(
      "SELECT COUNT(*) as c FROM optimization_events WHERE source = 'thinking'"
    ).get() as { c: number }).c;
    expect(count).toBe(1);

    // Broadcasts: sólo la PRIMERA Stop emite; las siguientes son no-op por
    // dedup en INSERT OR IGNORE. Evita duplicados en el live feed.
    const thinkingBroadcasts = broadcasts.filter(
      (b) => b.type === 'optimization:event' && (b.data as { source: string }).source === 'thinking'
    );
    expect(thinkingBroadcasts).toHaveLength(1);
  });

  it('processes only new turns on subsequent Stop', () => {
    manager.handleSessionStart({
      session_id: 's3', cwd: '/tmp/p', model: 'claude-sonnet-4-6-20250514',
      source: 'startup', transcript_path: transcriptPath,
    });

    writeFileSync(transcriptPath, makeAssistant('msg_A', [
      { type: 'thinking', thinking: 'one' },
    ]) + '\n');

    handlers.handleStop({ session_id: 's3' });

    expect((db.prepare("SELECT COUNT(*) as c FROM optimization_events WHERE source = 'thinking'").get() as { c: number }).c).toBe(1);

    // Append new turn
    writeFileSync(transcriptPath,
      makeAssistant('msg_A', [{ type: 'thinking', thinking: 'one' }]) + '\n' +
      makeAssistant('msg_B', [{ type: 'thinking', thinking: 'two' }]) + '\n'
    );

    handlers.handleStop({ session_id: 's3' });

    const rows = db.prepare(
      "SELECT input_hash FROM optimization_events WHERE source='thinking' ORDER BY input_hash"
    ).all() as Array<{ input_hash: string }>;
    expect(rows.map((r) => r.input_hash)).toEqual(['thinking:msg_A', 'thinking:msg_B']);
  });

  it('does not create events for empty content blocks', () => {
    manager.handleSessionStart({
      session_id: 's4', cwd: '/tmp/p', model: 'claude-sonnet-4-6-20250514',
      source: 'startup', transcript_path: transcriptPath,
    });

    writeFileSync(transcriptPath, makeAssistant('msg_E', [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: '' },
    ]) + '\n');

    handlers.handleStop({ session_id: 's4' });

    const count = (db.prepare(
      "SELECT COUNT(*) as c FROM optimization_events"
    ).get() as { c: number }).c;
    expect(count).toBe(0);
  });
});
