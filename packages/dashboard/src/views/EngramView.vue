<script setup lang="ts">
import { onMounted, computed, watch } from 'vue';
import { useEngram } from '../composables/useEngram';

const {
  status,
  facets,
  observations,
  sessions,
  prompts,
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
  setTab,
  resetFilters,
  applyFilters,
  nextPage,
  prevPage,
  openObservation,
  closeObservation,
  filterBySession,
  filterByTopic,
} = useEngram();

onMounted(() => refreshAll());

const maxTimeline = computed(() => Math.max(1, ...timeline.value.map(p => p.observations + p.prompts)));

function fmtDate(s: string | null): string {
  if (!s) return '—';
  try {
    const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
    return d.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return s; }
}

function fmtBytes(b: number | undefined): string {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

const typeColors: Record<string, string> = {
  decision: 'bg-cyan/15 text-cyan border-cyan/30',
  architecture: 'bg-purple/15 text-purple border-purple/30',
  bugfix: 'bg-red/15 text-red border-red/30',
  pattern: 'bg-amber/15 text-amber border-amber/30',
  config: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  discovery: 'bg-green/15 text-green border-green/30',
  learning: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
  session_summary: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  manual: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
};
function typeClass(t: string): string {
  return typeColors[t] || 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30';
}

// Debounce search: re-query after user stops typing
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(() => filters.value.q, () => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => applyFilters(), 300);
});
</script>

