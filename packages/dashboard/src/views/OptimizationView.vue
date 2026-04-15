<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useAuth } from '../composables/useAuth';
import { useWebSocket } from '../composables/useWebSocket';
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
}

interface GlobalOptData {
  projects: ProjectOptData[];
  totals: {
    total_tokens: number;
    total_events: number;
    session_count: number;
  };
  global_by_source: SourceBreakdown[];
  global_by_tool: ToolBreakdown[];
}

interface LiveEvent {
  id: number;
  sessionId: string;
  source: string;
  tokens: number;
  toolName: string;
  ts: number;
}

const { getAuthHeaders } = useAuth();
const { onMessage } = useWebSocket();

const data = ref<GlobalOptData | null>(null);
const loading = ref(true);
const expandedProject = ref<string | null>(null);

// Live feed of the most recent events (capped at 30)
const liveEvents = ref<LiveEvent[]>([]);
let liveCounter = 0;

// Per-source live counter: increments each time an event of that source fires.
// Resets to 0 on view mount so the user sees fresh numbers from "now".
const liveCounts = ref<Record<string, number>>({
  builtin: 0,
  serena: 0,
  rtk: 0,
  mcp: 0,
  own: 0,
});

async function loadData(): Promise<void> {
  try {
    const res = await fetch('/api/optimization', { headers: getAuthHeaders() });
    if (res.ok) data.value = await res.json();
  } catch {
    /* silent */
  }
  loading.value = false;
}

// Debounced refresh: after each optimization:event we schedule a single
// loadData() call 600 ms in the future. If more events arrive inside that
// window they get coalesced into the same fetch. This keeps the whole panel
// (totals, score, by_source, top_tool, savings, projects) updating in real
// time without hammering /api/optimization on every single call. 600 ms is
// above the optimizer-watcher poll interval in the worst case (mirror happens
// within ~3 s of the source row, then the scheduled fetch sees it).
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const REFRESH_DEBOUNCE_MS = 600;
function scheduleRefresh(): void {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    loadData();
  }, REFRESH_DEBOUNCE_MS);
}

let stopWs: (() => void) | null = null;

onMounted(() => {
  loadData();

  stopWs = onMessage((event) => {
    if (event.type !== 'optimization:event') return;
    const evt = event.data as {
      sessionId: string;
      source: string;
      tokens: number;
      toolName: string;
    };

    liveCounter++;
    const next: LiveEvent = {
      id: liveCounter,
      sessionId: evt.sessionId,
      source: evt.source,
      tokens: evt.tokens,
      toolName: evt.toolName,
      ts: Date.now(),
    };
    liveEvents.value = [next, ...liveEvents.value].slice(0, 30);

    if (!(evt.source in liveCounts.value)) {
      liveCounts.value[evt.source] = 0;
    }
    liveCounts.value[evt.source]++;

    // Refresh aggregate cards (totals, score, by_source, savings, projects) —
    // debounced so bursts collapse into a single fetch.
    scheduleRefresh();
  });
});

onUnmounted(() => {
  if (stopWs) stopWs();
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
});

const SOURCE_LABELS: Record<string, string> = {
  builtin: 'Nativas',
  serena: 'Serena',
  rtk: 'RTK',
  mcp: 'MCPs',
  own: 'Optimizer',
  xray: 'Xray',
};

// Visible color (hex) for dots and badges — Tailwind JIT cannot deal with
// dynamic `bg-${var}` classes, so we hand-pick a palette here.
const SOURCE_COLOR_HEX: Record<string, string> = {
  builtin: '#71717A', // zinc
  serena: '#A855F7', // purple
  rtk: '#22C55E', // green
  mcp: '#00F5D4', // cyan
  own: '#3F3F46',
  xray: '#3F3F46',
};

const SOURCE_DESCRIPTIONS: Record<string, string> = {
  builtin:
    'Read / Write / Edit / Bash / Grep / Glob — devuelven el output entero al modelo. No filtran nada: cada byte cuenta como input.',
  serena:
    'find_symbol / get_symbols_overview — leen sólo el símbolo que pides (una función, una clase) en vez del archivo entero. Ahorra ~3-10× frente a Read.',
  rtk: 'Wrapper de Bash que filtra stdout antes de que llegue a Claude (rtk git status, rtk vitest run…). Reduce 60-99% según el comando.',
  mcp: 'Tools de MCP servers externos (logbook, database, api-testing…). Coste variable: depende del server — un list() puede devolver megas.',
  own: 'Tools del propio token-optimizer (budget_*, coach_tips, toon_*). No cuentan como coste externo: son observabilidad.',
  xray: 'Tools internas de xray. Coste despreciable a efectos de optimización.',
};

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

