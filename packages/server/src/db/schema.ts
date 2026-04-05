import type Database from 'better-sqlite3';

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      project_name TEXT NOT NULL,
      model TEXT,
      status TEXT DEFAULT 'active',
      context_percent REAL DEFAULT 0,
      context_units REAL DEFAULT 0,
      started_at TEXT NOT NULL,
      last_event_at TEXT NOT NULL,
      skills TEXT DEFAULT '[]',
      mcps TEXT DEFAULT '[]',
      agents TEXT DEFAULT '[]',
      last_message TEXT,
      event_count INTEGER DEFAULT 0,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      transcript_path TEXT,
      transcript_offset INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      tool_name TEXT,
      tool_input TEXT,
      tool_response TEXT,
      tool_use_id TEXT,
      agent_id TEXT,
      agent_type TEXT,
      success INTEGER DEFAULT 1,
      duration_ms INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_events_tool_use ON events(tool_use_id);

    CREATE TABLE IF NOT EXISTS pending_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      tool_input TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      resolved_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_permissions_status ON pending_permissions(status);
  `);

  // FTS5 — create only if not exists (no IF NOT EXISTS for virtual tables)
  const ftsExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='events_fts'"
  ).get();

  if (!ftsExists) {
    db.exec(`
      CREATE VIRTUAL TABLE events_fts USING fts5(
        tool_name, tool_input, tool_response,
        content='events',
        content_rowid='id'
      );
    `);
  }
}

export function purgeOldEvents(db: Database.Database, daysOld = 7): number {
  const result = db.prepare(
    "DELETE FROM events WHERE created_at < datetime('now', ?)"
  ).run(`-${daysOld} days`);
  return result.changes;
}
