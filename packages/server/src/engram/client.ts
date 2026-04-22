import Database from 'better-sqlite3';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const ENGRAM_DB_PATH = join(homedir(), '.engram', 'engram.db');
export const ENGRAM_HTTP = process.env.ENGRAM_URL || 'http://127.0.0.1:7437';

export interface EngramObservation {
  id: number;
  sync_id: string | null;
  session_id: string;
  type: string;
  title: string;
  content: string;
  tool_name: string | null;
  project: string | null;
  scope: string;
  topic_key: string | null;
  revision_count: number;
  duplicate_count: number;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface EngramSession {
  id: string;
  project: string;
  directory: string;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  observation_count: number;
  prompt_count: number;
}

export interface EngramPrompt {
  id: number;
  session_id: string;
  content: string;
  project: string | null;
  created_at: string;
}

export interface EngramStats {
  total_sessions: number;
  total_observations: number;
  total_prompts: number;
  projects: number;
  types: number;
  last_activity: string | null;
}

export interface EngramStatus {
  available: boolean;
  reason?: string;
  db_path: string;
  db_size_bytes?: number;
  server_reachable?: boolean;
  server_version?: string;
  stats?: EngramStats;
}

export class EngramClient {
  private db: Database.Database | null = null;
  private lastHealthCheck = 0;
  private serverReachable = false;
  private serverVersion: string | null = null;

  open(): Database.Database | null {
    if (this.db) return this.db;
    if (!existsSync(ENGRAM_DB_PATH)) return null;
    try {
      this.db = new Database(ENGRAM_DB_PATH, { readonly: true, fileMustExist: true });
      this.db.pragma('journal_mode = WAL');
      return this.db;
    } catch {
      return null;
    }
  }

  close(): void {
    if (this.db) {
      try { this.db.close(); } catch { /* noop */ }
      this.db = null;
    }
  }

