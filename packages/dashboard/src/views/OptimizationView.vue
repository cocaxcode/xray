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
  builtin: 'Read/Write/Edit/Bash/Grep/Glob — devuelven el output entero al modelo. No filtran nada: cada byte cuenta como input.',
  serena: 'find_symbol / get_symbols_overview — leen solo el simbolo pedido en vez del archivo entero. Ahorra ~3-10x frente a Read.',
  rtk: 'Wrapper de Bash que filtra stdout antes de llegar a Claude (rtk git status, rtk vitest run...). Reduce 60-99% segun el comando.',
  mcp: 'Tools de MCP servers externos (logbook, database, figma, etc). Coste variable: depende del server — un list() puede devolver MBs.',
  own: 'Tools del propio token-optimizer (budget_*, coach_tips, toon_*). No cuentan como coste externo: son observabilidad.',
  xray: 'Tools internas de xray. Gratis a efectos de optimizacion.',
};

// How each source affects the token budget. Used for the badge next to the name.
const SOURCE_IMPACT: Record<string, { label: string; tone: 'save' | 'raw' | 'ext' | 'free' }> = {
  serena: { label: 'ahorra', tone: 'save' },
  rtk: { label: 'ahorra', tone: 'save' },
  builtin: { label: 'sin filtro', tone: 'raw' },
  mcp: { label: 'externo', tone: 'ext' },
  own: { label: 'propio', tone: 'free' },
  xray: { label: 'propio', tone: 'free' },
};

const IMPACT_COLORS: Record<string, string> = {
  save: 'text-green border-green/40 bg-green/5',
  raw: 'text-muted border-border bg-bg',
  ext: 'text-cyan border-cyan/40 bg-cyan/5',
  free: 'text-muted/60 border-border/60 bg-bg',
};

