import { ref, computed } from 'vue';
import { useAuth } from './useAuth';

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
    sprite?: string;
  };
  agentTypeNames: Record<string, string>;
}

const config = ref<XrayConfig | null>(null);
const loading = ref(false);

async function loadConfig(): Promise<void> {
  const { getAuthHeaders } = useAuth();
  loading.value = true;
  try {
    const res = await fetch('/api/config', { headers: getAuthHeaders() });
    if (res.ok) {
      config.value = await res.json();
    }
  } catch {
    // Server not reachable
  }
  loading.value = false;
}

async function saveConfig(updates: Record<string, unknown>): Promise<boolean> {
  const { getAuthHeaders } = useAuth();
  try {
    const res = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      config.value = await res.json();
      return true;
    }
  } catch {
    // Error
  }
  return false;
}

function getProjectAlias(path: string): string | null {
  return config.value?.projects.aliases[path] ?? null;
}

function getProjectColor(path: string): string | null {
  return config.value?.projects.colors[path] ?? null;
}

function isProjectHidden(path: string): boolean {
  return config.value?.projects.hidden.includes(path) ?? false;
}

export function useConfig() {
  return {
    config,
    loading,
    loadConfig,
    saveConfig,
    getProjectAlias,
    getProjectColor,
    isProjectHidden,
  };
}
