import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from '../db/schema.js';
import { Queries } from '../db/queries.js';
import { SessionManager } from '../sessions/manager.js';

let db: Database.Database;
let queries: Queries;
let manager: SessionManager;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  queries = new Queries(db);
  manager = new SessionManager(queries);
});

afterEach(() => {
  db.close();
});

describe('Session Creation', () => {
  it('should create a new session on SessionStart', () => {
    const session = manager.handleSessionStart({
      session_id: 'sess-001',
      cwd: '/home/user/my-project',
      model: 'claude-opus-4-6',
      source: 'startup',
      transcript_path: '/tmp/transcript.jsonl',
    });

    expect(session.id).toBe('sess-001');
    expect(session.projectName).toBe('my-project');
    expect(session.projectPath).toBe('/home/user/my-project');
    expect(session.model).toBe('claude-opus-4-6');
    expect(session.status).toBe('active');
  });

  it('should normalize trailing slashes in cwd', () => {
    const session = manager.handleSessionStart({
      session_id: 'sess-001',
      cwd: '/home/user/my-project/',
      model: 'claude-opus-4-6',
      source: 'startup',
      transcript_path: '/tmp/t.jsonl',
    });

    expect(session.projectPath).toBe('/home/user/my-project');
  });

  it('should normalize Windows backslashes', () => {
    const session = manager.handleSessionStart({
      session_id: 'sess-001',
      cwd: 'C:\\Users\\dev\\project',
      model: 'claude-opus-4-6',
      source: 'startup',
      transcript_path: '/tmp/t.jsonl',
    });

    expect(session.projectPath).toBe('C:/Users/dev/project');
    expect(session.projectName).toBe('project');
  });

  it('should update existing session on resume (not duplicate)', () => {
    manager.handleSessionStart({
      session_id: 'sess-001',
      cwd: '/project',
      model: 'claude-opus-4-6',
      source: 'startup',
      transcript_path: '/tmp/t.jsonl',
    });

    const session = manager.handleSessionStart({
      session_id: 'sess-001',
      cwd: '/project',
      model: 'claude-sonnet-4-6',
      source: 'resume',
      transcript_path: '/tmp/t2.jsonl',
    });

    expect(session.model).toBe('claude-sonnet-4-6');
    // Should still be just 1 session
    const groups = manager.getProjectGroups();
    expect(groups[0].sessions.length).toBe(1);
  });

  it('should reset context on compaction', () => {
    manager.handleSessionStart({
      session_id: 'sess-001',
      cwd: '/project',
      model: 'm',
      source: 'startup',
      transcript_path: '/t',
    });

    // Simulate context buildup
    queries.updateSession('sess-001', { context_percent: 75 });

    manager.handleSessionStart({
      session_id: 'sess-001',
      cwd: '/project',
      model: 'm',
      source: 'compact',
      transcript_path: '/t',
    });

    const session = manager.getSession('sess-001');
    expect(session!.contextPercent).toBe(20);
  });
});

describe('State Machine', () => {
  beforeEach(() => {
    manager.handleSessionStart({
      session_id: 'sess-001',
      cwd: '/project',
      model: 'm',
      source: 'startup',
      transcript_path: '/t',
    });
  });

  it('should transition to active on tool use', () => {
    queries.updateSession('sess-001', { status: 'idle' });
    manager.transitionTo('sess-001', 'active');

    const session = manager.getSession('sess-001');
    expect(session!.status).toBe('active');
  });

  it('should transition to idle on stop', () => {
    manager.handleStop({
      session_id: 'sess-001',
      last_assistant_message: 'Done with the task',
    });

    const session = manager.getSession('sess-001');
    expect(session!.status).toBe('idle');
    expect(session!.lastMessage).toBe('Done with the task');
  });

  it('should transition to waiting_permission', () => {
    manager.transitionTo('sess-001', 'waiting_permission');
    const session = manager.getSession('sess-001');
    expect(session!.status).toBe('waiting_permission');
  });

  it('should transition to stopped on session end', () => {
    manager.handleSessionEnd('sess-001');
    const session = manager.getSession('sess-001');
    expect(session!.status).toBe('stopped');
  });
});

describe('Agents', () => {
  beforeEach(() => {
    manager.handleSessionStart({
      session_id: 'sess-001',
      cwd: '/project',
      model: 'm',
      source: 'startup',
      transcript_path: '/t',
    });
  });

  it('should add an agent', () => {
    manager.addAgent('sess-001', {
      id: 'agent-001',
      type: 'Explore',
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    const session = manager.getSession('sess-001');
    expect(session!.agents.length).toBe(1);
    expect(session!.agents[0].type).toBe('Explore');
    expect(session!.agents[0].status).toBe('running');
  });

  it('should complete an agent with duration', () => {
    const startedAt = new Date(Date.now() - 5000).toISOString();
    manager.addAgent('sess-001', {
      id: 'agent-001',
      type: 'Explore',
      status: 'running',
      startedAt,
    });

    const agent = manager.completeAgent('sess-001', 'agent-001');
    expect(agent).not.toBeNull();
    expect(agent!.status).toBe('completed');
    expect(agent!.duration).toBeGreaterThan(0);
  });
});

describe('Project Grouping', () => {
  it('should group multiple sessions under same project', () => {
    manager.handleSessionStart({ session_id: 's1', cwd: '/projects/api', model: 'm', source: 'startup', transcript_path: '/t' });
    manager.handleSessionStart({ session_id: 's2', cwd: '/projects/api', model: 'm', source: 'startup', transcript_path: '/t' });
    manager.handleSessionStart({ session_id: 's3', cwd: '/projects/web', model: 'm', source: 'startup', transcript_path: '/t' });

    const groups = manager.getProjectGroups();
    expect(groups.length).toBe(2);

    const apiGroup = groups.find(g => g.name === 'api');
    expect(apiGroup!.sessions.length).toBe(2);
  });
});

describe('Staleness', () => {
  it('should mark stale sessions', () => {
    manager.handleSessionStart({ session_id: 's1', cwd: '/p', model: 'm', source: 'startup', transcript_path: '/t' });

    db.prepare("UPDATE sessions SET last_event_at = datetime('now', '-31 minutes') WHERE id = 's1'").run();

    const stale = manager.markStaleSessions();
    expect(stale).toContain('s1');
  });
});