function sourceLabel(s: string): string { return SOURCE_LABELS[s] ?? s; }
function sourceColor(s: string): string { return SOURCE_COLORS[s] ?? 'bg-zinc-500'; }
function sourceDesc(s: string): string { return SOURCE_DESCRIPTIONS[s] ?? ''; }
function sourceImpact(s: string): { label: string; tone: string } {
  return SOURCE_IMPACT[s] ?? { label: '', tone: 'raw' };
}
function impactClass(tone: string): string { return IMPACT_COLORS[tone] ?? IMPACT_COLORS.raw; }

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
        <div class="bg-surface border border-border rounded-lg p-3" title="Bytes que las tools han devuelto a Claude, convertidos a tokens. Es el input que el modelo ha tenido que leer — no incluye prompts, respuestas del modelo ni thinking.">
          <div class="text-muted text-[10px] font-mono mb-1">Tokens de herramientas</div>
          <div class="text-text text-lg font-mono font-semibold">{{ formatTokens(data.totals.total_tokens) }}</div>
          <div class="text-muted text-[9px] font-mono leading-tight mt-1">
            Output de las tools que Claude ha tenido que leer.<br>
            <span class="text-muted/70">Bajar esto = ahorrar dinero real.</span>
          </div>
        </div>
        <div class="bg-surface border border-border rounded-lg p-3" title="Numero total de veces que Claude ha llamado a una tool. Cada call se mide por separado.">
          <div class="text-muted text-[10px] font-mono mb-1">Llamadas a herramientas</div>
          <div class="text-text text-lg font-mono font-semibold">{{ data.totals.total_events.toLocaleString() }}</div>
          <div class="text-muted text-[9px] font-mono leading-tight mt-1">
            Numero de veces que Claude ha usado una tool.<br>
            <span class="text-muted/70">Muchas calls pequenas = bien. Pocas calls enormes = mal.</span>
          </div>
        </div>
        <div class="bg-surface border border-border rounded-lg p-3" title="Sesiones distintas de Claude Code registradas desde que configuraste el hook.">
          <div class="text-muted text-[10px] font-mono mb-1">Sesiones</div>
          <div class="text-text text-lg font-mono font-semibold">{{ data.totals.session_count }}</div>
          <div class="text-muted text-[9px] font-mono leading-tight mt-1">
            Conversaciones distintas de Claude Code.<br>
            <span class="text-muted/70">Una por cada vez que abriste el CLI.</span>
          </div>
        </div>
        <div class="bg-surface border border-border rounded-lg p-3" title="Lo que costaria meter esos tokens como INPUT al modelo (Haiku $1/M, Sonnet $3/M, Opus $5/M). No es lo que has pagado realmente — es solo la parte de input de las tools.">
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
          <div class="text-muted/70 text-[9px] font-mono leading-tight mt-1">
            Solo input de tools. No suma respuestas del modelo.
          </div>
        </div>
        <div class="bg-surface border border-border rounded-lg p-3" title="Porcentaje de tus llamadas que han pasado por un optimizador (serena o rtk) vs las que han ido directas (Read, Bash crudo, etc). >30% es bueno.">
          <div class="text-muted text-[10px] font-mono mb-1">Score de optimizacion</div>
          <div v-if="optimizationScore !== null" class="text-lg font-mono font-semibold" :class="optimizationScore > 30 ? 'text-green' : optimizationScore > 10 ? 'text-cyan' : 'text-muted'">
            {{ optimizationScore }}%
          </div>
          <div v-else class="text-muted text-lg font-mono">0%</div>
          <div class="text-muted text-[9px] font-mono leading-tight mt-1">
            % de calls via serena o rtk.<br>
            <span class="text-muted/70">&gt;30% bueno &middot; &lt;10% hay margen.</span>
          </div>
        </div>
      </div>

      <!-- Savings estimate (only if serena data exists) -->
      <div v-if="serenaSavings" class="bg-purple/5 border border-purple/20 rounded-lg p-4">
        <div class="flex items-baseline justify-between mb-2">
          <div class="text-purple text-xs font-mono font-semibold">Ahorro estimado con Serena</div>
          <div class="text-muted/70 text-[9px] font-mono">ESTIMACION &middot; factor fijo 5x</div>
        </div>
        <div class="text-muted text-[10px] font-mono mb-3 leading-tight">
          <strong class="text-text">Que es:</strong> serena lee solo el simbolo que pides (una funcion, una clase) en vez del archivo entero.<br>
          <strong class="text-text">Por que ahorra:</strong> si el archivo tiene 500 lineas y solo necesitas 1 funcion, Read devuelve las 500 — serena devuelve 20.<br>
          <strong class="text-text">Como se calcula:</strong> tokens_serena &times; 5 = lo que habria costado con Read (regla fija, no medido).
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
          <div title="Numero de veces que Claude ha llamado a una tool de serena en total.">
            <div class="text-muted text-[10px]">Calls via Serena</div>
            <div class="text-text font-semibold">{{ serenaSavings.calls }}</div>
          </div>
          <div title="Tokens reales que esas calls han consumido (medido, no estimado).">
            <div class="text-muted text-[10px]">Tokens gastados</div>
            <div class="text-text font-semibold">{{ formatTokens(serenaSavings.serenaTokens) }}</div>
          </div>
          <div title="Proyeccion: si esas mismas lecturas las hubieras hecho con Read, habrian costado aproximadamente esto.">
            <div class="text-muted text-[10px]">Habria costado con Read</div>
            <div class="text-red font-semibold">~{{ formatTokens(serenaSavings.wouldHaveCost) }}</div>
          </div>
          <div title="Diferencia entre lo que habria costado con Read y lo que realmente ha costado con serena.">
            <div class="text-muted text-[10px]">Ahorro estimado</div>
            <div class="text-green font-semibold">~{{ formatTokens(serenaSavings.saved) }}</div>
          </div>
        </div>
        <div class="text-muted text-[9px] font-mono mt-2 leading-tight">
          Ratio 5x = valor conservador del rango real 3-10x. Con archivos grandes el ahorro es mayor (hasta 10x); en ficheros pequenos tiende a 3x.
        </div>
      </div>

      <!-- Two-column layout: sources + top tools -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <!-- Global source breakdown -->
        <div class="bg-surface border border-border rounded-lg p-4">
          <div class="text-muted text-xs font-mono mb-1">Desglose por fuente</div>
          <div class="text-muted text-[9px] font-mono mb-3 leading-tight">
            De donde vienen los tokens que consume Claude. Cada fila tiene un badge:
            <span class="text-green">ahorra</span> (optimiza),
            <span class="text-muted">sin filtro</span> (output crudo),
            <span class="text-cyan">externo</span> (depende del MCP),
            <span class="text-muted/60">propio</span> (no cuenta).
          </div>
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
              <div class="flex items-start gap-1.5 text-[9px] font-mono" style="margin-left: 4.5rem;">
                <span
                  class="px-1 border rounded text-[8px] uppercase tracking-wide shrink-0"
                  :class="impactClass(sourceImpact(source.source).tone)"
                >{{ sourceImpact(source.source).label }}</span>
                <span class="text-muted leading-tight">{{ sourceDesc(source.source) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Global top tools -->
        <div class="bg-surface border border-border rounded-lg p-4">
          <div class="text-muted text-xs font-mono mb-1">Top 10 herramientas mas costosas</div>
          <div class="text-muted text-[9px] font-mono mb-3 leading-tight">
            Ordenadas por tokens totales (output &rarr; input de Claude).<br>
            <span class="text-muted/70">Mucho total no es malo si se usa mucho &mdash; fijate en <strong class="text-text">Prom/call</strong>: alto = devuelve respuestas gordas (considera filtrar o usar serena/rtk).</span>
          </div>
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