  private async pingServer(): Promise<void> {
    const now = Date.now();
    if (now - this.lastHealthCheck < 5000) return;
    this.lastHealthCheck = now;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 800);
      const res = await fetch(`${ENGRAM_HTTP}/health`, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) {
        const data = await res.json() as { version?: string };
        this.serverReachable = true;
        this.serverVersion = data.version || null;
        return;
      }
    } catch { /* noop */ }
    this.serverReachable = false;
    this.serverVersion = null;
  }

  async status(): Promise<EngramStatus> {
    if (!existsSync(ENGRAM_DB_PATH)) {
      return { available: false, reason: 'engram no está instalado (no existe ~/.engram/engram.db)', db_path: ENGRAM_DB_PATH };
    }
    const db = this.open();
    if (!db) {
      return { available: false, reason: 'no se puede abrir engram.db', db_path: ENGRAM_DB_PATH };
    }
    await this.pingServer();
    const size = statSync(ENGRAM_DB_PATH).size;
    const stats = this.stats();
    return {
      available: true,
      db_path: ENGRAM_DB_PATH,
      db_size_bytes: size,
      server_reachable: this.serverReachable,
      server_version: this.serverVersion || undefined,
      stats,
    };
  }

  stats(): EngramStats {
    const db = this.open();
    if (!db) {
      return { total_sessions: 0, total_observations: 0, total_prompts: 0, projects: 0, types: 0, last_activity: null };
    }
    const s = db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number };
    const o = db.prepare('SELECT COUNT(*) AS c FROM observations WHERE deleted_at IS NULL').get() as { c: number };
    const p = db.prepare('SELECT COUNT(*) AS c FROM user_prompts').get() as { c: number };
    const proj = db.prepare('SELECT COUNT(DISTINCT project) AS c FROM observations WHERE project IS NOT NULL AND deleted_at IS NULL').get() as { c: number };
    const types = db.prepare('SELECT COUNT(DISTINCT type) AS c FROM observations WHERE deleted_at IS NULL').get() as { c: number };
    const last = db.prepare('SELECT MAX(created_at) AS t FROM observations WHERE deleted_at IS NULL').get() as { t: string | null };
    return {
      total_sessions: s.c,
      total_observations: o.c,
      total_prompts: p.c,
      projects: proj.c,
      types: types.c,
      last_activity: last.t,
    };
  }

  facets(): { projects: Array<{ name: string; count: number }>; types: Array<{ name: string; count: number }>; scopes: Array<{ name: string; count: number }> } {
    const db = this.open();
    if (!db) return { projects: [], types: [], scopes: [] };
    const projects = db.prepare(
      `SELECT project AS name, COUNT(*) AS count FROM observations
       WHERE deleted_at IS NULL AND project IS NOT NULL AND project <> ''
       GROUP BY project ORDER BY count DESC`
    ).all() as Array<{ name: string; count: number }>;
    const types = db.prepare(
      `SELECT type AS name, COUNT(*) AS count FROM observations
       WHERE deleted_at IS NULL GROUP BY type ORDER BY count DESC`
    ).all() as Array<{ name: string; count: number }>;
    const scopes = db.prepare(
      `SELECT scope AS name, COUNT(*) AS count FROM observations
       WHERE deleted_at IS NULL GROUP BY scope ORDER BY count DESC`
    ).all() as Array<{ name: string; count: number }>;
    return { projects, types, scopes };
  }

  searchObservations(opts: {
    query?: string;
    project?: string;
    type?: string;
    scope?: string;
    session_id?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): { items: EngramObservation[]; total: number } {
    const db = this.open();
    if (!db) return { items: [], total: 0 };

    const limit = Math.max(1, Math.min(opts.limit ?? 50, 500));
    const offset = Math.max(0, opts.offset ?? 0);

    const where: string[] = ['o.deleted_at IS NULL'];
    const params: Record<string, unknown> = {};

    if (opts.project) { where.push('o.project = @project'); params.project = opts.project; }
    if (opts.type) { where.push('o.type = @type'); params.type = opts.type; }
    if (opts.scope) { where.push('o.scope = @scope'); params.scope = opts.scope; }
    if (opts.session_id) { where.push('o.session_id = @session_id'); params.session_id = opts.session_id; }
    if (opts.from) { where.push('o.created_at >= @from'); params.from = opts.from; }
    if (opts.to) { where.push('o.created_at <= @to'); params.to = opts.to; }

    const q = (opts.query || '').trim();
    let joinFts = '';
    let orderBy = 'o.created_at DESC';
    if (q) {
      const sanitized = this.sanitizeFts(q);
      if (sanitized) {
        joinFts = 'JOIN observations_fts f ON f.rowid = o.id';
        where.push('f.observations_fts MATCH @q');
        params.q = sanitized;
        orderBy = 'f.rank';
      } else {
        const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
        where.push('(o.title LIKE @like ESCAPE \'\\\' OR o.content LIKE @like ESCAPE \'\\\')');
        params.like = like;
      }
    }

    const whereSql = where.join(' AND ');
    const totalRow = db.prepare(
      `SELECT COUNT(*) AS c FROM observations o ${joinFts} WHERE ${whereSql}`
    ).get(params) as { c: number };

    const items = db.prepare(
      `SELECT o.* FROM observations o ${joinFts}
       WHERE ${whereSql}
       ORDER BY ${orderBy}
       LIMIT @limit OFFSET @offset`
    ).all({ ...params, limit, offset }) as EngramObservation[];

    return { items, total: totalRow.c };
  }

  getObservation(id: number): EngramObservation | null {
    const db = this.open();
    if (!db) return null;
    return db.prepare('SELECT * FROM observations WHERE id = ?').get(id) as EngramObservation || null;
  }

  listSessions(opts: { project?: string; limit?: number; offset?: number }): { items: EngramSession[]; total: number } {
    const db = this.open();
    if (!db) return { items: [], total: 0 };
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 500));
    const offset = Math.max(0, opts.offset ?? 0);

    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (opts.project) { where.push('s.project = @project'); params.project = opts.project; }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM sessions s ${whereSql}`).get(params) as { c: number };

    const items = db.prepare(
      `SELECT s.*,
         (SELECT COUNT(*) FROM observations o WHERE o.session_id = s.id AND o.deleted_at IS NULL) AS observation_count,
         (SELECT COUNT(*) FROM user_prompts p WHERE p.session_id = s.id) AS prompt_count
       FROM sessions s ${whereSql}
       ORDER BY s.started_at DESC
       LIMIT @limit OFFSET @offset`
    ).all({ ...params, limit, offset }) as EngramSession[];

    return { items, total: totalRow.c };
  }

  listPrompts(opts: { project?: string; session_id?: string; query?: string; limit?: number; offset?: number }): { items: EngramPrompt[]; total: number } {
    const db = this.open();
    if (!db) return { items: [], total: 0 };
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 500));
    const offset = Math.max(0, opts.offset ?? 0);

    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (opts.project) { where.push('p.project = @project'); params.project = opts.project; }
    if (opts.session_id) { where.push('p.session_id = @session_id'); params.session_id = opts.session_id; }

    let joinFts = '';
    const q = (opts.query || '').trim();
    if (q) {
      const sanitized = this.sanitizeFts(q);
      if (sanitized) {
        joinFts = 'JOIN prompts_fts f ON f.rowid = p.id';
        where.push('f.prompts_fts MATCH @q');
        params.q = sanitized;
      } else {
        const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
        where.push('p.content LIKE @like ESCAPE \'\\\'');
        params.like = like;
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM user_prompts p ${joinFts} ${whereSql}`).get(params) as { c: number };

    const items = db.prepare(
      `SELECT p.* FROM user_prompts p ${joinFts} ${whereSql}
       ORDER BY p.created_at DESC LIMIT @limit OFFSET @offset`
    ).all({ ...params, limit, offset }) as EngramPrompt[];

    return { items, total: totalRow.c };
  }

  timeline(opts: { project?: string; days?: number }): Array<{ date: string; observations: number; prompts: number }> {
    const db = this.open();
    if (!db) return [];
    const days = Math.max(1, Math.min(opts.days ?? 30, 365));

    const projectFilter = opts.project ? 'AND project = @project' : '';
    const params: Record<string, unknown> = { days };
    if (opts.project) params.project = opts.project;

    const obs = db.prepare(
      `SELECT substr(created_at, 1, 10) AS date, COUNT(*) AS c
       FROM observations
       WHERE deleted_at IS NULL
         AND created_at >= datetime('now', '-' || @days || ' days')
         ${projectFilter}
       GROUP BY date`
    ).all(params) as Array<{ date: string; c: number }>;

    const prm = db.prepare(
      `SELECT substr(created_at, 1, 10) AS date, COUNT(*) AS c
       FROM user_prompts
       WHERE created_at >= datetime('now', '-' || @days || ' days')
         ${projectFilter}
       GROUP BY date`
    ).all(params) as Array<{ date: string; c: number }>;

    const byDate = new Map<string, { observations: number; prompts: number }>();
    for (const r of obs) byDate.set(r.date, { observations: r.c, prompts: 0 });
    for (const r of prm) {
      const e = byDate.get(r.date) ?? { observations: 0, prompts: 0 };
      e.prompts = r.c;
      byDate.set(r.date, e);
    }

    const out: Array<{ date: string; observations: number; prompts: number }> = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      const e = byDate.get(key) ?? { observations: 0, prompts: 0 };
      out.push({ date: key, observations: e.observations, prompts: e.prompts });
    }
    return out;
  }

  topicKeys(opts: { project?: string; limit?: number }): Array<{ topic_key: string; count: number; last_updated: string }> {
    const db = this.open();
    if (!db) return [];
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
    const projectFilter = opts.project ? 'AND project = @project' : '';
    const params: Record<string, unknown> = { limit };
    if (opts.project) params.project = opts.project;
    return db.prepare(
      `SELECT topic_key, COUNT(*) AS count, MAX(updated_at) AS last_updated
       FROM observations
       WHERE topic_key IS NOT NULL AND topic_key <> '' AND deleted_at IS NULL ${projectFilter}
       GROUP BY topic_key
       ORDER BY last_updated DESC
       LIMIT @limit`
    ).all(params) as Array<{ topic_key: string; count: number; last_updated: string }>;
  }

  /**
   * Sanitize user input for FTS5 MATCH: wrap each term in quotes and drop
   * operator tokens. Returns null if nothing usable remains.
   */
  private sanitizeFts(input: string): string | null {
    const tokens = input
      .split(/\s+/)
      .map(t => t.replace(/["\\]/g, ''))
      .filter(t => t.length >= 2 && !/^(AND|OR|NOT|NEAR)$/i.test(t));
    if (tokens.length === 0) return null;
    return tokens.map(t => `"${t}"*`).join(' ');
  }
}

export const engramClient = new EngramClient();
