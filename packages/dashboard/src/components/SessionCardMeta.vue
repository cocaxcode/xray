<script setup lang="ts">
import type { Session } from '../types';
import { formatDuration } from '../utils/format';

const props = defineProps<{ session: Session }>();
</script>

<template>
  <div class="flex flex-wrap gap-2 text-xs">
    <!-- MCPs -->
    <template v-if="props.session.mcps.length > 0">
      <span
        v-for="mcp in props.session.mcps"
        :key="mcp.name"
        class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-hover font-mono"
      >
        <span
          class="h-1.5 w-1.5 rounded-full"
          :class="mcp.status === 'connected' ? 'bg-green' : 'bg-red'"
        />
        {{ mcp.name }}
      </span>
    </template>

    <!-- Skills -->
    <template v-if="props.session.skills.length > 0">
      <span
        v-for="skill in props.session.skills"
        :key="skill"
        class="px-1.5 py-0.5 rounded bg-purple/10 text-purple font-mono"
      >
        {{ skill }}
      </span>
    </template>

    <!-- Agents -->
    <template v-if="props.session.agents.length > 0">
      <span
        v-for="agent in props.session.agents.filter(a => a.status === 'running')"
        :key="agent.id"
        class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan/10 text-cyan font-mono"
      >
        <span class="h-1.5 w-1.5 rounded-full bg-cyan animate-pulse" />
        {{ agent.type }}
        <span v-if="agent.duration" class="text-muted">{{ formatDuration(agent.duration) }}</span>
      </span>
    </template>
  </div>
</template>
