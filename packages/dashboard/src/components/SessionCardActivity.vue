<script setup lang="ts">
import { computed } from 'vue';
import type { ToolEvent, Agent } from '../types';
import AgentSection from './AgentSection.vue';
import { formatToolDisplay, getToolIcon } from '../utils/mcpParser';

const props = defineProps<{
  activity: Map<string, ToolEvent[]>;
  agents: Agent[];
}>();

const hasMultipleAgents = computed(() => props.activity.size > 1);

const agentEntries = computed(() => {
  const entries = Array.from(props.activity.entries());
  // Sort: main first, then by agent id
  entries.sort(([a], [b]) => {
    if (a === 'main') return -1;
    if (b === 'main') return 1;
    return a.localeCompare(b);
  });
  return entries;
});

function findAgent(agentId: string): Agent | undefined {
  return props.agents.find(a => a.id === agentId);
}
</script>

<template>
  <!-- Multiple agents: grouped view -->
  <div v-if="hasMultipleAgents" class="space-y-1.5">
    <AgentSection
      v-for="[agentId, events] in agentEntries"
      :key="agentId"
      :agent-id="agentId"
      :agent="findAgent(agentId)"
      :events="events"
    />
  </div>

  <!-- Single agent: flat list -->
  <div v-else class="space-y-0.5">
    <div
      v-for="event in (agentEntries[0]?.[1] || [])"
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
      <span v-if="event.durationMs" class="text-muted whitespace-nowrap">
        {{ event.durationMs }}ms
      </span>
    </div>
  </div>
</template>
