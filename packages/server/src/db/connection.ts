import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

let db: Database.Database | null = null;

export function getDbPath(): string {
  const xrayDir = join(homedir(), '.xray');
  if (!existsSync(xrayDir)) {
    mkdirSync(xrayDir, { recursive: true });
  }
  return join(xrayDir, 'data.db');
}

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(getDbPath());
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