function sourceLabel(s: string): string {
  return SOURCE_LABELS[s] ?? s;
}
function sourceColor(s: string): string {
  return SOURCE_COLOR_HEX[s] ?? '#71717A';
}
function sourceDesc(s: string): string {
  return SOURCE_DESCRIPTIONS[s] ?? '';
}
function sourceImpact(s: string): { label: string; tone: string } {
  return SOURCE_IMPACT[s] ?? { label: '', tone: 'raw' };
}
function impactClass(tone: string): string {
  return IMPACT_COLORS[tone] ?? IMPACT_COLORS.raw;
}

function barWidth(tokens: number, sources: SourceBreakdown[]): string {
  const max = Math.max(...sources.map((s) => s.tokens), 1);
  return `${(tokens / max) * 100}%`;
}

function tokenPercent(tokens: number, total: number): string {
  if (total === 0) return '0%';
  return `${((tokens / total) * 100).toFixed(1)}%`;
}

function toggleProject(path: string): void {
  expandedProject.value = expandedProject.value === path ? null : path;
}

function relativeTs(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 1500) return 'ahora';
  if (diff < 60_000) return `hace ${Math.round(diff / 1000)} s`;
  return `hace ${Math.round(diff / 60_000)} min`;
}

// Serena savings: conservative factor (5×) applied to observed serena tokens.
// Real range is 3-10×; we use 5× as the middle of the distribution.
const SERENA_SAVINGS_FACTOR = 5;
const serenaSavings = computed(() => {
  if (!data.value?.global_by_source) return null;
  const serena = data.value.global_by_source.find((s) => s.source === 'serena');
  if (!serena || serena.tokens === 0) return null;
  const wouldHaveCost = serena.tokens * SERENA_SAVINGS_FACTOR;
  const saved = wouldHaveCost - serena.tokens;
  return {
    serenaTokens: serena.tokens,
    wouldHaveCost,
    saved,
    calls: serena.count,
  };
});

// RTK savings: conservative factor (4×) applied to observed rtk tokens.
// RTK filters advertise 60-99% reduction depending on the command — 4× is
// equivalent to ~75% reduction, which is mid-range and honest about the
// fact that some commands (e.g. `rtk git status`) save less than `rtk vitest`.
const RTK_SAVINGS_FACTOR = 4;
const rtkSavings = computed(() => {
  if (!data.value?.global_by_source) return null;
  const rtk = data.value.global_by_source.find((s) => s.source === 'rtk');
  if (!rtk || rtk.tokens === 0) return null;
  const wouldHaveCost = rtk.tokens * RTK_SAVINGS_FACTOR;
  const saved = wouldHaveCost - rtk.tokens;
  return {
    rtkTokens: rtk.tokens,
    wouldHaveCost,
    saved,
    calls: rtk.count,
  };
});

// Combined total savings: sum of serena + rtk estimated savings.
const totalSavings = computed(() => {
  const s = serenaSavings.value?.saved ?? 0;
  const r = rtkSavings.value?.saved ?? 0;
  const total = s + r;
  if (total === 0) return null;
  return total;
});

