import type Database from 'better-sqlite3';

const CURRENT_VERSION = 6;

/**
 * Sistema de migraciones para SQLite.
 * Cada version añade cambios incrementales al schema.
 * Nunca hay que borrar la DB manualmente.
 */
export function initSchema(db: Database.Database): void {
  // Crear tabla de version si no existe
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`);

  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  const currentVersion = row?.version ?? 0;

  if (currentVersion === 0) {
    // Primera instalacion: crear todo desde cero
    createTablesV1(db);
    migrateToV2(db);
    migrateToV3(db);
    migrateToV4(db);
    migrateToV5(db);
    migrateToV6(db);
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(CURRENT_VERSION);
  } else {
    // Migraciones incrementales
    if (currentVersion < 2) migrateToV2(db);
    if (currentVersion < 3) migrateToV3(db);
    if (currentVersion < 4) migrateToV4(db);
    if (currentVersion < 5) migrateToV5(db);
    if (currentVersion < 6) migrateToV6(db);

    // Actualizar version
    if (currentVersion < CURRENT_VERSION) {
      db.prepare('UPDATE schema_version SET version = ?').run(CURRENT_VERSION);
    }
  }
}

/** Schema original v1 */
function createTablesV1(db: Database.Database): void {
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

  // FTS5
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

/** v2: añade columna topic a sessions */
function migrateToV2(db: Database.Database): void {
  // Verificar si la columna ya existe (por si la DB fue creada con el schema nuevo)
  const columns = db.prepare("PRAGMA table_info('sessions')").all() as Array<{ name: string }>;
  const hasTopicColumn = columns.some(c => c.name === 'topic');

  if (!hasTopicColumn) {
    db.exec('ALTER TABLE sessions ADD COLUMN topic TEXT');
  }
}

/** v3: tablas de integración con token-optimizer */
function migrateToV3(db: Database.Database): void {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table'"
  ).all() as Array<{ name: string }>;
  const tableNames = new Set(tables.map(t => t.name));

  if (!tableNames.has('optimization_events')) {
    db.exec(`
      CREATE TABLE optimization_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        source TEXT NOT NULL,
        tokens_estimated INTEGER NOT NULL,
        output_bytes INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER,
        estimation_method TEXT NOT NULL,
        input_hash TEXT,
        created_at TEXT NOT NULL,
        received_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX idx_opt_events_session ON optimization_events(session_id);
      CREATE INDEX idx_opt_events_created ON optimization_events(created_at);
      CREATE INDEX idx_opt_events_source ON optimization_events(source);
    `);
  }

  if (!tableNames.has('optimization_summaries')) {
    db.exec(`
      CREATE TABLE optimization_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL UNIQUE,
        total_tokens INTEGER NOT NULL,
        total_events INTEGER NOT NULL,
        by_source TEXT NOT NULL,
        by_tool TEXT NOT NULL,
        cost_haiku REAL,
        cost_sonnet REAL,
        cost_opus REAL,
        probes TEXT,
        coach_tips_surfaced TEXT,
        schema_measurement TEXT,
        optimizer_version TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
    `);
  }
}

/** v4: project context en optimization_events */
function migrateToV4(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info('optimization_events')").all() as Array<{ name: string }>;
  const colNames = new Set(columns.map(c => c.name));

  if (!colNames.has('project_path')) {
    db.exec("ALTER TABLE optimization_events ADD COLUMN project_path TEXT");
  }
  if (!colNames.has('project_name')) {
    db.exec("ALTER TABLE optimization_events ADD COLUMN project_name TEXT");
  }
}

/** v5: command_preview en optimization_events */
function migrateToV5(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info('optimization_events')").all() as Array<{ name: string }>;
  const colNames = new Set(columns.map(c => c.name));

  if (!colNames.has('command_preview')) {
    db.exec("ALTER TABLE optimization_events ADD COLUMN command_preview TEXT");
  }
}

/**
 * v6: shadow_delta_tokens en optimization_events.
 *
 * Lo que aporta: el token-optimizer-mcp rellena esta columna por cada evento
 * donde sabe medir el delta vs la alternativa (serena vs Read, rtk vs Bash).
 * Con esto, xray puede calcular el factor de ahorro MEDIDO en vez de aplicar
 * la constante ×5 / ×4 que traía hardcodeada en la UI.
 */
function migrateToV6(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info('optimization_events')").all() as Array<{ name: string }>;
  const colNames = new Set(columns.map(c => c.name));

  if (!colNames.has('shadow_delta_tokens')) {
    db.exec("ALTER TABLE optimization_events ADD COLUMN shadow_delta_tokens INTEGER");
  }
}

export function purgeOldEvents(db: Database.Database, daysOld = 7): number {
  const result = db.prepare(
    "DELETE FROM events WHERE created_at < datetime('now', ?)"
  ).run(`-${daysOld} days`);
  return result.changes;
}

export function purgeOldSessions(db: Database.Database, hoursOld = 24): number {
  const param = `-${hoursOld} hours`;

  const purge = db.transaction(() => {
    db.prepare(
      "DELETE FROM events WHERE session_id IN (SELECT id FROM sessions WHERE status = 'stopped' AND last_event_at < datetime('now', ?))"
    ).run(param);

    db.prepare(
      "DELETE FROM pending_permissions WHERE session_id IN (SELECT id FROM sessions WHERE status = 'stopped' AND last_event_at < datetime('now', ?))"
    ).run(param);

    db.prepare(
      "DELETE FROM optimization_events WHERE session_id IN (SELECT id FROM sessions WHERE status = 'stopped' AND last_event_at < datetime('now', ?))"
    ).run(param);

    db.prepare(
      "DELETE FROM optimization_summaries WHERE session_id IN (SELECT id FROM sessions WHERE status = 'stopped' AND last_event_at < datetime('now', ?))"
    ).run(param);

    const result = db.prepare(
      "DELETE FROM sessions WHERE status = 'stopped' AND last_event_at < datetime('now', ?)"
    ).run(param);

    return result.changes;
  });

  return purge();
}
