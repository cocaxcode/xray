<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useAuth } from '../composables/useAuth';
import { formatTokens } from '../utils/format';
import OptimizationPanel from '../components/OptimizationPanel.vue';

interface SourceBreakdown {
  source: string;
  count: number;
  tokens: number;
}

interface ProjectOptData {
  projectPath: string;
  projectName: string;
  total_tokens: number;
  total_events: number;
  session_count: number;
  by_source: SourceBreakdown[];
  cost_haiku: number;
  cost_sonnet: number;
  cost_opus: number;
}

interface GlobalOptData {
  projects: ProjectOptData[];
  totals: {
    total_tokens: number;
    total_events: number;
    session_count: number;
    cost_haiku: number;
    cost_sonnet: number;
    cost_opus: number;
  };
}

const { getAuthHeaders } = useAuth();

const data = ref<GlobalOptData | null>(null);
const loading = ref(true);
const selectedProject = ref<string | null>(null);

onMounted(async () => {
  try {
    const res = await fetch('/api/optimization', { headers: getAuthHeaders() });
    if (res.ok) data.value = await res.json();
  } catch { /* silent */ }
  loading.value = false;
});

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

const SOURCE_LABELS: Record<string, string> = {
  builtin: 'Nativas',
  serena: 'Serena',
  rtk: 'RTK',
  mcp: 'MCPs',
  own: 'Optimizer',
  xray: 'Xray',
};

const SOURCE_COLORS: Record<string, string> = {
  builtin: 'bg-zinc-500',
  serena: 'bg-purple-500',
  rtk: 'bg-green-500',
  mcp: 'bg-cyan',
  own: 'bg-zinc-600',
  xray: 'bg-zinc-600',
};

function sourceLabel(s: string): string { return SOURCE_LABELS[s] ?? s; }
function sourceColor(s: string): string { return SOURCE_COLORS[s] ?? 'bg-zinc-500'; }

