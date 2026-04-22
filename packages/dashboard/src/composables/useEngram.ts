import { ref, computed } from 'vue';
import { useAuth } from './useAuth';

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

export interface Observation {
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

export interface Facets {
  projects: Array<{ name: string; count: number }>;
  types: Array<{ name: string; count: number }>;
  scopes: Array<{ name: string; count: number }>;
}

export interface TimelinePoint { date: string; observations: number; prompts: number }
export interface TopicKey { topic_key: string; count: number; last_updated: string }

export type EngramTab = 'observations' | 'sessions' | 'prompts' | 'topics';

const status = ref<EngramStatus | null>(null);
const facets = ref<Facets>({ projects: [], types: [], scopes: [] });
const observations = ref<Observation[]>([]);
const observationsTotal = ref(0);
const sessions = ref<EngramSession[]>([]);
const sessionsTotal = ref(0);
const prompts = ref<EngramPrompt[]>([]);
const promptsTotal = ref(0);
const topics = ref<TopicKey[]>([]);
const timeline = ref<TimelinePoint[]>([]);
const selectedObservation = ref<Observation | null>(null);
const loading = ref(false);

const activeTab = ref<EngramTab>('observations');
const filters = ref({
  q: '',
  project: '' as string,
  type: '' as string,
  scope: '' as string,
  session_id: '' as string,
});
const page = ref(1);
const pageSize = 50;

async function authedFetch(url: string): Promise<Response> {
  const { getAuthHeaders } = useAuth();
  return fetch(url, { headers: getAuthHeaders() });
}

async function loadStatus(): Promise<void> {
  try {
    const res = await authedFetch('/api/engram/status');
    if (res.ok) status.value = await res.json();
  } catch {
    status.value = { available: false, reason: 'no se pudo contactar con el servidor', db_path: '' };
  }
}

async function loadFacets(): Promise<void> {
  try {
    const res = await authedFetch('/api/engram/facets');
    if (res.ok) facets.value = await res.json();
  } catch { /* noop */ }
}

function buildQS(): string {
  const qs = new URLSearchParams();
  const f = filters.value;
  if (f.q) qs.set('q', f.q);
  if (f.project) qs.set('project', f.project);
  if (f.type) qs.set('type', f.type);
  if (f.scope) qs.set('scope', f.scope);
  if (f.session_id) qs.set('session_id', f.session_id);
  qs.set('limit', String(pageSize));
  qs.set('offset', String((page.value - 1) * pageSize));
  return qs.toString();
}

async function loadObservations(): Promise<void> {
  loading.value = true;
  try {
    const res = await authedFetch(`/api/engram/observations?${buildQS()}`);
    if (res.ok) {
      const data = await res.json();
      observations.value = data.items;
      observationsTotal.value = data.total;
    }
  } finally { loading.value = false; }
}

async function loadSessions(): Promise<void> {
  loading.value = true;
  try {
    const qs = new URLSearchParams();
    if (filters.value.project) qs.set('project', filters.value.project);
    qs.set('limit', String(pageSize));
    qs.set('offset', String((page.value - 1) * pageSize));
    const res = await authedFetch(`/api/engram/sessions?${qs}`);
    if (res.ok) {
      const data = await res.json();
      sessions.value = data.items;
      sessionsTotal.value = data.total;
    }
  } finally { loading.value = false; }
}

async function loadPrompts(): Promise<void> {
  loading.value = true;
  try {
    const qs = new URLSearchParams();
    if (filters.value.project) qs.set('project', filters.value.project);
    if (filters.value.session_id) qs.set('session_id', filters.value.session_id);
    if (filters.value.q) qs.set('q', filters.value.q);
    qs.set('limit', String(pageSize));
    qs.set('offset', String((page.value - 1) * pageSize));
    const res = await authedFetch(`/api/engram/prompts?${qs}`);
    if (res.ok) {
      const data = await res.json();
      prompts.value = data.items;
      promptsTotal.value = data.total;
    }
  } finally { loading.value = false; }
}

async function loadTopics(): Promise<void> {
  loading.value = true;
  try {
    const qs = new URLSearchParams();
    if (filters.value.project) qs.set('project', filters.value.project);
    qs.set('limit', '100');
    const res = await authedFetch(`/api/engram/topics?${qs}`);
    if (res.ok) {
      const data = await res.json();
      topics.value = data.items;
    }
  } finally { loading.value = false; }
}

async function loadTimeline(): Promise<void> {
  try {
    const qs = new URLSearchParams();
    if (filters.value.project) qs.set('project', filters.value.project);
    qs.set('days', '30');
    const res = await authedFetch(`/api/engram/timeline?${qs}`);
    if (res.ok) {
      const data = await res.json();
      timeline.value = data.points;
    }
  } catch { /* noop */ }
}

async function loadActiveTab(): Promise<void> {
  if (activeTab.value === 'observations') await loadObservations();
  else if (activeTab.value === 'sessions') await loadSessions();
  else if (activeTab.value === 'prompts') await loadPrompts();
  else if (activeTab.value === 'topics') await loadTopics();
}

async function refreshAll(): Promise<void> {
  await loadStatus();
  if (!status.value?.available) return;
  await Promise.all([loadFacets(), loadTimeline(), loadActiveTab()]);
}

function setTab(tab: EngramTab): void {
  activeTab.value = tab;
  page.value = 1;
  loadActiveTab();
}

function resetFilters(): void {
  filters.value = { q: '', project: '', type: '', scope: '', session_id: '' };
  page.value = 1;
  loadActiveTab();
  loadTimeline();
}

function applyFilters(): void {
  page.value = 1;
  loadActiveTab();
  loadTimeline();
}

function nextPage(): void {
  const total = activeTab.value === 'observations' ? observationsTotal.value
    : activeTab.value === 'sessions' ? sessionsTotal.value
    : promptsTotal.value;
  if (page.value * pageSize >= total) return;
  page.value++;
  loadActiveTab();
}
function prevPage(): void {
  if (page.value <= 1) return;
  page.value--;
  loadActiveTab();
}

async function openObservation(id: number): Promise<void> {
  try {
    const res = await authedFetch(`/api/engram/observations/${id}`);
    if (res.ok) selectedObservation.value = await res.json();
  } catch { /* noop */ }
}

function closeObservation(): void {
  selectedObservation.value = null;
}

function filterBySession(sessionId: string): void {
  filters.value.session_id = sessionId;
  activeTab.value = 'observations';
  page.value = 1;
  loadActiveTab();
}

function filterByTopic(topicKey: string): void {
  filters.value.q = topicKey;
  activeTab.value = 'observations';
  page.value = 1;
  loadActiveTab();
}

const currentTotal = computed(() => {
  if (activeTab.value === 'observations') return observationsTotal.value;
  if (activeTab.value === 'sessions') return sessionsTotal.value;
  if (activeTab.value === 'prompts') return promptsTotal.value;
  return topics.value.length;
});

export function useEngram() {
  return {
    status,
    facets,
    observations,
    observationsTotal,
    sessions,
    sessionsTotal,
    prompts,
    promptsTotal,
    topics,
    timeline,
    selectedObservation,
    loading,
    activeTab,
    filters,
    page,
    pageSize,
    currentTotal,
    refreshAll,
    loadStatus,
    loadActiveTab,
    setTab,
    resetFilters,
    applyFilters,
    nextPage,
    prevPage,
    openObservation,
    closeObservation,
    filterBySession,
    filterByTopic,
  };
}
