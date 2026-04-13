<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useAuth } from '../composables/useAuth';
import { formatTokens } from '../utils/format';

interface SourceBreakdown {
  source: string;
  count: number;
  tokens: number;
}

interface ToolBreakdown {
  tool_name: string;
  count: number;
  tokens: number;
  avg_tokens: number;
}

interface ProjectOptData {
  projectPath: string;
  projectName: string;
  total_tokens: number;
  total_events: number;
  session_count: number;
  by_source: SourceBreakdown[];
  by_tool: ToolBreakdown[];
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
  global_by_source: SourceBreakdown[];
  global_by_tool: ToolBreakdown[];
}

const { getAuthHeaders } = useAuth();

const data = ref<GlobalOptData | null>(null);
const loading = ref(true);
const expandedProject = ref<string | null>(null);

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

const SOURCE_DESCRIPTIONS: Record<string, string> = {
  builtin: 'Read, Write, Edit, Bash, Grep, Glob, etc.',
  serena: 'Lecturas simbolicas (find_symbol, get_symbols_overview)',
  rtk: 'Bash filtrado — reduce output antes de llegar a Claude',
  mcp: 'Herramientas de MCP servers externos',
  own: 'Herramientas del propio token-optimizer',
  xray: 'Herramientas de xray',
};

function sourceLabel(s: string): string { return SOURCE_LABELS[s] ?? s; }
function sourceColor(s: string): string { return SOURCE_COLORS[s] ?? 'bg-zinc-500'; }
function sourceDesc(s: string): string { return SOURCE_DESCRIPTIONS[s] ?? ''; }

function barWidth(tokens: number, sources: SourceBreakdown[]): string {
  const max = Math.max(...sources.map(s => s.tokens), 1);
  return `${(tokens / max) * 100}%`;
}

function tokenPercent(tokens: number, total: number): string {
  if (total === 0) return '0%';
  return `${((tokens / total) * 100).toFixed(1)}%`;
}

function toggleProject(path: string): void {
  expandedProject.value = expandedProject.value === path ? null : path;
}

// Serena savings estimate: serena returns ~3-10x less tokens than Read for the same file
// Conservative factor: 5x (middle of range)
const SERENA_SAVINGS_FACTOR = 5;

const serenaSavings = computed(() => {
  if (!data.value?.global_by_source) return null;
  const serena = data.value.global_by_source.find(s => s.source === 'serena');
  if (!serena || serena.tokens === 0) return null;
  const wouldHaveCost = serena.tokens * SERENA_SAVINGS_FACTOR;
  const saved = wouldHaveCost - serena.tokens;
  return { serenaTokens: serena.tokens, wouldHaveCost, saved, calls: serena.count };
});

// Optimization score: % of tool calls using optimized sources (serena + rtk) vs raw builtin
const optimizationScore = computed(() => {
  if (!data.value?.global_by_source?.length) return null;
  const optimized = data.value.global_by_source
    .filter(s => s.source === 'serena' || s.source === 'rtk')
    .reduce((sum, s) => sum + s.count, 0);
  const raw = data.value.global_by_source
    .filter(s => s.source === 'builtin')
    .reduce((sum, s) => sum + s.count, 0);
  const total = optimized + raw;
  if (total === 0) return null;
  return Math.round((optimized / total) * 100);
});
</script>

