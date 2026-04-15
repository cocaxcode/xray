import { ref, computed, watch } from 'vue';
import { useSessions } from './useSessions';
import { useConfig } from './useConfig';
import type { ProjectGroup, SessionStatus } from '../types';

const searchQuery = ref('');
const selectedProject = ref<string | null>(null); // null = todos
const statusFilter = ref<Set<SessionStatus>>(new Set(['active', 'idle', 'waiting_permission', 'waiting_input', 'error']));

// Solo recargar del servidor cuando cambia el filtro "stopped"
let lastIncludedStopped = false;
watch(statusFilter, (newFilter) => {
  const includeStopped = newFilter.has('stopped');
  if (includeStopped !== lastIncludedStopped) {
    lastIncludedStopped = includeStopped;
    const { loadInitialState } = useSessions();
    loadInitialState(includeStopped);
  }
}, { deep: true });

const filteredGroups = computed<ProjectGroup[]>(() => {
  const { projectGroups } = useSessions();
  const { isProjectHidden, getProjectAlias } = useConfig();
  const query = searchQuery.value.toLowerCase().trim();

  let groups = projectGroups.value;

  // Filter hidden projects
  groups = groups.filter(g => !isProjectHidden(g.path));

  // Filter by selected project
  if (selectedProject.value) {
    groups = groups.filter(g => g.path === selectedProject.value);
  }

  // Filter by search query. Both `alias` and `session.model` can be null on
  // fresh sessions, so we must guard before calling toLowerCase.
  if (query) {
    groups = groups.filter(g => {
      const alias = getProjectAlias(g.path) || g.name || '';
      if (alias.toLowerCase().includes(query)) return true;
      return g.sessions.some(s =>
        (s.id ?? '').toLowerCase().includes(query) ||
        (s.model ?? '').toLowerCase().includes(query)
      );
    });
  }

  // Filter sessions by status
  groups = groups.map(g => ({
    ...g,
    sessions: g.sessions.filter(s => statusFilter.value.has(s.status)),
  })).filter(g => g.sessions.length > 0);

  return groups;
});

function toggleStatus(status: SessionStatus): void {
  const next = new Set(statusFilter.value);
  if (next.has(status)) {
    next.delete(status);
  } else {
    next.add(status);
  }
  statusFilter.value = next;
}

function selectProject(path: string | null): void {
  selectedProject.value = path;
}

function clearSearch(): void {
  searchQuery.value = '';
}

export function useSearch() {
  return {
    searchQuery,
    selectedProject,
    statusFilter,
    filteredGroups,
    toggleStatus,
    selectProject,
    clearSearch,
  };
}
