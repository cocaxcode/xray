import { ref, computed } from 'vue';
import type {
  Session, ProjectGroup, ToolEvent, ServerWSEvent, Agent,
  ProjectsResponse, SessionEventsResponse, SessionSummary,
} from '../types';
import { useAuth } from './useAuth';
import { usePermissions } from './usePermissions';

// ── State ──
// Usar ref(Map) — crear nuevo Map en mutaciones para garantizar reactividad de computed
const sessions = ref<Map<string, Session>>(new Map());
const recentActivity = ref<Map<string, Map<string, ToolEvent[]>>>(new Map());
// recentActivity: sessionId → agentId → last 10 events

const MAX_RECENT = 10;

// ── Computed ──

const projectGroups = computed<ProjectGroup[]>(() => {
  const groups = new Map<string, ProjectGroup>();
  const { getBySession } = usePermissions();

  for (const session of sessions.value.values()) {
    const key = session.projectPath;
    if (!groups.has(key)) {
      groups.set(key, {
        name: session.projectName,
        path: session.projectPath,
        sessions: [],
        pendingPermissions: 0,
      });
    }
    const group = groups.get(key)!;
    group.sessions.push(session);
    if (getBySession(session.id)) {
      group.pendingPermissions++;
    }
  }

  return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
});

const totals = computed(() => {
  let activeSessions = 0;
  let idleSessions = 0;

  for (const session of sessions.value.values()) {
    const s = session.status;
    if (s === 'active' || s === 'waiting_permission' || s === 'waiting_input' || s === 'error') {
      activeSessions++;
    } else if (s === 'idle') {
      idleSessions++;
    }
  }

  return {
    projects: projectGroups.value.length,
    activeSessions,
    idleSessions,
    pendingPermissions: usePermissions().count.value,
  };
});

// ── Event Handlers ──

function handleWSEvent(event: ServerWSEvent): void {
  const { addPending, removePending, getBySession } = usePermissions();

  switch (event.type) {
    case 'session:start': {
      const next = new Map(sessions.value);
      next.set(event.data.id, event.data);
      sessions.value = next;
      break;
    }

    case 'session:update': {
      const existing = sessions.value.get(event.data.id);
      if (existing) {
        Object.assign(existing, event.data);
        // Trigger reactivity
        sessions.value = new Map(sessions.value);
      }
      break;
    }

    case 'session:end': {
      const existing = sessions.value.get(event.data.id);
      if (existing) {
        existing.status = 'stopped';
        sessions.value = new Map(sessions.value);
      }
      break;
    }

    case 'tool:activity':
      addToolEvent(event.data);
      // Si llega actividad de una tool, cualquier permiso pendiente de esa sesion ya fue resuelto
      if (event.data.eventType === 'PostToolUse' || event.data.eventType === 'PreToolUse') {
        const sessionPerm = getBySession(event.data.sessionId);
        if (sessionPerm) {
          removePending(sessionPerm.id);
        }
      }
      break;

    case 'permission:pending':
      addPending(event.data);
      break;

    case 'permission:resolved':
      removePending(event.data.id);
      break;

    case 'agent:start': {
      const session = sessions.value.get(event.data.sessionId);
      if (session) {
        session.agents = [...session.agents, event.data.agent];
      }
      break;
    }

    case 'agent:stop': {
      const session = sessions.value.get(event.data.sessionId);
      if (session) {
        const agent = session.agents.find(a => a.id === event.data.agentId);
        if (agent) agent.status = 'completed';
      }
      break;
    }

    case 'notification': {
      const session = sessions.value.get(event.data.sessionId);
      if (session && event.data.type === 'idle_prompt') {
        session.status = 'waiting_input';
        session.lastMessage = event.data.message;
      }
      break;
    }
  }
}

function addToolEvent(event: ToolEvent): void {
  const sessionId = event.sessionId;
  const agentId = event.agentId || 'main';

  if (!recentActivity.value.has(sessionId)) {
    recentActivity.value.set(sessionId, new Map());
  }

  const sessionAgents = recentActivity.value.get(sessionId)!;
  if (!sessionAgents.has(agentId)) {
    sessionAgents.set(agentId, []);
  }

  const agentEvents = sessionAgents.get(agentId)!;

  // For PostToolUse/PostToolUseFailure, update the matching PreToolUse entry
  if (event.eventType === 'PostToolUse' || event.eventType === 'PostToolUseFailure') {
    const preIdx = agentEvents.findIndex(
      e => e.eventType === 'PreToolUse' && e.toolName === event.toolName
    );
    if (preIdx >= 0) {
      agentEvents[preIdx] = event;
      return;
    }
  }

  // Add new event, keep last MAX_RECENT
  agentEvents.unshift(event);
  if (agentEvents.length > MAX_RECENT) {
    agentEvents.pop();
  }
}

// ── API Calls ──

async function loadInitialState(includeStopped = false): Promise<void> {
  const { getAuthHeaders } = useAuth();
  try {
    const url = includeStopped ? '/api/projects?include_stopped=true' : '/api/projects';
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) return;

    const data: ProjectsResponse = await res.json();
    const next = new Map<string, Session>();
    for (const group of data.projects) {
      for (const session of group.sessions) {
        next.set(session.id, session);
      }
    }
    sessions.value = next;

    // Sync active permissions — remove stale ones
    await syncPermissions();
  } catch {
    // Server not reachable
  }
}

async function syncPermissions(): Promise<void> {
  const { getAuthHeaders } = useAuth();
  const { pending, removePending } = usePermissions();
  try {
    const res = await fetch('/api/permissions/pending', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const activeIds: number[] = await res.json();
    const activeSet = new Set(activeIds);

    // Remove permissions from UI that are no longer active on server
    for (const id of pending.value.keys()) {
      if (!activeSet.has(id)) {
        removePending(id);
      }
    }
  } catch {
    // Server not reachable
  }
}

async function fetchSessionEvents(
  sessionId: string,
  page = 1,
  pageSize = 50,
): Promise<SessionEventsResponse | null> {
  const { getAuthHeaders } = useAuth();
  try {
    const res = await fetch(
      `/api/sessions/${sessionId}/events?page=${page}&pageSize=${pageSize}`,
      { headers: getAuthHeaders() },
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchSessionSummary(sessionId: string): Promise<SessionSummary | null> {
  const { getAuthHeaders } = useAuth();
  try {
    const res = await fetch(
      `/api/sessions/${sessionId}/summary`,
      { headers: getAuthHeaders() },
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Helpers ──

function getSessionActivity(sessionId: string): Map<string, ToolEvent[]> {
  return recentActivity.value.get(sessionId) || new Map();
}

export function useSessions() {
  return {
    sessions,
    projectGroups,
    totals,
    handleWSEvent,
    loadInitialState,
    syncPermissions,
    fetchSessionEvents,
    fetchSessionSummary,
    getSessionActivity,
  };
}