<template>
  <div class="flex-1 overflow-hidden flex flex-col bg-bg">
    <!-- Engram NOT available -->
    <div v-if="status && !status.available" class="flex-1 flex items-center justify-center p-8">
      <div class="max-w-lg text-center space-y-4">
        <div class="mx-auto w-16 h-16 rounded-full bg-purple/20 flex items-center justify-center">
          <svg class="w-8 h-8 text-purple" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 class="text-lg font-semibold text-text">Engram no está disponible</h2>
        <p class="text-sm text-muted">{{ status.reason }}</p>
        <div class="bg-surface border border-border rounded-md p-4 text-left font-mono text-[11px] text-muted space-y-1">
          <p class="text-text font-semibold">Instalar engram:</p>
          <p>go install github.com/Gentleman-Programming/engram/cmd/engram@latest</p>
          <p>engram setup claude-code</p>
        </div>
        <button @click="refreshAll" class="text-xs font-mono text-cyan hover:text-cyan/80 underline">
          Reintentar
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-else-if="!status" class="flex-1 flex items-center justify-center">
      <span class="text-muted text-sm font-mono">Cargando engram…</span>
    </div>

    <!-- Available -->
    <div v-else class="flex-1 flex overflow-hidden">
      <!-- Sidebar: stats + filtros -->
      <aside class="w-64 border-r border-border bg-surface overflow-y-auto flex-shrink-0 p-3 space-y-4">
        <!-- Status -->
        <div>
          <h3 class="text-[10px] font-mono uppercase text-muted tracking-wider mb-2">Estado</h3>
          <div class="space-y-1 text-[11px] font-mono">
            <div class="flex items-center gap-2">
              <span class="h-2 w-2 rounded-full" :class="status.server_reachable ? 'bg-green' : 'bg-amber'"></span>
              <span class="text-text">{{ status.server_reachable ? 'server on :7437' : 'solo DB (sin server)' }}</span>
            </div>
            <div class="text-muted" v-if="status.server_version">v{{ status.server_version }}</div>
            <div class="text-muted">DB: {{ fmtBytes(status.db_size_bytes) }}</div>
          </div>
        </div>

        <!-- Global stats -->
        <div>
          <h3 class="text-[10px] font-mono uppercase text-muted tracking-wider mb-2">Totales</h3>
          <div class="grid grid-cols-2 gap-2">
            <div class="bg-bg border border-border rounded-md p-2">
              <div class="text-[9px] text-muted uppercase">Observaciones</div>
              <div class="text-sm font-semibold text-cyan">{{ status.stats?.total_observations ?? 0 }}</div>
            </div>
            <div class="bg-bg border border-border rounded-md p-2">
              <div class="text-[9px] text-muted uppercase">Sesiones</div>
              <div class="text-sm font-semibold text-purple">{{ status.stats?.total_sessions ?? 0 }}</div>
            </div>
            <div class="bg-bg border border-border rounded-md p-2">
              <div class="text-[9px] text-muted uppercase">Prompts</div>
              <div class="text-sm font-semibold text-text">{{ status.stats?.total_prompts ?? 0 }}</div>
            </div>
            <div class="bg-bg border border-border rounded-md p-2">
              <div class="text-[9px] text-muted uppercase">Proyectos</div>
              <div class="text-sm font-semibold text-text">{{ status.stats?.projects ?? 0 }}</div>
            </div>
          </div>
        </div>

        <!-- Filtros -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-[10px] font-mono uppercase text-muted tracking-wider">Filtros</h3>
            <button @click="resetFilters" class="text-[10px] font-mono text-muted hover:text-text">reset</button>
          </div>
          <div class="space-y-2">
            <label class="block">
              <span class="text-[9px] font-mono uppercase text-muted">Proyecto</span>
              <select v-model="filters.project" @change="applyFilters" class="w-full mt-1 h-7 px-2 text-[11px] font-mono bg-bg border border-border rounded text-text focus:border-cyan focus:outline-none">
                <option value="">Todos</option>
                <option v-for="p in facets.projects" :key="p.name" :value="p.name">{{ p.name }} ({{ p.count }})</option>
              </select>
            </label>
            <label class="block">
              <span class="text-[9px] font-mono uppercase text-muted">Tipo</span>
              <select v-model="filters.type" @change="applyFilters" class="w-full mt-1 h-7 px-2 text-[11px] font-mono bg-bg border border-border rounded text-text focus:border-cyan focus:outline-none">
                <option value="">Todos</option>
                <option v-for="t in facets.types" :key="t.name" :value="t.name">{{ t.name }} ({{ t.count }})</option>
              </select>
            </label>
            <label class="block">
              <span class="text-[9px] font-mono uppercase text-muted">Scope</span>
              <select v-model="filters.scope" @change="applyFilters" class="w-full mt-1 h-7 px-2 text-[11px] font-mono bg-bg border border-border rounded text-text focus:border-cyan focus:outline-none">
                <option value="">Todos</option>
                <option v-for="s in facets.scopes" :key="s.name" :value="s.name">{{ s.name }} ({{ s.count }})</option>
              </select>
            </label>
            <div v-if="filters.session_id" class="flex items-center gap-1 bg-cyan/10 border border-cyan/30 rounded px-2 py-1 text-[10px] font-mono text-cyan">
              <span class="truncate flex-1">session: {{ filters.session_id.slice(0, 12) }}…</span>
              <button @click="filters.session_id = ''; applyFilters()" class="hover:text-text">✕</button>
            </div>
          </div>
        </div>

        <!-- Timeline -->
        <div>
          <h3 class="text-[10px] font-mono uppercase text-muted tracking-wider mb-2">Actividad (30d)</h3>
          <div class="flex items-end gap-[1px] h-12 bg-bg border border-border rounded px-1 py-1">
            <div v-for="p in timeline" :key="p.date"
                 class="flex-1 min-w-[2px] flex flex-col justify-end"
                 :title="`${p.date}: ${p.observations} obs · ${p.prompts} prompts`">
              <div v-if="p.observations" class="bg-cyan w-full" :style="{ height: ((p.observations / maxTimeline) * 100) + '%' }"></div>
              <div v-if="p.prompts" class="bg-purple w-full" :style="{ height: ((p.prompts / maxTimeline) * 100) + '%' }"></div>
            </div>
          </div>
          <div class="flex gap-3 mt-1 text-[9px] font-mono text-muted">
            <span class="flex items-center gap-1"><span class="w-2 h-2 bg-cyan"></span>obs</span>
            <span class="flex items-center gap-1"><span class="w-2 h-2 bg-purple"></span>prompt</span>
          </div>
        </div>
      </aside>

      <!-- Main -->
      <div class="flex-1 flex flex-col overflow-hidden">
        <!-- Header: search + tabs -->
        <div class="border-b border-border bg-surface px-3 py-2 flex items-center gap-3 flex-shrink-0">
          <div class="relative flex-1 max-w-md">
            <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              v-model="filters.q"
              type="text"
              placeholder="Buscar (FTS5)…"
              class="w-full h-8 pl-8 pr-3 text-xs font-mono bg-bg border border-border rounded-md text-text placeholder:text-muted focus:border-cyan focus:outline-none"
            />
          </div>
          <div class="flex items-center gap-1 border border-border rounded-md p-0.5">
            <button @click="setTab('observations')" class="text-[10px] font-mono px-2 py-1 rounded transition-colors" :class="activeTab === 'observations' ? 'bg-cyan/20 text-cyan' : 'text-muted hover:text-text'">
              Observaciones
            </button>
            <button @click="setTab('sessions')" class="text-[10px] font-mono px-2 py-1 rounded transition-colors" :class="activeTab === 'sessions' ? 'bg-purple/20 text-purple' : 'text-muted hover:text-text'">
              Sesiones
            </button>
            <button @click="setTab('prompts')" class="text-[10px] font-mono px-2 py-1 rounded transition-colors" :class="activeTab === 'prompts' ? 'bg-cyan/20 text-cyan' : 'text-muted hover:text-text'">
              Prompts
            </button>
            <button @click="setTab('topics')" class="text-[10px] font-mono px-2 py-1 rounded transition-colors" :class="activeTab === 'topics' ? 'bg-amber/20 text-amber' : 'text-muted hover:text-text'">
              Topics
            </button>
          </div>
          <div class="text-[10px] font-mono text-muted ml-auto">
            {{ loading ? 'cargando…' : `${currentTotal} resultados` }}
          </div>
        </div>

        <!-- List -->
        <div class="flex-1 overflow-y-auto">
          <!-- Observations -->
          <div v-if="activeTab === 'observations'" class="divide-y divide-border">
            <div v-if="!observations.length && !loading" class="p-8 text-center text-muted font-mono text-xs">
              Sin resultados
            </div>
            <button v-for="o in observations" :key="o.id"
                    @click="openObservation(o.id)"
                    class="w-full text-left p-3 hover:bg-surface transition-colors block">
              <div class="flex items-start gap-2">
                <span class="text-[10px] font-mono px-1.5 py-0.5 border rounded shrink-0" :class="typeClass(o.type)">
                  {{ o.type }}
                </span>
                <div class="flex-1 min-w-0">
                  <div class="text-sm text-text font-medium truncate">{{ o.title }}</div>
                  <div class="text-[11px] font-mono text-muted mt-1 line-clamp-2">{{ o.content.replace(/\*\*/g, '').slice(0, 220) }}</div>
                  <div class="flex items-center gap-2 mt-1.5 text-[10px] font-mono text-muted">
                    <span v-if="o.project" class="text-cyan">{{ o.project }}</span>
                    <span v-if="o.scope !== 'project'">· {{ o.scope }}</span>
                    <span v-if="o.topic_key" class="text-amber">· {{ o.topic_key }}</span>
                    <span v-if="o.revision_count > 1">· rev {{ o.revision_count }}</span>
                    <span class="ml-auto">{{ fmtDate(o.created_at) }}</span>
                  </div>
                </div>
              </div>
            </button>
          </div>

          <!-- Sessions -->
          <div v-else-if="activeTab === 'sessions'" class="divide-y divide-border">
            <div v-if="!sessions.length && !loading" class="p-8 text-center text-muted font-mono text-xs">
              Sin sesiones
            </div>
            <div v-for="s in sessions" :key="s.id" class="p-3 hover:bg-surface transition-colors">
              <div class="flex items-start gap-3">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm text-text font-semibold truncate">{{ s.project }}</span>
                    <span v-if="s.ended_at" class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-500/15 text-muted border border-zinc-500/30">finalizada</span>
                    <span v-else class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-green/15 text-green border border-green/30">activa</span>
                  </div>
                  <div class="text-[10px] font-mono text-muted mt-0.5 truncate">{{ s.id }}</div>
                  <div class="text-[10px] font-mono text-muted mt-0.5 truncate">{{ s.directory }}</div>
                </div>
                <div class="text-right text-[10px] font-mono text-muted space-y-0.5 shrink-0">
                  <div>{{ fmtDate(s.started_at) }}</div>
                  <div class="flex gap-2 justify-end">
                    <span class="text-cyan">{{ s.observation_count }} obs</span>
                    <span class="text-purple">{{ s.prompt_count }} prompts</span>
                  </div>
                  <button @click="filterBySession(s.id)" class="text-cyan hover:text-cyan/80 underline">ver obs →</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Prompts -->
          <div v-else-if="activeTab === 'prompts'" class="divide-y divide-border">
            <div v-if="!prompts.length && !loading" class="p-8 text-center text-muted font-mono text-xs">
              Sin prompts
            </div>
            <div v-for="p in prompts" :key="p.id" class="p-3 hover:bg-surface">
              <div class="flex items-start gap-2">
                <svg class="w-4 h-4 text-purple shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <div class="flex-1 min-w-0">
                  <div class="text-xs font-mono text-text whitespace-pre-wrap break-words">{{ p.content.slice(0, 500) }}{{ p.content.length > 500 ? '…' : '' }}</div>
                  <div class="flex items-center gap-2 mt-1 text-[10px] font-mono text-muted">
                    <span v-if="p.project" class="text-cyan">{{ p.project }}</span>
                    <button @click="filterBySession(p.session_id)" class="hover:text-text underline">{{ p.session_id.slice(0, 10) }}…</button>
                    <span class="ml-auto">{{ fmtDate(p.created_at) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Topics -->
          <div v-else-if="activeTab === 'topics'" class="p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            <div v-if="!topics.length && !loading" class="col-span-full p-8 text-center text-muted font-mono text-xs">
              Sin topics
            </div>
            <button v-for="t in topics" :key="t.topic_key"
                    @click="filterByTopic(t.topic_key)"
                    class="text-left p-3 bg-surface border border-border rounded-md hover:border-amber/50 transition-colors">
              <div class="text-xs font-mono text-amber truncate">{{ t.topic_key }}</div>
              <div class="flex items-center justify-between mt-1 text-[10px] font-mono text-muted">
                <span>{{ t.count }} revisiones</span>
                <span>{{ fmtDate(t.last_updated) }}</span>
              </div>
            </button>
          </div>
        </div>

        <!-- Paginación -->
        <div v-if="activeTab !== 'topics'" class="border-t border-border bg-surface px-3 py-2 flex items-center justify-between flex-shrink-0">
          <div class="text-[10px] font-mono text-muted">
            Página {{ page }} · mostrando {{ Math.min(pageSize, currentTotal - (page - 1) * pageSize) }} de {{ currentTotal }}
          </div>
          <div class="flex gap-1">
            <button @click="prevPage" :disabled="page === 1" class="text-[10px] font-mono px-2 py-1 border border-border rounded hover:bg-bg disabled:opacity-30 disabled:cursor-not-allowed">
              ← anterior
            </button>
            <button @click="nextPage" :disabled="page * pageSize >= currentTotal" class="text-[10px] font-mono px-2 py-1 border border-border rounded hover:bg-bg disabled:opacity-30 disabled:cursor-not-allowed">
              siguiente →
            </button>
          </div>
        </div>
      </div>

      <!-- Detail drawer -->
      <div v-if="selectedObservation" class="w-[480px] border-l border-border bg-surface overflow-y-auto flex-shrink-0">
        <div class="sticky top-0 bg-surface border-b border-border p-3 flex items-start gap-2 z-10">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-[10px] font-mono px-1.5 py-0.5 border rounded" :class="typeClass(selectedObservation.type)">
                {{ selectedObservation.type }}
              </span>
              <span class="text-[10px] font-mono text-muted">#{{ selectedObservation.id }}</span>
            </div>
            <h3 class="text-sm text-text font-semibold mt-1">{{ selectedObservation.title }}</h3>
          </div>
          <button @click="closeObservation" class="text-muted hover:text-text shrink-0">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="p-3 space-y-3">
          <div class="grid grid-cols-2 gap-2 text-[10px] font-mono">
            <div><span class="text-muted">Proyecto:</span> <span class="text-cyan">{{ selectedObservation.project || '—' }}</span></div>
            <div><span class="text-muted">Scope:</span> <span class="text-text">{{ selectedObservation.scope }}</span></div>
            <div class="col-span-2"><span class="text-muted">Session:</span> <button @click="filterBySession(selectedObservation.session_id); closeObservation()" class="text-text hover:text-cyan underline">{{ selectedObservation.session_id }}</button></div>
            <div v-if="selectedObservation.topic_key" class="col-span-2"><span class="text-muted">Topic:</span> <button @click="filterByTopic(selectedObservation.topic_key!); closeObservation()" class="text-amber hover:text-amber/80 underline">{{ selectedObservation.topic_key }}</button></div>
            <div v-if="selectedObservation.tool_name"><span class="text-muted">Tool:</span> <span class="text-text">{{ selectedObservation.tool_name }}</span></div>
            <div><span class="text-muted">Revisiones:</span> <span class="text-text">{{ selectedObservation.revision_count }}</span></div>
            <div><span class="text-muted">Creado:</span> <span class="text-text">{{ fmtDate(selectedObservation.created_at) }}</span></div>
            <div><span class="text-muted">Actualizado:</span> <span class="text-text">{{ fmtDate(selectedObservation.updated_at) }}</span></div>
          </div>

          <div>
            <div class="text-[10px] font-mono uppercase text-muted mb-1">Contenido</div>
            <pre class="text-[11px] font-mono text-text bg-bg border border-border rounded p-3 whitespace-pre-wrap break-words leading-relaxed">{{ selectedObservation.content }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
