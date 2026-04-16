import type Database from 'better-sqlite3';

export interface XrayConfig {
  server: {
    domain: string;
  };
  dashboard: {
    theme: 'dark' | 'light' | 'auto';
    compact: boolean;
    language: 'es' | 'en';
  };
  sessions: {
    stalenessMinutes: number;
    autoCleanupHours: number;
    maxEvents: number;
    truncateResponseBytes: number;
  };
  permissions: {
    mode: 'intercept' | 'observe';
    timeoutSeconds: number;
    sound: boolean;
    autoApprove: string[];
  };
  projects: {
    aliases: Record<string, string>;
    colors: Record<string, string>;
    hidden: string[];
  };
  display: {
    contextBar: boolean;
    tokens: boolean;
    mcps: boolean;
    skills: boolean;
    agents: boolean;
  };
  data: {
    retentionEventsDays: number;
    retentionSessionsHours: number;
  };
  avatar: {
    name: string;
    agentTypeNames?: Record<string, string>;
  };
}

const DEFAULTS: XrayConfig = {
  server: { domain: '' },
  dashboard: { theme: 'dark', compact: false, language: 'es' },
  sessions: { stalenessMinutes: 30, autoCleanupHours: 24, maxEvents: 500, truncateResponseBytes: 1024 },
  permissions: { mode: 'intercept', timeoutSeconds: 120, sound: false, autoApprove: [] },
  projects: { aliases: {}, colors: {}, hidden: [] },
  display: { contextBar: true, tokens: true, mcps: true, skills: true, agents: true },
  data: { retentionEventsDays: 7, retentionSessionsHours: 24 },
  avatar: { name: '', agentTypeNames: {} },
};

export function initConfigTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

export function getConfig(db: Database.Database): XrayConfig {
  const rows = db.prepare('SELECT key, value FROM config').all() as Array<{ key: string; value: string }>;
  const stored: Record<string, string> = {};
  for (const row of rows) {
    stored[row.key] = row.value;
  }

  // Merge stored values with defaults
  return {
    server: {
      domain: stored['server.domain'] || DEFAULTS.server.domain,
    },
    dashboard: {
      theme: (stored['dashboard.theme'] as XrayConfig['dashboard']['theme']) || DEFAULTS.dashboard.theme,
      compact: stored['dashboard.compact'] === 'true',
      language: (stored['dashboard.language'] as XrayConfig['dashboard']['language']) || DEFAULTS.dashboard.language,
    },
    sessions: {
      stalenessMinutes: parseInt(stored['sessions.staleness_minutes'] || '') || DEFAULTS.sessions.stalenessMinutes,
      autoCleanupHours: parseInt(stored['sessions.auto_cleanup_hours'] || '') || DEFAULTS.sessions.autoCleanupHours,
      maxEvents: parseInt(stored['sessions.max_events'] || '') || DEFAULTS.sessions.maxEvents,
      truncateResponseBytes: parseInt(stored['sessions.truncate_response_bytes'] || '') || DEFAULTS.sessions.truncateResponseBytes,
    },
    permissions: {
      mode: (stored['permissions.mode'] as XrayConfig['permissions']['mode']) || DEFAULTS.permissions.mode,
      timeoutSeconds: parseInt(stored['permissions.timeout_seconds'] || '') || DEFAULTS.permissions.timeoutSeconds,
      sound: stored['permissions.sound'] === 'true',
      autoApprove: stored['permissions.auto_approve'] ? JSON.parse(stored['permissions.auto_approve']) : DEFAULTS.permissions.autoApprove,
    },
    projects: {
      aliases: stored['projects.aliases'] ? JSON.parse(stored['projects.aliases']) : DEFAULTS.projects.aliases,
      colors: stored['projects.colors'] ? JSON.parse(stored['projects.colors']) : DEFAULTS.projects.colors,
      hidden: stored['projects.hidden'] ? JSON.parse(stored['projects.hidden']) : DEFAULTS.projects.hidden,
    },
    display: {
      contextBar: stored['display.context_bar'] !== 'false',
      tokens: stored['display.tokens'] !== 'false',
      mcps: stored['display.mcps'] !== 'false',
      skills: stored['display.skills'] !== 'false',
      agents: stored['display.agents'] !== 'false',
    },
    data: {
      retentionEventsDays: parseInt(stored['data.retention_events_days'] || '') || DEFAULTS.data.retentionEventsDays,
      retentionSessionsHours: parseInt(stored['data.retention_sessions_hours'] || '') || DEFAULTS.data.retentionSessionsHours,
    },
    avatar: {
      name: stored['avatar.name'] || DEFAULTS.avatar.name,
      agentTypeNames: stored['avatar.agent_type_names'] ? JSON.parse(stored['avatar.agent_type_names']) : DEFAULTS.avatar.agentTypeNames,
    },
  };
}

export function updateConfig(db: Database.Database, updates: Record<string, unknown>): void {
  const upsert = db.prepare(
    "INSERT INTO config (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')"
  );

  const flattenAndSave = (obj: Record<string, unknown>, prefix: string) => {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        flattenAndSave(value as Record<string, unknown>, fullKey);
      } else {
        const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
        upsert.run(fullKey, strValue, strValue);
      }
    }
  };

  flattenAndSave(updates, '');
}

export function getDefaults(): XrayConfig {
  return { ...DEFAULTS };
}
