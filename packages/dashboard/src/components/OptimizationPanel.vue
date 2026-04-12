<script setup lang="ts">
import type { OptimizationData } from '../types';
import { formatTokens } from '../utils/format';

const props = defineProps<{
  data: OptimizationData;
}>();

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

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

function sourceColor(source: string): string {
  return SOURCE_COLORS[source] ?? 'bg-zinc-500';
}

function barWidth(tokens: number): string {
  if (!props.data.realtimeBreakdown.length) return '0%';
  const max = Math.max(...props.data.realtimeBreakdown.map((b) => b.tokens));
  return max > 0 ? `${(tokens / max) * 100}%` : '0%';
}

function tokenPercent(tokens: number): string {
  const total = props.data.realtimeBreakdown.reduce((s, b) => s + b.tokens, 0);
  if (total === 0) return '0%';
  return `${((tokens / total) * 100).toFixed(1)}%`;
}

// Sort by_tool by tokens DESC, top 10
const topTools = computed(() => {
  if (!props.data.summary?.by_tool) return [];
  return [...props.data.summary.by_tool].sort((a, b) => b.tokens - a.tokens).slice(0, 10);
});

const totalTokens = computed(() =>
  props.data.realtimeBreakdown.reduce((s, b) => s + b.tokens, 0),
);

import { computed } from 'vue';
</script>

