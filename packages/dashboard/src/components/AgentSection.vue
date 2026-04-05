<script setup lang="ts">
import { ref } from 'vue';
import type { Agent, ToolEvent } from '../types';
import { formatDuration } from '../utils/format';
import { formatToolDisplay, getToolIcon } from '../utils/mcpParser';

const props = defineProps<{
  agentId: string;
  agent?: Agent;
  events: ToolEvent[];
}>();

const collapsed = ref(false);

const agentLabel = props.agent?.type || (props.agentId === 'main' ? 'main' : props.agentId);
const isCompleted = props.agent?.status === 'completed';
</script>

<template>
  <div
    class="border rounded px-2 py-1.5 transition-opacity"
    :class="[
      isCompleted ? 'border-border/50 opacity-50' : 'border-border',
    ]"
  >
    <!-- Agent header -->
    <button
      class="flex items-center gap-2 w-full text-left text-xs font-mono"
      @click="collapsed = !collapsed"
    >
      <span class="text-muted">{{ collapsed ? '▸' : '▾' }}</span>
      <span
        class="h-1.5 w-1.5 rounded-full"
        :class="isCompleted ? 'bg-muted' : 'bg-cyan animate-pulse'"
      />
      <span class="font-semibold text-text">{{ agentLabel }}</span>
      <span v-if="agent?.model" class="text-muted">({{ agent.model }})</span>
      <span v-if="agent?.duration" class="text-muted ml-auto">{{ formatDuration(agent.duration) }}</span>
      <span v-else-if="agent?.startedAt" class="text-muted ml-auto animate-pulse">running</span>
    </button>

    <!-- Tool calls -->
    <div v-if="!collapsed" class="mt-1 space-y-0.5">
      <div
        v-for="event in events"
        :key="event.id"
        class="flex items-center gap-1.5 text-[11px] font-mono"
      >
        <span
          :class="[
            event.eventType === 'PreToolUse' ? 'text-amber animate-spin inline-block' : '',
            event.eventType === 'PostToolUse' && event.success ? 'text-green' : '',
            event.eventType === 'PostToolUseFailure' || !event.success ? 'text-red' : '',
          ]"
        >{{ getToolIcon(event.toolName, event.eventType) }}</span>
        <span class="text-text truncate flex-1">
          {{ formatToolDisplay(event.toolName, event.toolInput) }}
        </span>
        <!-- duration hidden: unreliable -->
      </div>
    </div>
  </div>
</template>
