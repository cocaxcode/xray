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
  commandPreview?: string;
  /**
   * Tokens ahorrados por esta call concreta (shadow_delta_tokens del backend).
   * Sólo presente en eventos de source=serena con cable shadow, o source=rtk
   * con cable rtk-reader. Ausente en builtin/mcp/own/xray.
   */
  shadowDelta?: number;
  ts: number;
}

interface SavingsFactorStats {
  calls: number;
  total_consumed: number;
  total_saved: number;
  factor_aggregate: number;
  factor_median: number;
  factor_mean: number;
  confidence: 'low' | 'medium' | 'high';
}

interface SavingsFactorsResponse {
  serena: SavingsFactorStats | null;
  rtk: SavingsFactorStats | null;
}

const { getAuthHeaders } = useAuth();
const { onMessage } = useWebSocket();

const data = ref<GlobalOptData | null>(null);
const savingsFactors = ref<SavingsFactorsResponse | null>(null);
const loading = ref(true);
const expandedProject = ref<string | null>(null);

// ── Date filter ──────────────────────────────────────────────────────────────
type DatePreset = 'today' | '7d' | '30d' | 'all' | 'custom';
const preset = ref<DatePreset>('all');
const fromDate = ref('');
const toDate = ref('');

// Returns YYYY-MM-DD in LOCAL time (drives <input type="date"> values)
function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Converts a local YYYY-MM-DD string to a UTC datetime string for SQLite comparison.
// SQLite stores created_at as UTC (datetime('now')), so we must send UTC bounds.
function localDateToUtcStr(dateStr: string, nextDay = false): string {
  const d = new Date(dateStr + 'T00:00:00'); // parse as local midnight
  if (nextDay) d.setDate(d.getDate() + 1);  // exclusive upper bound = next local midnight
  return d.toISOString().slice(0, 19).replace('T', ' '); // → "YYYY-MM-DD HH:MM:SS" UTC
}

function setPreset(p: DatePreset): void {
  preset.value = p;
  const today = new Date();
  if (p === 'today') {
    fromDate.value = toLocalDateStr(today);
    toDate.value = toLocalDateStr(today);
  } else if (p === '7d') {
    fromDate.value = toLocalDateStr(addDays(today, -7));
    toDate.value = toLocalDateStr(today);
  } else if (p === '30d') {
    fromDate.value = toLocalDateStr(addDays(today, -30));
    toDate.value = toLocalDateStr(today);
  } else {
    fromDate.value = '';
    toDate.value = '';
  }
  loadData();
}

function onDateChange(): void {
  preset.value = 'custom';
  loadData();
}