// Optimization score = (serena + rtk calls) / (serena + rtk + builtin calls)
const optimizationScore = computed(() => {
  if (!data.value?.global_by_source?.length) return null;
  const optimized = data.value.global_by_source
    .filter((s) => s.source === 'serena' || s.source === 'rtk')
    .reduce((sum, s) => sum + s.count, 0);
  const raw = data.value.global_by_source
    .filter((s) => s.source === 'builtin')
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
      Cargando datos de optimización…
    </div>

    <!-- No data -->
    <div v-else-if="!data || data.projects.length === 0" class="text-center mt-10 space-y-3">
      <div class="text-muted text-sm font-mono">Sin datos de token-optimizer todavía.</div>
      <div class="text-muted text-xs font-mono space-y-1">
        <div>
          1. Asegúrate de tener los hooks instalados:
          <span class="text-cyan">npx @cocaxcode/token-optimizer-mcp install</span>
        </div>
        <div>2. Xray lee la DB global automáticamente (~/.token-optimizer/analytics.db)</div>
        <div>3. Al usar Claude Code, los eventos aparecerán aquí en tiempo real</div>
      </div>
    </div>

    <!-- Data -->
    <template v-else>
      <!-- Live activity strip -->
      <div class="bg-surface border border-border rounded-lg p-4">
        <div class="flex items-baseline justify-between mb-3">
          <div class="text-text text-sm font-mono font-semibold">Actividad en vivo</div>
          <div class="text-muted text-[10px] font-mono">
            Las últimas llamadas a herramientas que ha hecho Claude — se actualiza en tiempo real
          </div>
        </div>

        <!-- Per-source live counters -->
        <div class="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
          <div
            v-for="key in ['serena', 'rtk', 'builtin', 'mcp', 'own']"
            :key="key"
            class="bg-bg border border-border rounded px-3 py-2"
            :style="{ borderColor: liveCounts[key] > 0 ? sourceColor(key) + '80' : undefined }"
          >
            <div class="flex items-center gap-2 mb-1">
              <span
                class="inline-block w-2 h-2 rounded-full"
                :style="{ backgroundColor: sourceColor(key) }"
              ></span>
              <span class="text-text text-[11px] font-mono">{{ sourceLabel(key) }}</span>
            </div>
            <div class="text-text text-base font-mono font-semibold">{{ liveCounts[key] ?? 0 }}</div>
            <div class="text-muted text-[9px] font-mono">llamadas en esta sesión</div>
          </div>
        </div>

        <!-- Live event feed -->
        <div v-if="liveEvents.length === 0" class="text-muted text-xs font-mono text-center py-6">
          Esperando actividad… haz que Claude llame a una herramienta para verlo aquí.
        </div>
        <div v-else class="max-h-60 overflow-y-auto space-y-1 pr-1">
          <div
            v-for="evt in liveEvents"
            :key="evt.id"
            class="flex items-center gap-2 text-[11px] font-mono bg-bg border border-border rounded px-2 py-1.5"
          >
            <span
              class="inline-block w-2 h-2 rounded-full shrink-0"
              :style="{ backgroundColor: sourceColor(evt.source) }"
            ></span>
            <span
              class="w-20 text-[10px] uppercase tracking-wide shrink-0"
              :style="{ color: sourceColor(evt.source) }"
            >
              {{ sourceLabel(evt.source) }}
            </span>
            <span class="flex-1 text-text truncate">{{ evt.toolName }}</span>
            <span class="text-muted w-20 text-right">{{ formatTokens(evt.tokens) }} tok</span>
            <span class="text-muted/60 w-16 text-right text-[9px]">{{ relativeTs(evt.ts) }}</span>
          </div>
        </div>
      </div>

      <!-- Global summary cards (no dollars, only tokens) -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div
          class="bg-surface border border-border rounded-lg p-3"
          title="Bytes que las tools han devuelto a Claude, convertidos a tokens. Es el input que el modelo ha tenido que leer — no incluye prompts, respuestas del modelo ni thinking."
        >
          <div class="text-muted text-[10px] font-mono mb-1">Tokens totales</div>
          <div class="text-text text-lg font-mono font-semibold">
            {{ formatTokens(data.totals.total_tokens) }}
          </div>
          <div class="text-muted text-[9px] font-mono leading-tight mt-1">
            Output de herramientas que Claude ha tenido que leer.<br />
            <span class="text-muted/70">Bajar esto = ahorrar contexto real.</span>
          </div>
        </div>

        <div
          class="bg-surface border border-border rounded-lg p-3"
          title="Número total de veces que Claude ha llamado a una herramienta. Cada llamada se mide por separado."
        >
          <div class="text-muted text-[10px] font-mono mb-1">Llamadas totales</div>
          <div class="text-text text-lg font-mono font-semibold">
            {{ data.totals.total_events.toLocaleString() }}
          </div>
          <div class="text-muted text-[9px] font-mono leading-tight mt-1">
            Número de veces que Claude ha usado una herramienta.<br />
            <span class="text-muted/70">Muchas llamadas pequeñas &gt; pocas llamadas gigantes.</span>
          </div>
        </div>

        <div
          class="bg-surface border border-border rounded-lg p-3"
          title="Sesiones distintas de Claude Code registradas desde que configuraste el hook."
        >
          <div class="text-muted text-[10px] font-mono mb-1">Sesiones</div>
          <div class="text-text text-lg font-mono font-semibold">
            {{ data.totals.session_count }}
          </div>
          <div class="text-muted text-[9px] font-mono leading-tight mt-1">
            Conversaciones distintas de Claude Code.<br />
            <span class="text-muted/70">Una por cada vez que abriste el CLI.</span>
          </div>
        </div>

        <div
          class="bg-surface border border-border rounded-lg p-3"
          title="Porcentaje de tus llamadas que han pasado por un optimizador (serena o rtk) vs las que han ido directas (Read, Bash crudo, etc). >30% es bueno."
        >
          <div class="text-muted text-[10px] font-mono mb-1">Score de optimización</div>
          <div
            v-if="optimizationScore !== null"
            class="text-lg font-mono font-semibold"
            :class="optimizationScore > 30 ? 'text-green' : optimizationScore > 10 ? 'text-cyan' : 'text-muted'"
          >
            {{ optimizationScore }}%
          </div>
          <div v-else class="text-muted text-lg font-mono">0%</div>
          <div class="text-muted text-[9px] font-mono leading-tight mt-1">
            % de llamadas vía serena o rtk.<br />
            <span class="text-muted/70">&gt;30% bueno &middot; &lt;10% hay margen.</span>
          </div>
        </div>
      </div>

      <!-- Combined savings banner -->
      <div
        v-if="totalSavings"
        class="bg-green/5 border border-green/20 rounded-lg p-4 flex items-baseline justify-between gap-4"
      >
        <div>
          <div class="text-green text-xs font-mono font-semibold">Ahorro total estimado</div>
          <div class="text-muted text-[10px] font-mono mt-0.5">
            Suma de los ahorros estimados de serena y rtk sobre el histórico de esta instalación.
          </div>
        </div>
        <div class="text-right">
          <div class="text-green text-2xl font-mono font-semibold leading-none">
            ~{{ formatTokens(totalSavings) }}
          </div>
          <div class="text-muted/70 text-[9px] font-mono mt-1">tokens que Claude no ha tenido que leer</div>
        </div>
      </div>

      <!-- Serena + RTK savings side by side -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <!-- Serena -->
        <div
          v-if="serenaSavings"
          class="bg-purple/5 border border-purple/20 rounded-lg p-4"
        >
          <div class="flex items-baseline justify-between mb-2">
            <div class="text-purple text-xs font-mono font-semibold">
              Ahorro estimado con Serena
            </div>
            <div class="text-muted/70 text-[9px] font-mono">
              ESTIMACIÓN &middot; factor fijo 5×
            </div>
          </div>
          <div class="text-muted text-[10px] font-mono mb-3 leading-tight">
            <strong class="text-text">Qué hace:</strong> lee sólo el símbolo que pides
            (función, clase, método) en vez del archivo entero.<br />
            <strong class="text-text">Por qué ahorra:</strong> si el archivo tiene 500
            líneas y sólo necesitas 1 función, Read devuelve las 500 — serena devuelve ~20.<br />
            <strong class="text-text">Cómo se calcula:</strong> tokens_serena × 5 = lo que
            habría costado con Read.
          </div>
          <div class="grid grid-cols-2 gap-2 text-xs font-mono">
            <div title="Número de veces que Claude ha llamado a una tool de serena.">
              <div class="text-muted text-[10px]">Llamadas</div>
              <div class="text-text font-semibold">{{ serenaSavings.calls }}</div>
            </div>
            <div title="Tokens reales que esas llamadas han consumido (medido).">
              <div class="text-muted text-[10px]">Tokens consumidos</div>
              <div class="text-text font-semibold">
                {{ formatTokens(serenaSavings.serenaTokens) }}
              </div>
            </div>
            <div title="Proyección: si esas lecturas las hubieras hecho con Read.">
              <div class="text-muted text-[10px]">Habría costado con Read</div>
              <div class="text-red font-semibold">
                ~{{ formatTokens(serenaSavings.wouldHaveCost) }}
              </div>
            </div>
            <div title="Diferencia entre Read hipotético y serena real.">
              <div class="text-muted text-[10px]">Ahorro estimado</div>
              <div class="text-green font-semibold">
                ~{{ formatTokens(serenaSavings.saved) }}
              </div>
            </div>
          </div>
          <div class="text-muted text-[9px] font-mono mt-2 leading-tight">
            Ratio 5× = valor conservador del rango real 3-10×. Archivos grandes ahorran más
            (hasta 10×); ficheros pequeños tienden a 3×.
          </div>
        </div>

        <!-- RTK -->
        <div
          v-if="rtkSavings"
          class="bg-green/5 border border-green/20 rounded-lg p-4"
        >
          <div class="flex items-baseline justify-between mb-2">
            <div class="text-green text-xs font-mono font-semibold">
              Ahorro estimado con RTK
            </div>
            <div class="text-muted/70 text-[9px] font-mono">
              ESTIMACIÓN &middot; factor fijo 4×
            </div>
          </div>
          <div class="text-muted text-[10px] font-mono mb-3 leading-tight">
            <strong class="text-text">Qué hace:</strong> wrap de Bash que filtra el output
            antes de que llegue al modelo (rtk git status, rtk vitest, rtk cargo build…).<br />
            <strong class="text-text">Por qué ahorra:</strong> agrupa errores, deduplica líneas,
            quita diagnósticos ruidosos — devuelve sólo lo que importa.<br />
            <strong class="text-text">Cómo se calcula:</strong> tokens_rtk × 4 = lo que habría
            costado con Bash crudo.
          </div>
          <div class="grid grid-cols-2 gap-2 text-xs font-mono">
            <div title="Número de veces que Claude ha llamado a una Bash envuelta con rtk.">
              <div class="text-muted text-[10px]">Llamadas</div>
              <div class="text-text font-semibold">{{ rtkSavings.calls }}</div>
            </div>
            <div title="Tokens reales que esas llamadas han consumido (medido).">
              <div class="text-muted text-[10px]">Tokens consumidos</div>
              <div class="text-text font-semibold">
                {{ formatTokens(rtkSavings.rtkTokens) }}
              </div>
            </div>
            <div title="Proyección: si esas mismas calls hubieran ido a Bash sin filtrar.">
              <div class="text-muted text-[10px]">Habría costado Bash crudo</div>
              <div class="text-red font-semibold">
                ~{{ formatTokens(rtkSavings.wouldHaveCost) }}
              </div>
            </div>
            <div title="Diferencia entre Bash hipotético y rtk real.">
              <div class="text-muted text-[10px]">Ahorro estimado</div>
              <div class="text-green font-semibold">
                ~{{ formatTokens(rtkSavings.saved) }}
              </div>
            </div>
          </div>
          <div class="text-muted text-[9px] font-mono mt-2 leading-tight">
            Ratio 4× = ~75% reducción, rango honesto del real 60-99%. Comandos con mucho ruido
            (vitest, cargo, git log) rompen el 90%; comandos ya cortos (git status) rondan el 60%.
          </div>
        </div>
      </div>

      <!-- Source breakdown + top tools -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <!-- Source breakdown -->
        <div class="bg-surface border border-border rounded-lg p-4">
          <div class="text-muted text-xs font-mono mb-1">Desglose por fuente</div>
          <div class="text-muted text-[9px] font-mono mb-3 leading-tight">
            De dónde vienen los tokens que consume Claude. Cada fila lleva un badge:
            <span class="text-green">ahorra</span> (optimiza),
            <span class="text-muted">sin filtro</span> (output crudo),
            <span class="text-cyan">externo</span> (depende del MCP),
            <span class="text-muted/60">propio</span> (no cuenta).
          </div>
          <div class="space-y-2">
            <div
              v-for="source in data.global_by_source"
              :key="source.source"
              class="space-y-0.5"
            >
              <div class="flex items-center gap-2 text-xs font-mono">
                <span class="w-16 text-right text-text">{{ sourceLabel(source.source) }}</span>
                <div class="flex-1 h-5 bg-bg rounded overflow-hidden">
                  <div
                    class="h-full rounded transition-all duration-500"
                    :style="{
                      width: barWidth(source.tokens, data.global_by_source),
                      backgroundColor: sourceColor(source.source),
                      opacity: 0.75,
                    }"
                  />
                </div>
                <span class="w-20 text-right text-text">
                  {{ formatTokens(source.tokens) }}
                </span>
                <span class="w-10 text-right text-muted">×{{ source.count }}</span>
                <span class="w-12 text-right text-muted">
                  {{ tokenPercent(source.tokens, data.totals.total_tokens) }}
                </span>
              </div>
              <div
                class="flex items-start gap-1.5 text-[9px] font-mono"
                style="margin-left: 4.5rem"
              >
                <span
                  class="px-1 border rounded text-[8px] uppercase tracking-wide shrink-0"
                  :class="impactClass(sourceImpact(source.source).tone)"
                >
                  {{ sourceImpact(source.source).label }}
                </span>
                <span class="text-muted leading-tight">{{ sourceDesc(source.source) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Top tools -->
        <div class="bg-surface border border-border rounded-lg p-4">
          <div class="text-muted text-xs font-mono mb-1">
            Top 10 herramientas más costosas
          </div>
          <div class="text-muted text-[9px] font-mono mb-3 leading-tight">
            Ordenadas por tokens totales (output → input de Claude).<br />
            <span class="text-muted/70">
              Total alto no es malo si la tool se usa mucho — fíjate en
              <strong class="text-text">Prom/call</strong>: alto = devuelve respuestas gordas
              (considera filtrar o usar serena/rtk).
            </span>
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
              <span class="w-16 text-right text-text">
                {{ formatTokens(tool.tokens) }}
              </span>
              <span class="w-16 text-right text-muted">
                {{ formatTokens(Math.round(tool.avg_tokens)) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Per-project cards -->
      <div>
        <div class="text-muted text-xs font-mono mb-1">Por proyecto</div>
        <div class="text-muted text-[9px] font-mono mb-3">
          Click en un proyecto para ver el detalle de herramientas
        </div>
        <div class="space-y-3">
          <div
            v-for="project in data.projects"
            :key="project.projectPath"
            class="bg-surface border border-border rounded-lg overflow-hidden transition-colors"
            :class="expandedProject === project.projectPath ? 'border-purple/40' : ''"
          >
            <!-- Header -->
            <div
              class="p-4 cursor-pointer hover:bg-surface-hover transition-colors"
              @click="toggleProject(project.projectPath)"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="text-text text-sm font-mono font-semibold">
                    {{ project.projectName || 'sin-proyecto' }}
                  </div>
                  <div class="text-muted text-[10px] font-mono">
                    {{ project.session_count }} sesiones · {{ project.total_events }} llamadas
                  </div>
                </div>
                <div class="flex items-center gap-3">
                  <div class="text-text text-sm font-mono">
                    {{ formatTokens(project.total_tokens) }} tok
                  </div>
                  <span class="text-muted text-[10px]">
                    {{ expandedProject === project.projectPath ? '▾' : '▸' }}
                  </span>
                </div>
              </div>

              <!-- Inline source bar -->
              <div class="flex h-2 mt-3 rounded overflow-hidden bg-bg">
                <div
                  v-for="src in project.by_source"
                  :key="src.source"
                  class="h-full"
                  :style="{
                    width: `${(src.tokens / Math.max(project.total_tokens, 1)) * 100}%`,
                    backgroundColor: sourceColor(src.source),
                    opacity: 0.8,
                  }"
                  :title="`${sourceLabel(src.source)}: ${formatTokens(src.tokens)} tok (${src.count} calls)`"
                />
              </div>
            </div>

            <!-- Expanded detail -->
            <div
              v-if="expandedProject === project.projectPath"
              class="border-t border-border bg-bg/40 p-4 text-xs font-mono"
            >
              <div class="text-muted mb-2">Top herramientas en este proyecto:</div>
              <div class="space-y-0.5">
                <div
                  v-for="(tool, i) in project.by_tool"
                  :key="tool.tool_name"
                  class="flex items-center gap-2"
                >
                  <span class="w-4 text-muted text-right text-[10px]">{{ i + 1 }}</span>
                  <span class="flex-1 text-text truncate">{{ tool.tool_name }}</span>
                  <span class="w-12 text-right text-muted">{{ tool.count }}</span>
                  <span class="w-16 text-right text-text">
                    {{ formatTokens(tool.tokens) }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