<template>
  <div class="flex-1 overflow-y-auto p-4 space-y-5">
    <!-- Loading -->
    <div v-if="loading" class="text-muted text-sm font-mono text-center mt-10">
      Cargando datos de optimizacion...
    </div>

    <!-- No data -->
    <div v-else-if="!data || data.projects.length === 0" class="text-center mt-10 space-y-3">
      <div class="text-muted text-sm font-mono">Sin datos de token-optimizer todavia.</div>
      <div class="text-muted text-xs font-mono space-y-1">
        <div>1. Configura xray_url: <span class="text-cyan">npx @cocaxcode/token-optimizer-mcp config set xray_url http://localhost:3333</span></div>
        <div>2. Importa datos historicos: <span class="text-cyan">npx @cocaxcode/token-optimizer-mcp sync-xray</span></div>
        <div>3. Los datos nuevos llegan automaticamente en cada sesion de Claude Code</div>
      </div>
    </div>

    <!-- Data -->
    <template v-else>
      <!-- Global summary cards -->
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div class="bg-surface border border-border rounded-lg p-3">
          <div class="text-muted text-[10px] font-mono mb-1">Tokens de herramientas</div>
          <div class="text-text text-lg font-mono font-semibold">{{ formatTokens(data.totals.total_tokens) }}</div>
          <div class="text-muted text-[9px] font-mono">output de tools = input al modelo</div>
        </div>
        <div class="bg-surface border border-border rounded-lg p-3">
          <div class="text-muted text-[10px] font-mono mb-1">Llamadas a herramientas</div>
          <div class="text-text text-lg font-mono font-semibold">{{ data.totals.total_events.toLocaleString() }}</div>
          <div class="text-muted text-[9px] font-mono">Read, Edit, Bash, MCPs, etc.</div>
        </div>
        <div class="bg-surface border border-border rounded-lg p-3">
          <div class="text-muted text-[10px] font-mono mb-1">Sesiones</div>
          <div class="text-text text-lg font-mono font-semibold">{{ data.totals.session_count }}</div>
          <div class="text-muted text-[9px] font-mono">sesiones de Claude Code</div>
        </div>
        <div class="bg-surface border border-border rounded-lg p-3">
          <div class="text-muted text-[10px] font-mono mb-1">Coste estimado (input)</div>
          <div class="space-y-0.5">
            <div class="flex justify-between text-[10px] font-mono">
              <span class="text-green">Haiku $1/M</span>
              <span class="text-green">{{ formatCost(data.totals.cost_haiku) }}</span>
            </div>
            <div class="flex justify-between text-[10px] font-mono">
              <span class="text-cyan">Sonnet $3/M</span>
              <span class="text-cyan">{{ formatCost(data.totals.cost_sonnet) }}</span>
            </div>
            <div class="flex justify-between text-[10px] font-mono">
              <span class="text-purple">Opus $5/M</span>
              <span class="text-purple">{{ formatCost(data.totals.cost_opus) }}</span>
            </div>
          </div>
        </div>
        <div class="bg-surface border border-border rounded-lg p-3">
          <div class="text-muted text-[10px] font-mono mb-1">Score de optimizacion</div>
          <div v-if="optimizationScore !== null" class="text-lg font-mono font-semibold" :class="optimizationScore > 30 ? 'text-green' : optimizationScore > 10 ? 'text-cyan' : 'text-muted'">
            {{ optimizationScore }}%
          </div>
          <div v-else class="text-muted text-lg font-mono">0%</div>
          <div class="text-muted text-[9px] font-mono">% de calls via serena o rtk</div>
        </div>
      </div>

      <!-- Savings estimate (only if serena data exists) -->
      <div v-if="serenaSavings" class="bg-purple/5 border border-purple/20 rounded-lg p-4">
        <div class="text-purple text-xs font-mono font-semibold mb-2">Ahorro estimado con Serena</div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
          <div>
            <div class="text-muted text-[10px]">Calls via Serena</div>
            <div class="text-text font-semibold">{{ serenaSavings.calls }}</div>
          </div>
          <div>
            <div class="text-muted text-[10px]">Tokens usados</div>
            <div class="text-text font-semibold">{{ formatTokens(serenaSavings.serenaTokens) }}</div>
          </div>
          <div>
            <div class="text-muted text-[10px]">Sin Serena habria costado</div>
            <div class="text-red font-semibold">~{{ formatTokens(serenaSavings.wouldHaveCost) }}</div>
          </div>
          <div>
            <div class="text-muted text-[10px]">Tokens ahorrados (~5x)</div>
            <div class="text-green font-semibold">~{{ formatTokens(serenaSavings.saved) }}</div>
          </div>
        </div>
        <div class="text-muted text-[9px] font-mono mt-2">
          Serena lee simbolos individuales en vez de archivos completos. Ratio estimado: 5x menos tokens (rango real: 3-10x).
        </div>
      </div>

      <!-- Two-column layout: sources + top tools -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <!-- Global source breakdown -->
        <div class="bg-surface border border-border rounded-lg p-4">
          <div class="text-muted text-xs font-mono mb-1">Desglose por fuente</div>
          <div class="text-muted text-[9px] font-mono mb-3">De donde vienen los tokens que consume Claude</div>
          <div class="space-y-2">
            <div v-for="source in data.global_by_source" :key="source.source" class="space-y-0.5">
              <div class="flex items-center gap-2 text-xs font-mono">
                <span class="w-16 text-right text-text">{{ sourceLabel(source.source) }}</span>
                <div class="flex-1 h-5 bg-bg rounded overflow-hidden">
                  <div
                    class="h-full rounded transition-all duration-500"
                    :class="sourceColor(source.source)"
                    :style="{ width: barWidth(source.tokens, data.global_by_source), opacity: 0.7 }"
                  />
                </div>
                <span class="w-20 text-right text-text">{{ formatTokens(source.tokens) }}</span>
                <span class="w-10 text-right text-muted">x{{ source.count }}</span>
                <span class="w-12 text-right text-muted">{{ tokenPercent(source.tokens, data.totals.total_tokens) }}</span>
              </div>
              <div class="text-muted text-[9px] font-mono ml-18 pl-18" style="margin-left: 4.5rem;">
                {{ sourceDesc(source.source) }}
              </div>
            </div>
          </div>
        </div>

        <!-- Global top tools -->
        <div class="bg-surface border border-border rounded-lg p-4">
          <div class="text-muted text-xs font-mono mb-1">Top 10 herramientas mas costosas</div>
          <div class="text-muted text-[9px] font-mono mb-3">Ordenadas por tokens consumidos (output de la tool → input de Claude)</div>
          <div class="space-y-0.5">
            <div class="flex items-center gap-2 text-[10px] font-mono text-muted mb-1">
              <span class="w-4"></span>
              <span class="flex-1">Herramienta</span>
              <span class="w-12 text-right">Calls</span>
              <span class="w-16 text-right">Tokens</span>
              <span class="w-16 text-right">Prom/call</span>
            </div>
            <div
              v-for="(tool, i) in data.global_by_tool"
              :key="tool.tool_name"
              class="flex items-center gap-2 text-xs font-mono py-0.5"
            >
              <span class="w-4 text-muted text-right text-[10px]">{{ i + 1 }}</span>
              <span class="flex-1 text-text truncate">{{ tool.tool_name }}</span>
              <span class="w-12 text-right text-muted">{{ tool.count }}</span>
              <span class="w-16 text-right text-text">{{ formatTokens(tool.tokens) }}</span>
              <span class="w-16 text-right text-muted">{{ formatTokens(Math.round(tool.avg_tokens)) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Per-project cards -->
      <div>
        <div class="text-muted text-xs font-mono mb-1">Por proyecto</div>
        <div class="text-muted text-[9px] font-mono mb-3">Click en un proyecto para ver detalle de herramientas</div>
        <div class="space-y-3">
          <div
            v-for="project in data.projects"
            :key="project.projectPath"
            class="bg-surface border border-border rounded-lg overflow-hidden transition-colors"
            :class="expandedProject === project.projectPath ? 'border-purple/40' : ''"
          >
            <!-- Project header (clickable) -->
            <div
              class="p-4 cursor-pointer hover:bg-surface-hover transition-colors"
              @click="toggleProject(project.projectPath)"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <span class="text-muted text-xs transition-transform" :class="expandedProject === project.projectPath ? 'rotate-90' : ''">
                    >
                  </span>
                  <div>
                    <div class="text-text text-sm font-mono font-semibold">{{ project.projectName }}</div>
                    <div class="text-muted text-[10px] font-mono">
                      {{ project.session_count }} sesiones &middot; {{ project.total_events.toLocaleString() }} llamadas
                    </div>
                  </div>
                </div>
                <div class="text-right">
                  <div class="text-text text-sm font-mono font-semibold">{{ formatTokens(project.total_tokens) }} tokens</div>
                  <div class="flex gap-2 text-[10px] font-mono">
                    <span class="text-green">H {{ formatCost(project.cost_haiku) }}</span>
                    <span class="text-cyan">S {{ formatCost(project.cost_sonnet) }}</span>
                    <span class="text-purple">O {{ formatCost(project.cost_opus) }}</span>
                  </div>
                </div>
              </div>

              <!-- Mini stacked bar (always visible) -->
              <div class="mt-2 flex gap-0.5 h-2 rounded overflow-hidden">
                <div
                  v-for="source in project.by_source"
                  :key="source.source"
                  class="rounded"
                  :class="sourceColor(source.source)"
                  :style="{ flex: source.tokens, opacity: 0.6 }"
                  :title="`${sourceLabel(source.source)}: ${formatTokens(source.tokens)} (${source.count} calls)`"
                />
              </div>
            </div>

            <!-- Expanded detail -->
            <div v-if="expandedProject === project.projectPath" class="border-t border-border p-4">
              <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <!-- Source breakdown -->
                <div>
                  <div class="text-muted text-[10px] font-mono mb-2">Fuentes</div>
                  <div class="space-y-1">
                    <div v-for="source in project.by_source" :key="source.source" class="flex items-center gap-1.5 text-[10px] font-mono">
                      <span class="w-14 text-right text-muted">{{ sourceLabel(source.source) }}</span>
                      <div class="flex-1 h-3 bg-bg rounded overflow-hidden">
                        <div
                          class="h-full rounded"
                          :class="sourceColor(source.source)"
                          :style="{ width: barWidth(source.tokens, project.by_source), opacity: 0.6 }"
                        />
                      </div>
                      <span class="w-16 text-right text-text">{{ formatTokens(source.tokens) }}</span>
                      <span class="w-10 text-right text-muted">x{{ source.count }}</span>
                    </div>
                  </div>
                </div>

                <!-- Top tools for this project -->
                <div v-if="project.by_tool?.length">
                  <div class="text-muted text-[10px] font-mono mb-2">Top herramientas</div>
                  <div class="space-y-0.5">
                    <div
                      v-for="tool in project.by_tool"
                      :key="tool.tool_name"
                      class="flex items-center gap-2 text-[10px] font-mono py-0.5"
                    >
                      <span class="flex-1 text-text truncate">{{ tool.tool_name }}</span>
                      <span class="text-muted">x{{ tool.count }}</span>
                      <span class="w-14 text-right text-text">{{ formatTokens(tool.tokens) }}</span>
                      <span class="w-14 text-right text-muted">~{{ formatTokens(Math.round(tool.avg_tokens)) }}/c</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Project path -->
              <div class="mt-3 text-[9px] font-mono text-muted/40 truncate">{{ project.projectPath }}</div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
