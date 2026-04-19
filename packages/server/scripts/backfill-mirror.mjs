#!/usr/bin/env node
// Backfill optimization_events mirror from token-optimizer analytics.db.
// Safe to run multiple times: uses INSERT OR IGNORE on the UNIQUE input_hash index.
//
// Usage:
//   node scripts/backfill-mirror.mjs              # backfill all missing rows
//   node scripts/backfill-mirror.mjs --dry-run    # report what would be inserted
//
// Env overrides:
//   TOKEN_OPTIMIZER_HOME  -> source DB dir (default ~/.token-optimizer)
//   XRAY_HOME             -> target DB dir (default ~/.xray)

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const dry = process.argv.includes('--dry-run');

const srcPath = join(process.env.TOKEN_OPTIMIZER_HOME ?? join(homedir(), '.token-optimizer'), 'analytics.db');
const dstPath = join(process.env.XRAY_HOME ?? join(homedir(), '.xray'), 'data.db');

if (!existsSync(srcPath)) {
  console.error(`source DB not found: ${srcPath}`);
  process.exit(1);
}
if (!existsSync(dstPath)) {
  console.error(`mirror DB not found: ${dstPath}`);
  process.exit(1);
}

const src = new Database(srcPath, { readonly: true, fileMustExist: true });
const dst = new Database(dstPath, { readonly: dry, fileMustExist: true });

const before = dst.prepare(`SELECT source, COUNT(*) AS n FROM optimization_events GROUP BY source`).all();
console.log('mirror antes:', Object.fromEntries(before.map(r => [r.source, r.n])));

const cols = new Set(
  src.prepare(`PRAGMA table_info('tool_calls')`).all().map(c => c.name),
);
const hasCommandPreview = cols.has('command_preview');
const hasShadowDelta = cols.has('shadow_delta_tokens');

const select = `
  SELECT id, session_id, tool_name, source, output_bytes, tokens_estimated,
         duration_ms, estimation_method, created_at,
         ${hasCommandPreview ? 'command_preview' : 'NULL AS command_preview'},
         ${hasShadowDelta ? 'shadow_delta_tokens' : 'NULL AS shadow_delta_tokens'}
  FROM tool_calls
  ORDER BY id ASC
`;

const rows = src.prepare(select).all();
console.log(`source rows: ${rows.length}`);

const existsStmt = dst.prepare(
  `SELECT 1 FROM optimization_events WHERE input_hash = ? LIMIT 1`,
);

if (dry) {
  const missingBySource = {};
  for (const r of rows) {
    if (!existsStmt.get(String(r.id))) {
      missingBySource[r.source] = (missingBySource[r.source] ?? 0) + 1;
    }
  }
  console.log('faltan en mirror:', missingBySource);
  process.exit(0);
}

const insert = dst.prepare(`
  INSERT OR IGNORE INTO optimization_events (
    session_id, tool_name, source, tokens_estimated, output_bytes,
    duration_ms, estimation_method, input_hash, created_at,
    project_path, project_name, command_preview, shadow_delta_tokens
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const sessionProject = dst.prepare(
  `SELECT project_path, project_name FROM sessions WHERE id = ? LIMIT 1`,
);

const tx = dst.transaction((batch) => {
  let inserted = 0;
  for (const r of batch) {
    const sess = sessionProject.get(r.session_id) ?? { project_path: null, project_name: null };
    const info = insert.run(
      r.session_id,
      r.tool_name,
      r.source,
      r.tokens_estimated,
      r.output_bytes,
      r.duration_ms,
      r.estimation_method,
      String(r.id),
      r.created_at,
      sess.project_path,
      sess.project_name,
      r.command_preview,
      r.shadow_delta_tokens,
    );
    if (info.changes > 0) inserted++;
  }
  return inserted;
});

const inserted = tx(rows);
console.log(`insertadas: ${inserted}`);

const after = dst.prepare(`SELECT source, COUNT(*) AS n FROM optimization_events GROUP BY source`).all();
console.log('mirror después:', Object.fromEntries(after.map(r => [r.source, r.n])));

src.close();
dst.close();
