<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ToolEvent, SessionSummary } from '../types';
import { useSessions } from '../composables/useSessions';
import { formatTimestamp, formatDuration, formatTokens } from '../utils/format';
import { formatToolDisplay, getToolIcon } from '../utils/mcpParser';

const props = defineProps<{
  sessionId: string;
  eventCount: number;
}>();

const { fetchSessionEvents, fetchSessionSummary } = useSessions();

// Tab state
const activeTab = ref<'history' | 'summary'>('history');

// History state
const events = ref<ToolEvent[]>([]);
const total = ref(0);
const page = ref(1);
const loadingHistory = ref(false);
const selectedEvent = ref<ToolEvent | null>(null);

// Summary state
const summary = ref<SessionSummary | null>(null);
const loadingSummary = ref(false);

// Load history on mount
loadHistory();

async function loadHistory(): Promise<void> {
  loadingHistory.value = true;
  const result = await fetchSessionEvents(props.sessionId, page.value);
  loadingHistory.value = false;
  if (result) {
    events.value.push(...result.events);
    total.value = result.total;
  }
}

async function loadMore(): Promise<void> {
  page.value++;
  await loadHistory();
}

function selectEvent(event: ToolEvent): void {
  selectedEvent.value = selectedEvent.value?.id === event.id ? null : event;
}

// Load summary when tab switches
watch(activeTab, async (tab) => {
  if (tab === 'summary' && !summary.value) {
    loadingSummary.value = true;
    summary.value = await fetchSessionSummary(props.sessionId);
    loadingSummary.value = false;
  }
});
</script>

<template>
  <div class="border-t border-border/50 pt-2">
    <!-- Tabs -->
    <div class="flex gap-1 mb-2">
      <button
        @click="activeTab = 'history'"
        class="text-xs font-mono px-3 py-1 rounded-md transition-colors"
        :class="activeTab === 'history'
          ? 'bg-cyan/15 text-cyan font-semibold'
          : 'text-muted hover:text-text hover:bg-surface-hover'"
      >
        Historial ({{ props.eventCount }})
      </button>
      <button
        @click="activeTab = 'summary'"
        class="text-xs font-mono px-3 py-1 rounded-md transition-colors"
        :class="activeTab === 'summary'
          ? 'bg-cyan/15 text-cyan font-semibold'
          : 'text-muted hover:text-text hover:bg-surface-hover'"
      >
        Resumen
      </button>
    </div>

    <!-- Content area -->
    <div
      class="grid gap-2 max-h-64 overflow-hidden"
      :class="selectedEvent && activeTab === 'history' ? 'grid-cols-2' : 'grid-cols-1'"
    >
      <!-- Left: History list or Summary -->
      <div class="overflow-y-auto max-h-64 pr-1">
        <!-- HISTORY TAB -->
        <template v-if="activeTab === 'history'">
          <div v-if="loadingHistory && events.length === 0" class="text-xs text-muted p-2">Cargando...</div>

          <div class="space-y-0.5">
            <div
              v-for="event in events"
              :key="event.id"
              class="flex items-center gap-2 text-[11px] font-mono py-1 px-2 rounded transition-colors"
              :class="[
                event.toolName
                  ? (selectedEvent?.id === event.id ? 'bg-cyan/10 text-cyan cursor-pointer' : 'hover:bg-surface-hover cursor-pointer')
                  : 'opacity-60',
              ]"
              @click="event.toolName ? selectEvent(event) : null"
            >
              <span class="text-muted whitespace-nowrap">{{ formatTimestamp(event.createdAt) }}</span>
              <!-- Lifecycle events (no tool) -->
              <template v-if="!event.toolName">
                <span class="text-muted">{{ event.eventType }}</span>
              </template>
              <!-- Tool events -->
              <template v-else>
                <span :class="event.success ? 'text-green' : 'text-red'">
                  {{ getToolIcon(event.toolName, event.eventType) }}
                </span>
                <span v-if="event.agentType" class="text-purple text-[10px]">[{{ event.agentType }}]</span>
                <span class="text-text truncate flex-1">
                  {{ formatToolDisplay(event.toolName, event.toolInput) }}
                </span>
                <span v-if="event.durationMs" class="text-muted whitespace-nowrap">{{ event.durationMs }}ms</span>
              </template>
            </div>
          </div>

          <!-- Load more -->
          <button
            v-if="events.length < total"
            @click="loadMore"
            class="text-xs text-cyan hover:underline mt-2 ml-2"
            :disabled="loadingHistory"
          >
            {{ loadingHistory ? 'Cargando...' : `Cargar mas (${total - events.length} restantes)` }}
          </button>
        </template>

        <!-- SUMMARY TAB -->
        <template v-else>
          <div v-if="loadingSummary" class="text-xs text-muted p-2">Cargando...</div>

          <div v-else-if="summary" class="space-y-3 text-xs font-mono p-1">
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
              <div v-for="file in summary.filesTouched.slice(0, 10)" :key="file.path" class="flex justify-between py-0.5">
                <span class="text-text truncate">{{ file.path }}</span>
                <span class="text-muted">x{{ file.editCount }}</span>
              </div>
            </div>

            <!-- Tool breakdown -->
            <div v-if="summary.toolBreakdown.length > 0">
              <div class="text-muted mb-1">Herramientas:</div>
              <div class="flex flex-wrap gap-2">
                <span v-for="tool in summary.toolBreakdown" :key="tool.tool" class="px-1.5 py-0.5 rounded bg-surface-hover text-text">
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
              <div class="flex flex-wrap gap-2">
                <span v-for="mcp in summary.mcpsUsed" :key="mcp.name" class="px-1.5 py-0.5 rounded bg-surface-hover text-text">
                  {{ mcp.name }} <span class="text-muted">x{{ mcp.callCount }}</span>
                </span>
              </div>
            </div>

            <!-- Agents -->
            <div v-if="summary.agentsSpawned.length > 0">
              <div class="text-muted mb-1">Agentes:</div>
              <div class="flex flex-wrap gap-2">
                <span v-for="agent in summary.agentsSpawned" :key="agent.type" class="px-1.5 py-0.5 rounded bg-surface-hover text-text">
                  {{ agent.type }} <span class="text-muted">x{{ agent.count }} ({{ formatDuration(agent.totalDuration) }})</span>
                </span>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- Right: Event detail (only when event selected in history tab) -->
      <div
        v-if="selectedEvent && activeTab === 'history'"
        class="overflow-y-auto max-h-64 p-2 rounded bg-bg border border-border"
      >
        <div class="text-[10px] font-mono">
          <div class="flex items-center gap-2 mb-2 text-xs">
            <span :class="selectedEvent.success ? 'text-green' : 'text-red'">
              {{ getToolIcon(selectedEvent.toolName, selectedEvent.eventType) }}
            </span>
            <span class="text-text font-semibold">{{ selectedEvent.toolName }}</span>
            <span v-if="selectedEvent.durationMs" class="text-muted">{{ selectedEvent.durationMs }}ms</span>
          </div>

          <div class="text-muted mb-1">Input:</div>
          <pre class="text-text whitespace-pre-wrap mb-3 text-[10px]">{{ JSON.stringify(selectedEvent.toolInput, null, 2) }}</pre>

          <template v-if="selectedEvent.toolResponse">
            <div class="text-muted mb-1">Response:</div>
            <pre class="text-text whitespace-pre-wrap text-[10px]">{{ JSON.stringify(selectedEvent.toolResponse, null, 2) }}</pre>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