function buildFilterParams(): string {
  const params = new URLSearchParams();
  if (fromDate.value) params.set('from', localDateToUtcStr(fromDate.value));
  if (toDate.value) params.set('to', localDateToUtcStr(toDate.value, true)); // inclusive of toDate
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
// ─────────────────────────────────────────────────────────────────────────────

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
  const params = buildFilterParams();
  try {
    const [optRes, factorsRes] = await Promise.all([
      fetch(`/api/optimization${params}`, { headers: getAuthHeaders() }),
      fetch(`/api/savings-factors${params}`, { headers: getAuthHeaders() }),
    ]);
    if (optRes.ok) data.value = await optRes.json();
    if (factorsRes.ok) savingsFactors.value = await factorsRes.json();
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
      commandPreview?: string;
      shadowDelta?: number;
    };

    liveCounter++;
    const next: LiveEvent = {
      id: liveCounter,
      sessionId: evt.sessionId,
      source: evt.source,
      tokens: evt.tokens,
      toolName: evt.toolName,
      commandPreview: evt.commandPreview,
      shadowDelta: evt.shadowDelta,
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

// Fallback factors cuando no hay shadow_delta_tokens medidos.
// El rango real de serena es 3-10×; usamos 5× como mid. RTK 60-99% reducción = ~4×.
// Cuando /api/savings-factors devuelve un factor medido sobre tus datos
// reales, usamos ese en lugar de la constante.
const SERENA_FALLBACK_FACTOR = 5;
const RTK_FALLBACK_FACTOR = 4;

interface SavingsCardData {
  tokens: number;           // tokens consumidos por la source (heurística chars × 0.27)
  wouldHaveCost: number;    // proyección: tokens × factor
  saved: number;            // wouldHaveCost − tokens
  calls: number;            // número de llamadas (real)
  factor: number;           // factor aplicado
  factorSource: 'measured' | 'fallback';  // de dónde viene el factor
  measuredCalls: number;    // nº de calls con shadow_delta_tokens medido (0 si fallback)
  confidence: 'low' | 'medium' | 'high' | null;  // null si fallback
  /** Ahorro REAL medido (suma directa de shadow_delta_tokens de las calls medidas). */
  measuredSaved: number;
  /** Tokens consumidos REALES sobre las calls medidas. */
  measuredConsumed: number;
}

function buildSavingsCard(
  sourceKey: 'serena' | 'rtk',
  fallbackFactor: number,
): SavingsCardData | null {
  if (!data.value?.global_by_source) return null;
  const breakdown = data.value.global_by_source.find((s) => s.source === sourceKey);
  if (!breakdown || breakdown.tokens === 0) return null;

  const measured = savingsFactors.value?.[sourceKey] ?? null;
  const useMeasured = measured !== null && measured.calls >= 1;

  // El factor se muestra como métrica informativa en el badge (MEDIDO
  // 51.05×). Ya NO se usa para extrapolar el ahorro al total: sólo
  // contamos como ahorro lo que el shadow midió de verdad, call por call.
  const factor = useMeasured ? measured.factor_median : fallbackFactor;

  // Datos DUROS del shadow (no extrapolación):
  //   - consumed medido: suma de tokens_estimated de calls con shadow
  //   - saved medido:    suma de shadow_delta_tokens de esas calls
  //   - wouldHaveCost:   consumed + saved (lo que habrías leído sin la tool)
  const measuredConsumed = measured?.total_consumed ?? 0;
  const measuredSaved = measured?.total_saved ?? 0;
  const wouldHaveCost = measuredConsumed + measuredSaved;

  return {
    tokens: breakdown.tokens,              // total de tokens heurística (todas las calls)
    wouldHaveCost,                          // dato duro: consumed + saved de las medidas
    saved: measuredSaved,                   // dato duro: ahorro real medido
    calls: breakdown.count,                 // total de llamadas (incl. las no medibles)
    factor,                                 // informativo en badge
    factorSource: useMeasured ? 'measured' : 'fallback',
    measuredCalls: measured?.calls ?? 0,
    confidence: measured?.confidence ?? null,
    measuredSaved,
    measuredConsumed,
  };
}

const serenaSavings = computed(() => buildSavingsCard('serena', SERENA_FALLBACK_FACTOR));
const rtkSavings = computed(() => buildSavingsCard('rtk', RTK_FALLBACK_FACTOR));

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
    <!-- Date filter bar -->
    <div class="flex items-center gap-2 flex-wrap">
      <div class="flex items-center gap-1">
        <button
          v-for="p in [{ key: 'today', label: 'Hoy' }, { key: '7d', label: '7 días' }, { key: '30d', label: 'Mes' }, { key: 'all', label: 'Todo' }]"
          :key="p.key"
          class="px-3 py-1 text-[11px] font-mono rounded border transition-colors"
          :class="preset === p.key
            ? 'bg-cyan/10 border-cyan/50 text-cyan'
            : 'bg-surface border-border text-muted hover:text-text hover:border-border/80'"
          @click="setPreset(p.key as DatePreset)"
        >{{ p.label }}</button>
      </div>
      <div class="flex items-center gap-1.5 text-muted text-[11px] font-mono">
        <span class="text-border">|</span>
        <input
          type="date"
          v-model="fromDate"
          @change="onDateChange"
          class="bg-surface border border-border rounded px-2 py-0.5 text-[11px] font-mono text-text focus:outline-none focus:border-cyan/50"
        />
        <span>→</span>
        <input
          type="date"
          v-model="toDate"
          @change="onDateChange"
          class="bg-surface border border-border rounded px-2 py-0.5 text-[11px] font-mono text-text focus:outline-none focus:border-cyan/50"
        />
      </div>
    </div>

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
          <div class="text-muted text-[10px] font-mono" title="Los tokens mostrados son estimación (chars × 0.27) del output que devolvió cada tool. Para la factura real de Anthropic mira el header de cada sesión (tokens del transcript).">
            Últimas tool calls · tokens estimados (heurística chars × 0.27)
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
            <span class="flex-1 text-text truncate">
              {{ evt.toolName }}
              <span v-if="evt.commandPreview" class="text-muted ml-1">— {{ evt.commandPreview }}</span>
            </span>
            <span class="text-muted w-20 text-right" :title="'~' + formatTokens(evt.tokens) + ' tokens (estimado chars × 0.27)'">~{{ formatTokens(evt.tokens) }} tok</span>
            <span
              v-if="evt.shadowDelta != null && evt.shadowDelta > 0"
              class="text-green/70 w-28 text-right"
              :title="`Sin ${sourceLabel(evt.source)} habrías gastado ~${formatTokens(evt.tokens + evt.shadowDelta)} tokens. El ahorro medido de esta call es ~${formatTokens(evt.shadowDelta)}.`"
            >
              sin {{ sourceLabel(evt.source).toLowerCase() }}: ~{{ formatTokens(evt.tokens + evt.shadowDelta) }}
            </span>
            <span
              v-else
              class="w-28"
            ></span>
            <span class="text-muted/60 w-16 text-right text-[9px]">{{ relativeTs(evt.ts) }}</span>
          </div>
        </div>
      </div>

      <!-- Global summary cards (no dollars, only tokens) -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div
          class="bg-surface border border-border rounded-lg p-3"
          title="Estimación heurística (chars × 0.27) de los bytes que las tools han devuelto a Claude. No es la factura real de Anthropic — para eso mira los tokens del header de cada sesión."
        >
          <div class="flex items-baseline justify-between mb-1">
            <div class="text-muted text-[10px] font-mono">Tokens totales tools</div>
            <div class="text-muted/60 text-[8px] font-mono uppercase tracking-wide">est.</div>
          </div>
          <div class="text-text text-lg font-mono font-semibold">
            ~{{ formatTokens(data.totals.total_tokens) }}
          </div>
          <div class="text-muted text-[9px] font-mono leading-tight mt-1">
            Output de tools (heurística chars × 0.27).<br />
            <span class="text-muted/70">Bajar esto = menos ruido en el contexto.</span>
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
          <div class="text-green text-xs font-mono font-semibold">Ahorro total REAL medido</div>
          <div class="text-muted text-[10px] font-mono mt-0.5">
            Suma directa de shadow_delta_tokens de las calls donde el cable midió.
            Dato duro, sin factor ni extrapolación.
          </div>
        </div>
        <div class="text-right">
          <div class="text-green text-2xl font-mono font-semibold leading-none">
            {{ formatTokens(totalSavings) }}
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
            <div
              v-if="serenaSavings.factorSource === 'measured' && serenaSavings.confidence === 'low'"
              class="text-muted/70 text-[9px] font-mono"
              :title="`Factor mediana de ${serenaSavings.measuredCalls} calls tuyas con shadow_delta_tokens medido. Confianza baja por muestra pequeña; desde 10 calls sube a media.`"
            >
              PRELIMINAR · factor {{ serenaSavings.factor.toFixed(2) }}× (n={{ serenaSavings.measuredCalls }})
            </div>
            <div
              v-else-if="serenaSavings.factorSource === 'measured'"
              class="text-muted/70 text-[9px] font-mono"
              :title="`Factor mediana de ${serenaSavings.measuredCalls} calls tuyas con shadow_delta_tokens medido (confianza ${serenaSavings.confidence}).`"
            >
              MEDIDO · factor {{ serenaSavings.factor.toFixed(2) }}× (n={{ serenaSavings.measuredCalls }})
            </div>
            <div
              v-else
              class="text-muted/70 text-[9px] font-mono"
              title="Aún no hay ninguna call con shadow medido. El cable requiere shadow_measurement.serena=true en ~/.token-optimizer/config.json y se activa automáticamente con `token-optimizer-mcp install` cuando detecta serena."
            >
              BASELINE · factor fijo 5× (sin datos medidos)
            </div>
          </div>
          <div class="text-muted text-[10px] font-mono mb-3 leading-tight">
            <strong class="text-text">Qué hace:</strong> lee sólo el símbolo que pides
            (función, clase, método) en vez del archivo entero.<br />
            <strong class="text-text">Por qué ahorra:</strong> si el archivo tiene 500
            líneas y sólo necesitas 1 función, Read devuelve las 500 — serena devuelve ~20.<br />
            <strong class="text-text">Datos:</strong> suma directa de shadow_delta_tokens
            de las calls donde el cable midió (find_symbol / get_symbols_overview con path).
            Sin factor, sin extrapolación.
          </div>
          <div class="grid grid-cols-2 gap-2 text-xs font-mono">
            <div title="Total de llamadas a serena. Entre paréntesis las que tuvieron shadow medido — el resto (write_memory, initial_instructions…) no son comparables con Read.">
              <div class="text-muted text-[10px]">Llamadas totales</div>
              <div class="text-text font-semibold">
                {{ serenaSavings.calls }}
                <span v-if="serenaSavings.measuredCalls !== serenaSavings.calls" class="text-muted/60 text-[10px] font-normal">
                  ({{ serenaSavings.measuredCalls }} medidas)
                </span>
              </div>
            </div>
            <div title="Suma de tokens_estimated sobre las calls con shadow medido. Heurística chars × 0.27.">
              <div class="text-muted text-[10px]">Tokens leídos con serena</div>
              <div class="text-text font-semibold">
                ~{{ formatTokens(serenaSavings.measuredConsumed) }}
              </div>
            </div>
            <div title="Dato duro: suma de (tokens_estimated + shadow_delta_tokens) de las calls medidas = lo que habrías leído haciendo Read completo del archivo.">
              <div class="text-muted text-[10px]">Sin serena habrías leído</div>
              <div class="text-red font-semibold">
                ~{{ formatTokens(serenaSavings.wouldHaveCost) }}
              </div>
            </div>
            <div title="Dato duro: suma directa de shadow_delta_tokens. Lo que el cable midió call por call, sin factor ni extrapolación.">
              <div class="text-muted text-[10px]">Ahorro REAL medido</div>
              <div class="text-green font-semibold">
                {{ formatTokens(serenaSavings.saved) }}
              </div>
            </div>
          </div>
          <div class="text-muted text-[9px] font-mono mt-2 leading-tight">
            <template v-if="serenaSavings.factorSource === 'measured'">
              El factor del badge ({{ serenaSavings.factor.toFixed(2) }}×) es informativo:
              cuántas veces más grande sería el archivo completo que el símbolo que pediste, mediana
              sobre {{ serenaSavings.measuredCalls }} call{{ serenaSavings.measuredCalls === 1 ? '' : 's' }}.
              Los números de la card son datos duros del shadow — no se proyectan a las calls sin medir
              (write_memory, read_memory, etc.).
            </template>
            <template v-else>
              Sin datos medidos todavía. Activa
              <span class="text-cyan">shadow_measurement.serena=true</span> en
              ~/.token-optimizer/config.json (o ejecuta
              <span class="text-cyan">npx @cocaxcode/token-optimizer-mcp install</span>
              para que lo active solo).
            </template>
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
            <div
              v-if="rtkSavings.factorSource === 'measured' && rtkSavings.confidence === 'low'"
              class="text-muted/70 text-[9px] font-mono"
              :title="`Factor mediana de ${rtkSavings.measuredCalls} calls tuyas con shadow medido. Confianza baja por muestra pequeña; desde 10 calls sube a media.`"
            >
              PRELIMINAR · factor {{ rtkSavings.factor.toFixed(2) }}× (n={{ rtkSavings.measuredCalls }})
            </div>
            <div
              v-else-if="rtkSavings.factorSource === 'measured'"
              class="text-muted/70 text-[9px] font-mono"
              :title="`Factor mediana de ${rtkSavings.measuredCalls} calls tuyas con shadow medido (confianza ${rtkSavings.confidence}).`"
            >
              MEDIDO · factor {{ rtkSavings.factor.toFixed(2) }}× (n={{ rtkSavings.measuredCalls }})
            </div>
            <div
              v-else
              class="text-muted/70 text-[9px] font-mono"
              title="Sin datos medidos todavía. token-optimizer-mcp >= v0.5 tiene el cable rtk-reader activo; las nuevas calls RTK empezarán a llenar shadow_delta_tokens automáticamente."
            >
              BASELINE · factor fijo 4× (sin datos medidos)
            </div>
          </div>
          <div class="text-muted text-[10px] font-mono mb-3 leading-tight">
            <strong class="text-text">Qué hace:</strong> wrap de Bash que filtra el output
            antes de que llegue al modelo (rtk git status, rtk vitest, rtk cargo build…).<br />
            <strong class="text-text">Por qué ahorra:</strong> agrupa errores, deduplica líneas,
            quita diagnósticos ruidosos — devuelve sólo lo que importa.<br />
            <strong class="text-text">Datos:</strong> suma directa de shadow_delta_tokens
            de las calls donde el cable midió (marker, tracking.db o fallback).
            Sin factor, sin extrapolación.
          </div>
          <div class="grid grid-cols-2 gap-2 text-xs font-mono">
            <div title="Total de llamadas a Bash envueltas por RTK. Entre paréntesis las que tuvieron shadow medido.">
              <div class="text-muted text-[10px]">Llamadas totales</div>
              <div class="text-text font-semibold">
                {{ rtkSavings.calls }}
                <span v-if="rtkSavings.measuredCalls !== rtkSavings.calls" class="text-muted/60 text-[10px] font-normal">
                  ({{ rtkSavings.measuredCalls }} medidas)
                </span>
              </div>
            </div>
            <div title="Suma de tokens_estimated sobre las calls con shadow medido. Heurística chars × 0.27.">
              <div class="text-muted text-[10px]">Tokens leídos con RTK</div>
              <div class="text-text font-semibold">
                ~{{ formatTokens(rtkSavings.measuredConsumed) }}
              </div>
            </div>
            <div title="Dato duro: suma de (tokens_estimated + shadow_delta_tokens) de las calls medidas = lo que habrías leído con Bash crudo sin filtro.">
              <div class="text-muted text-[10px]">Sin RTK habrías leído</div>
              <div class="text-red font-semibold">
                ~{{ formatTokens(rtkSavings.wouldHaveCost) }}
              </div>
            </div>
            <div title="Dato duro: suma directa de shadow_delta_tokens. Lo que RTK ha filtrado de verdad, medido call por call.">
              <div class="text-muted text-[10px]">Ahorro REAL medido</div>
              <div class="text-green font-semibold">
                {{ formatTokens(rtkSavings.saved) }}
              </div>
            </div>
          </div>
          <div class="text-muted text-[9px] font-mono mt-2 leading-tight">
            <template v-if="rtkSavings.factorSource === 'measured'">
              El factor del badge ({{ rtkSavings.factor.toFixed(2) }}×) es informativo:
              cuánto más grande sería el output sin filtrar, mediana sobre
              {{ rtkSavings.measuredCalls }} call{{ rtkSavings.measuredCalls === 1 ? '' : 's' }}.
              Comandos cortos (git status) tiran del factor hacia abajo; ruidosos (vitest, cargo) lo suben.
              Los números de la card son datos duros del shadow.
            </template>
            <template v-else>
              Sin datos medidos todavía. Instala
              <span class="text-cyan">@cocaxcode/token-optimizer-mcp@latest</span> para
              que el cable rtk-reader rellene shadow_delta_tokens en cada call.
            </template>
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
