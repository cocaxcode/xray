<script setup lang="ts">
import { ref } from 'vue';
import type { ToolEvent, SessionEventsResponse } from '../types';
import { useSessions } from '../composables/useSessions';
import { formatTimestamp, formatDuration } from '../utils/format';
import { formatToolDisplay, getToolIcon } from '../utils/mcpParser';

const props = defineProps<{ sessionId: string; eventCount: number }>();

const expanded = ref(false);
const events = ref<ToolEvent[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const selectedEvent = ref<ToolEvent | null>(null);

const { fetchSessionEvents } = useSessions();

async function toggleExpand(): Promise<void> {
  expanded.value = !expanded.value;
  if (expanded.value && events.value.length === 0) {
    await loadEvents();
  }
}

async function loadEvents(): Promise<void> {
  loading.value = true;
  const result = await fetchSessionEvents(props.sessionId, page.value);
  loading.value = false;
  if (result) {
    events.value.push(...result.events);
    total.value = result.total;
  }
}

async function loadMore(): Promise<void> {
  page.value++;
  await loadEvents();
}
</script>

<template>
  <div>
    <button
      @click="toggleExpand"
      class="text-xs font-mono text-muted hover:text-text transition-colors"
    >
      {{ expanded ? '▾' : '▸' }} Historial ({{ props.eventCount }})
    </button>

    <div v-if="expanded" class="mt-2 space-y-1 max-h-80 overflow-y-auto">
      <div v-if="loading && events.length === 0" class="text-xs text-muted">Cargando...</div>

      <div
        v-for="event in events"
        :key="event.id"
        class="flex items-center gap-2 text-[11px] font-mono py-0.5 px-1 rounded hover:bg-surface-hover cursor-pointer"
        @click="selectedEvent = selectedEvent?.id === event.id ? null : event"
      >
        <span class="text-muted whitespace-nowrap">{{ formatTimestamp(event.createdAt) }}</span>
        <span :class="event.success ? 'text-green' : 'text-red'">
          {{ getToolIcon(event.toolName, event.eventType) }}
        </span>
        <span v-if="event.agentType" class="text-purple text-[10px]">[{{ event.agentType }}]</span>
        <span class="text-text truncate flex-1">
          {{ formatToolDisplay(event.toolName, event.toolInput) }}
        </span>
        <span v-if="event.durationMs" class="text-muted">{{ event.durationMs }}ms</span>
      </div>

      <!-- Event detail -->
      <div
        v-if="selectedEvent"
        class="mt-2 p-2 rounded bg-bg border border-border text-[10px] font-mono overflow-x-auto"
      >
        <div class="text-muted mb-1">Input:</div>
        <pre class="text-text whitespace-pre-wrap">{{ JSON.stringify(selectedEvent.toolInput, null, 2) }}</pre>
        <template v-if="selectedEvent.toolResponse">
          <div class="text-muted mt-2 mb-1">Response:</div>
          <pre class="text-text whitespace-pre-wrap">{{ JSON.stringify(selectedEvent.toolResponse, null, 2) }}</pre>
        </template>
      </div>

      <!-- Load more -->
      <button
        v-if="events.length < total"
        @click="loadMore"
        class="text-xs text-cyan hover:underline mt-1"
        :disabled="loading"
      >
        {{ loading ? 'Cargando...' : 'Cargar mas' }}
      </button>
    </div>
  </div>
</template>
