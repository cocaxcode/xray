// Polls the token-optimizer global DB and mirrors new rows into xray's optimization_events,
// broadcasting each new event via WebSocket so the dashboard sees activity in real time.
//
// This replaces the fire-and-forget hook→POST pipe which was racing with process.exit(0)
// in the token-optimizer hook and therefore losing events. The token-optimizer hook now
// only writes to its own SQLite DB; xray reads from it cooperatively.

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Queries } from '../db/queries.js';
import type { ServerWSEvent, TokenOptimizerEvent } from '../types.js';

const DEFAULT_POLL_MS = 3000;
const MAX_BATCH = 500;

export interface OptimizerWatcherOptions {
  queries: Queries;
  broadcast: (event: ServerWSEvent) => void;
  globalDbPath?: string;
  intervalMs?: number;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface OptimizerWatcherHandle {
  start(): void;
  stop(): void;
  runOnce(): number;
  getLastId(): number | null;
}

interface ToolCallRow {
  id: number;
  session_id: string;
  tool_name: string;
  source: string;
  output_bytes: number;
  tokens_estimated: number;
  tokens_actual: number | null;
  duration_ms: number | null;
  estimation_method: string | null;
  command_preview: string | null;
  shadow_delta_tokens: number | null;
  created_at: string;
}

function resolveGlobalDbPath(override?: string): string {
  if (override && override.trim().length > 0) return override;
  const envHome = process.env.TOKEN_OPTIMIZER_HOME;
  if (envHome && envHome.trim().length > 0) return join(envHome, 'analytics.db');
  return join(homedir(), '.token-optimizer', 'analytics.db');
}

/**
 * Create a watcher that polls the token-optimizer global DB. The watcher is safe to
 * start even if the DB does not exist yet — it will noop until the file appears.
 *
 * The broadcast callback receives a "tool:event" custom event for each mirrored row
 * so the dashboard can refresh live.
 */
export function createOptimizerWatcher(opts: OptimizerWatcherOptions): OptimizerWatcherHandle {
  const intervalMs = opts.intervalMs ?? DEFAULT_POLL_MS;
  const dbPath = resolveGlobalDbPath(opts.globalDbPath);
  const log = opts.log ?? (() => {});

  let timer: NodeJS.Timeout | null = null;
  let lastId: number | null = null;
  let sourceDb: Database.Database | null = null;
  let running = false;
  let hasCommandPreview: boolean | null = null; // null = not yet checked
  let hasShadowDelta: boolean | null = null; // null = not yet checked

  function openSource(): Database.Database | null {
    if (sourceDb) return sourceDb;
    if (!existsSync(dbPath)) return null;
    try {
      sourceDb = new Database(dbPath, { readonly: true, fileMustExist: true });
      sourceDb.pragma('journal_mode');
      return sourceDb;
    } catch (err) {
      log('optimizer-watcher: failed to open source db', {
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  function closeSource(): void {
    if (sourceDb) {
      try {
        sourceDb.close();
      } catch {
        // swallow
      }
      sourceDb = null;
      hasCommandPreview = null; // re-check on next open
      hasShadowDelta = null;
    }
  }

  function initLastId(db: Database.Database): void {
    if (lastId !== null) return;
    // On first run, resume from the highest source row id we already mirrored.
    // We stash that id in optimization_events.input_hash (as a numeric string) so
    // nothing new needs to be added to xray's schema.
    const row = opts.queries.getMaxMirroredSourceId();
    if (row !== null && row > 0) {
      lastId = row;
      log('optimizer-watcher: resuming from last mirrored id', { lastId });
    } else {
      // No prior mirrored rows: start from the tail of the source to avoid
      // drowning the dashboard with thousands of historical rows on first start.
      const tail = db.prepare(`SELECT MAX(id) as max_id FROM tool_calls`).get() as
        | { max_id: number | null }
        | undefined;
      lastId = tail?.max_id ?? 0;
      log('optimizer-watcher: cold start, skipping history', { lastId });
    }
  }

  function mapRowToEvent(row: ToolCallRow): TokenOptimizerEvent {
    return {
      session_id: row.session_id,
      tool_name: row.tool_name,
      source: row.source as TokenOptimizerEvent['source'],
      tokens_estimated: row.tokens_estimated,
      output_bytes: row.output_bytes,
      duration_ms: row.duration_ms,
      estimation_method: row.estimation_method ?? 'unknown',
      // input_hash piggybacks the source row id so we can resume without duplicates
      input_hash: String(row.id),
      created_at: row.created_at,
      ...(row.command_preview != null && { command_preview: row.command_preview }),
      ...(row.shadow_delta_tokens != null && { shadow_delta_tokens: row.shadow_delta_tokens }),
    };
  }

  function runOnce(): number {
    if (running) return 0;
    running = true;
    try {
      const db = openSource();
      if (!db) return 0;
      initLastId(db);

      // Check whether the source DB has columns that were added in later
      // token-optimizer versions. Re-check while false so we pick them up as
      // soon as token-optimizer migrates the DB (on first tool call).
      if (hasCommandPreview === null || hasCommandPreview === false
          || hasShadowDelta === null || hasShadowDelta === false) {
        const cols = db.prepare(`PRAGMA table_info('tool_calls')`).all() as Array<{ name: string }>;
        const colNames = new Set(cols.map((c) => c.name));
        hasCommandPreview = colNames.has('command_preview');
        hasShadowDelta = colNames.has('shadow_delta_tokens');
      }

      const commandPreviewExpr = hasCommandPreview ? 'command_preview' : 'null as command_preview';
      const shadowDeltaExpr = hasShadowDelta ? 'shadow_delta_tokens' : 'null as shadow_delta_tokens';
      const selectCols =
        `id, session_id, tool_name, source, output_bytes, tokens_estimated,
         tokens_actual, duration_ms, estimation_method, ${commandPreviewExpr}, ${shadowDeltaExpr}, created_at`;

      const rows = db
        .prepare(
          `SELECT ${selectCols}
           FROM tool_calls
           WHERE id > ?
           ORDER BY id ASC
           LIMIT ?`,
        )
        .all(lastId, MAX_BATCH) as ToolCallRow[];

      if (rows.length === 0) return 0;

      let mirrored = 0;
      for (const row of rows) {
        const event = mapRowToEvent(row);
        try {
          opts.queries.insertOptimizationEvent(event);
          opts.broadcast({
            type: 'optimization:event',
            data: {
              sessionId: row.session_id,
              source: row.source,
              tokens: row.tokens_estimated,
              toolName: row.tool_name,
              ...(row.command_preview != null && { commandPreview: row.command_preview }),
              ...(row.shadow_delta_tokens != null && { shadowDelta: row.shadow_delta_tokens }),
            },
          });
          mirrored++;
        } catch (err) {
          log('optimizer-watcher: insert failed', {
            id: row.id,
            err: err instanceof Error ? err.message : String(err),
          });
        }
        lastId = row.id;
      }

      if (mirrored > 0) {
        log('optimizer-watcher: mirrored batch', { mirrored, lastId });
      }
      return mirrored;
    } finally {
      running = false;
    }
  }

  return {
    start(): void {
      if (timer) return;
      // Kick once immediately so the dashboard is never stale on reload.
      runOnce();
      timer = setInterval(runOnce, intervalMs);
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      closeSource();
    },
    runOnce,
    getLastId(): number | null {
      return lastId;
    },
  };
}
