import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  // Create a test session
  queries.insertSession({ id: 'sess-001', projectPath: '/p', projectName: 'p', model: 'm', transcriptPath: '/t' });

  handler = new PermissionHandler(queries, (event) => {
    broadcastedEvents.push(event);
  });
});

afterEach(() => {
  handler.cleanup();
  db.close();
});

describe('Permission Approve', () => {
  it('should resolve with allow when approved', async () => {
    const resultPromise = handler.handlePermissionRequest(
      'sess-001',
      'Bash',
      { command: 'npm test' },
    );

    // Wait for broadcast
    await new Promise(r => setTimeout(r, 10));

    // Should have broadcasted pending
    expect(broadcastedEvents.length).toBe(1);
    expect(broadcastedEvents[0].type).toBe('permission:pending');

    // Get the permission ID from the broadcast
    const pendingData = broadcastedEvents[0].data as { id: number };

    // Resolve it
    const resolved = handler.resolvePermission(pendingData.id, 'approve');
    expect(resolved).toBe(true);

    const result = await resultPromise;
    expect(result).toHaveProperty('hookSpecificOutput');
    const output = (result as { hookSpecificOutput: { decision: { behavior: string } } }).hookSpecificOutput;
    expect(output.decision.behavior).toBe('allow');

    // Should have broadcasted resolved
    expect(broadcastedEvents.length).toBe(2);
    expect(broadcastedEvents[1].type).toBe('permission:resolved');
  });
});

describe('Permission Deny', () => {
  it('should resolve with deny when denied', async () => {
    const resultPromise = handler.handlePermissionRequest(
      'sess-001',
      'Bash',
      { command: 'rm -rf /' },
    );

    await new Promise(r => setTimeout(r, 10));

    const pendingData = broadcastedEvents[0].data as { id: number };
    handler.resolvePermission(pendingData.id, 'deny');

    const result = await resultPromise;
    const output = (result as { hookSpecificOutput: { decision: { behavior: string } } }).hookSpecificOutput;
    expect(output.decision.behavior).toBe('deny');
  });
});

describe('Permission Duplicate', () => {
  it('should ignore second resolution (first-wins)', async () => {
    const resultPromise = handler.handlePermissionRequest(
      'sess-001',
      'Bash',
      { command: 'test' },
    );

    await new Promise(r => setTimeout(r, 10));

    const pendingData = broadcastedEvents[0].data as { id: number };

    const first = handler.resolvePermission(pendingData.id, 'approve');
    const second = handler.resolvePermission(pendingData.id, 'deny');

    expect(first).toBe(true);
    expect(second).toBe(false); // Already resolved

    const result = await resultPromise;
    const output = (result as { hookSpecificOutput: { decision: { behavior: string } } }).hookSpecificOutput;
    expect(output.decision.behavior).toBe('allow'); // First wins
  });
});

describe('Permission Cleanup', () => {
  it('should resolve all pending on cleanup', async () => {
    const resultPromise = handler.handlePermissionRequest(
      'sess-001',
      'Bash',
      { command: 'test' },
    );

    await new Promise(r => setTimeout(r, 10));

    handler.cleanup();

    const result = await resultPromise;
    expect(result).toEqual({}); // Empty = fallthrough
  });
});