// Global source breakdown (merged from all projects)
const globalBySource = computed<SourceBreakdown[]>(() => {
  if (!data.value) return [];
  const map = new Map<string, SourceBreakdown>();
  for (const p of data.value.projects) {
    for (const s of p.by_source) {
      const existing = map.get(s.source);
      if (existing) {
        existing.count += s.count;
        existing.tokens += s.tokens;
      } else {
        map.set(s.source, { ...s });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.tokens - a.tokens);
});

function barWidth(tokens: number, sources: SourceBreakdown[]): string {
  const max = Math.max(...sources.map(s => s.tokens), 1);
  return `${(tokens / max) * 100}%`;
}

function tokenPercent(tokens: number, total: number): string {
  if (total === 0) return '0%';
  return `${((tokens / total) * 100).toFixed(1)}%`;
}
</script>

<template>
  <div class="flex-1 overflow-y-auto p-4 space-y-6">
    <!-- Loading -->
    <div v-if="loading" class="text-muted text-sm font-mono text-center mt-10">
      Cargando datos de optimizacion...
    </div>

    <!-- No data -->
    <div v-else-if="!data || data.projects.length === 0" class="text-center mt-10 space-y-2">
      <div class="text-muted text-sm font-mono">Sin datos de token-optimizer todavia.</div>
      <div class="text-muted text-xs font-mono">
        Verifica que <span class="text-cyan">XRAY_URL</span> este configurado en token-optimizer.
      </div>
    </div>

    <!-- Data -->
    <template v-else>
      <!-- Global summary cards -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div class="bg-surface border border-border rounded-lg p-3">
          <div class="text-muted text-[10px] font-mono mb-1">Tokens totales</div>
          <div class="text-text text-lg font-mono font-semibold">{{ formatTokens(data.totals.total_tokens) }}</div>
        </div>
        <div class="bg-surface border border-border rounded-lg p-3">
          <div class="text-muted text-[10px] font-mono mb-1">Eventos</div>
          <div class="text-text text-lg font-mono font-semibold">{{ data.totals.total_events.toLocaleString() }}</div>
        </div>
        <div class="bg-surface border border-border rounded-lg p-3">
          <div class="text-muted text-[10px] font-mono mb-1">Sesiones</div>
          <div class="text-text text-lg font-mono font-semibold">{{ data.totals.session_count }}</div>
        </div>
        <div class="bg-surface border border-border rounded-lg p-3">
          <div class="text-muted text-[10px] font-mono mb-1">Coste estimado</div>
          <div class="flex gap-2 items-baseline">
            <span class="text-green text-xs font-mono">H {{ formatCost(data.totals.cost_haiku) }}</span>
            <span class="text-cyan text-xs font-mono">S {{ formatCost(data.totals.cost_sonnet) }}</span>
            <span class="text-purple text-xs font-mono">O {{ formatCost(data.totals.cost_opus) }}</span>
          </div>
        </div>
      </div>

      <!-- Global source breakdown -->
      <div class="bg-surface border border-border rounded-lg p-4">
        <div class="text-muted text-xs font-mono mb-3">Desglose global por fuente</div>
        <div class="space-y-1.5">
          <div v-for="source in globalBySource" :key="source.source" class="flex items-center gap-2 text-xs font-mono">
            <span class="w-16 text-right text-text">{{ sourceLabel(source.source) }}</span>
            <div class="flex-1 h-5 bg-bg rounded overflow-hidden">
              <div
                class="h-full rounded transition-all duration-500"
                :class="sourceColor(source.source)"
                :style="{ width: barWidth(source.tokens, globalBySource), opacity: 0.7 }"
              />
            </div>
            <span class="w-20 text-right text-muted">{{ formatTokens(source.tokens) }}</span>
            <span class="w-12 text-right text-muted">{{ tokenPercent(source.tokens, data.totals.total_tokens) }}</span>
          </div>
        </div>
      </div>

      <!-- Per-project cards -->
      <div>
        <div class="text-muted text-xs font-mono mb-3">Por proyecto</div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div
            v-for="project in data.projects"
            :key="project.projectPath"
            class="bg-surface border border-border rounded-lg p-4 space-y-3 cursor-pointer hover:bg-surface-hover transition-colors"
            :class="selectedProject === project.projectPath ? 'border-purple/50' : ''"
            @click="selectedProject = selectedProject === project.projectPath ? null : project.projectPath"
          >
            <!-- Project header -->
            <div class="flex items-center justify-between">
              <div>
                <div class="text-text text-sm font-mono font-semibold">{{ project.projectName }}</div>
                <div class="text-muted text-[10px] font-mono">{{ project.session_count }} sesiones &middot; {{ project.total_events.toLocaleString() }} eventos</div>
              </div>
              <div class="text-right">
                <div class="text-text text-sm font-mono">{{ formatTokens(project.total_tokens) }}</div>
                <div class="flex gap-1.5 text-[10px] font-mono">
                  <span class="text-green">H {{ formatCost(project.cost_haiku) }}</span>
                  <span class="text-cyan">S {{ formatCost(project.cost_sonnet) }}</span>
                  <span class="text-purple">O {{ formatCost(project.cost_opus) }}</span>
                </div>
              </div>
            </div>

            <!-- Source breakdown mini-bars -->
            <div class="space-y-0.5">
              <div v-for="source in project.by_source" :key="source.source" class="flex items-center gap-1.5 text-[10px] font-mono">
                <span class="w-14 text-right text-muted">{{ sourceLabel(source.source) }}</span>
                <div class="flex-1 h-3 bg-bg rounded overflow-hidden">
                  <div
                    class="h-full rounded"
                    :class="sourceColor(source.source)"
                    :style="{ width: barWidth(source.tokens, project.by_source), opacity: 0.6 }"
                  />
                </div>
                <span class="w-16 text-right text-muted">{{ formatTokens(source.tokens) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
