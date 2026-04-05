<script setup lang="ts">
import { ref } from 'vue';
import type { SessionSummary } from '../types';
import { useSessions } from '../composables/useSessions';
import { formatDuration, formatTokens } from '../utils/format';

const props = defineProps<{ sessionId: string }>();

const expanded = ref(false);
const summary = ref<SessionSummary | null>(null);
const loading = ref(false);

const { fetchSessionSummary } = useSessions();

async function toggleExpand(): Promise<void> {
  expanded.value = !expanded.value;
  if (expanded.value && !summary.value) {
    loading.value = true;
    summary.value = await fetchSessionSummary(props.sessionId);
    loading.value = false;
  }
}
</script>

<template>
  <div>
    <button
      @click="toggleExpand"
      class="text-xs font-mono text-muted hover:text-text transition-colors"
    >
      {{ expanded ? '▾' : '▸' }} Resumen
    </button>

    <div v-if="expanded" class="mt-2">
      <div v-if="loading" class="text-xs text-muted">Cargando...</div>

      <div v-else-if="summary" class="space-y-3 text-xs font-mono">
        <!-- Duration + Tokens -->
        <div class="flex gap-4">
          <div>
            <span class="text-muted">Duracion: </span>
            <span class="text-text">{{ formatDuration(summary.duration) }}</span>
          </div>
          <div v-if="summary.totalInputTokens > 0">
            <span class="text-muted">Tokens: </span>
            <span class="text-text">↑{{ formatTokens(summary.totalInputTokens) }} ↓{{ formatTokens(summary.totalOutputTokens) }}</span>
          </div>
        </div>

        <!-- Files touched -->
        <div v-if="summary.filesTouched.length > 0">
          <div class="text-muted mb-1">Archivos tocados:</div>
          <div v-for="file in summary.filesTouched.slice(0, 10)" :key="file.path" class="flex justify-between">
            <span class="text-text truncate">{{ file.path }}</span>
            <span class="text-muted">x{{ file.editCount }}</span>
          </div>
        </div>

        <!-- Tool breakdown -->
        <div v-if="summary.toolBreakdown.length > 0">
          <div class="text-muted mb-1">Herramientas:</div>
          <div class="flex flex-wrap gap-2">
            <span v-for="tool in summary.toolBreakdown" :key="tool.tool" class="text-text">
              {{ tool.tool }} <span class="text-muted">x{{ tool.count }}</span>
            </span>
          </div>
        </div>

        <!-- Errors -->
        <div v-if="summary.errorCount > 0" class="text-red">
          Errores: {{ summary.errorCount }}
        </div>

        <!-- MCPs -->
        <div v-if="summary.mcpsUsed.length > 0">
          <div class="text-muted mb-1">MCPs:</div>
          <span v-for="mcp in summary.mcpsUsed" :key="mcp.name" class="mr-3 text-text">
            {{ mcp.name }} <span class="text-muted">x{{ mcp.callCount }}</span>
          </span>
        </div>

        <!-- Agents -->
        <div v-if="summary.agentsSpawned.length > 0">
          <div class="text-muted mb-1">Agentes:</div>
          <span v-for="agent in summary.agentsSpawned" :key="agent.type" class="mr-3 text-text">
            {{ agent.type }} <span class="text-muted">x{{ agent.count }} ({{ formatDuration(agent.totalDuration) }})</span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