<template>
  <div class="space-y-4 text-xs font-mono p-1">
    <!-- Sin datos -->
    <div v-if="data.eventCount === 0" class="text-muted p-2">
      Sin datos de token-optimizer para esta sesion.
      <span class="text-cyan">Verifica que XRAY_URL este configurado.</span>
    </div>

    <template v-else>
      <!-- Coste estimado -->
      <div>
        <div class="text-muted mb-1.5">Coste estimado (input)</div>
        <div class="flex gap-3 flex-wrap">
          <div class="px-2 py-1 rounded bg-surface-hover">
            <span class="text-muted">Haiku: </span>
            <span class="text-green">{{ formatCost(data.summary?.cost_haiku ?? (totalTokens / 1_000_000 * 1)) }}</span>
          </div>
          <div class="px-2 py-1 rounded bg-surface-hover">
            <span class="text-muted">Sonnet: </span>
            <span class="text-cyan">{{ formatCost(data.summary?.cost_sonnet ?? (totalTokens / 1_000_000 * 3)) }}</span>
          </div>
          <div class="px-2 py-1 rounded bg-surface-hover">
            <span class="text-muted">Opus: </span>
            <span class="text-purple">{{ formatCost(data.summary?.cost_opus ?? (totalTokens / 1_000_000 * 5)) }}</span>
          </div>
          <div class="px-2 py-1 rounded bg-surface-hover">
            <span class="text-muted">Total: </span>
            <span class="text-text">{{ formatTokens(totalTokens) }} tokens</span>
          </div>
        </div>
      </div>

      <!-- Desglose por fuente -->
      <div>
        <div class="text-muted mb-1.5">Desglose por fuente</div>
        <div class="space-y-1">
          <div
            v-for="source in data.realtimeBreakdown"
            :key="source.source"
            class="flex items-center gap-2"
          >
            <span class="w-16 text-right text-text">{{ sourceLabel(source.source) }}</span>
            <div class="flex-1 h-4 bg-surface-hover rounded overflow-hidden">
              <div
                class="h-full rounded transition-all duration-300"
                :class="sourceColor(source.source)"
                :style="{ width: barWidth(source.tokens), opacity: 0.7 }"
              />
            </div>
            <span class="w-20 text-right text-muted">{{ formatTokens(source.tokens) }}</span>
            <span class="w-12 text-right text-muted">{{ tokenPercent(source.tokens) }}</span>
          </div>
        </div>
      </div>

      <!-- Ranking herramientas (si hay summary) -->
      <div v-if="topTools.length > 0">
        <div class="text-muted mb-1.5">Top herramientas (por tokens)</div>
        <div class="space-y-0.5">
          <div
            v-for="(tool, i) in topTools"
            :key="tool.tool_name"
            class="flex items-center gap-2 py-0.5"
          >
            <span class="w-4 text-muted text-right">{{ i + 1 }}</span>
            <span class="flex-1 text-text truncate">{{ tool.tool_name }}</span>
            <span class="text-muted">x{{ tool.count }}</span>
            <span class="w-20 text-right text-text">{{ formatTokens(tool.tokens) }}</span>
          </div>
        </div>
      </div>

      <!-- Sondas (si hay summary) -->
      <div v-if="data.summary?.probes">
        <div class="text-muted mb-1.5">Sondas de optimizacion</div>
        <div class="grid grid-cols-2 gap-2">
          <div class="flex items-center gap-2">
            <span :class="data.summary.probes.serena.present ? 'text-green' : 'text-red'">
              {{ data.summary.probes.serena.present ? '~' : 'x' }}
            </span>
            <span class="text-text">Serena</span>
            <span class="text-muted">({{ (data.summary.probes.serena.confidence * 100).toFixed(0) }}%)</span>
          </div>
          <div class="flex items-center gap-2">
            <span :class="data.summary.probes.rtk.present ? 'text-green' : 'text-red'">
              {{ data.summary.probes.rtk.present ? '~' : 'x' }}
            </span>
            <span class="text-text">RTK</span>
            <span class="text-muted">({{ (data.summary.probes.rtk.confidence * 100).toFixed(0) }}%)</span>
          </div>
          <div class="flex items-center gap-2">
            <span :class="data.summary.probes.mcp_pruning.present ? 'text-green' : 'text-red'">
              {{ data.summary.probes.mcp_pruning.present ? '~' : 'x' }}
            </span>
            <span class="text-text">MCP Pruning</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-green">~</span>
            <span class="text-text">Prompt Caching</span>
          </div>
        </div>
      </div>

      <!-- Tips del coach -->
      <div v-if="data.summary?.coach_tips_surfaced?.length">
        <div class="text-muted mb-1.5">Tips del coach activados</div>
        <div class="space-y-1">
          <div
            v-for="tip in data.summary.coach_tips_surfaced"
            :key="tip.rule_id"
            class="flex items-center gap-2"
          >
            <span
              class="text-[10px] px-1 rounded"
              :class="{
                'bg-red/20 text-red': tip.severity === 'critical',
                'bg-yellow-500/20 text-yellow-400': tip.severity === 'warn',
                'bg-cyan/20 text-cyan': tip.severity === 'info',
              }"
            >
              {{ tip.severity }}
            </span>
            <span class="text-text">{{ tip.rule_id }}</span>
            <span class="text-muted">{{ tip.tip_ids.join(', ') }}</span>
          </div>
        </div>
      </div>

      <!-- Schema -->
      <div v-if="data.summary?.schema_measurement">
        <div class="text-muted mb-1.5">Schema de herramientas</div>
        <div class="flex gap-4">
          <div>
            <span class="text-muted">Tokens/turno: </span>
            <span class="text-text">~{{ formatTokens(data.summary.schema_measurement.tool_schema_tokens) }}</span>
          </div>
          <div>
            <span class="text-muted">MCPs: </span>
            <span class="text-text">{{ data.summary.schema_measurement.mcp_servers.length }}</span>
          </div>
        </div>
        <div v-if="data.summary.schema_measurement.mcp_servers.length" class="mt-1 flex flex-wrap gap-1">
          <span
            v-for="mcp in data.summary.schema_measurement.mcp_servers"
            :key="mcp"
            class="px-1.5 py-0.5 rounded bg-surface-hover text-muted text-[10px]"
          >
            {{ mcp }}
          </span>
        </div>
      </div>
    </template>
  </div>
</template>
