<script setup lang="ts">
import type { Session } from '../types';
import StatusIndicator from './StatusIndicator.vue';
import { formatModel, getModelColor, formatTokens } from '../utils/format';

const props = defineProps<{ session: Session }>();
</script>

<template>
  <div class="flex items-center justify-between gap-3">
    <!-- Model badge -->
    <span
      class="text-xs font-mono font-semibold px-2 py-0.5 rounded-full"
      :style="{ backgroundColor: getModelColor(props.session.model) + '20', color: getModelColor(props.session.model) }"
    >
      {{ formatModel(props.session.model) }}
    </span>

    <!-- Context bar -->
    <div class="flex-1 flex items-center gap-2">
      <div class="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
        <div
          class="h-full rounded-full transition-all duration-500"
          :class="props.session.contextPercent > 80 ? 'bg-red' : props.session.contextPercent > 50 ? 'bg-amber' : 'bg-cyan'"
          :style="{ width: Math.min(props.session.contextPercent, 100) + '%' }"
        />
      </div>
      <span class="text-[10px] font-mono text-muted whitespace-nowrap">
        ~{{ Math.round(props.session.contextPercent) }}%
      </span>
    </div>

    <!-- Tokens -->
    <span
      v-if="props.session.inputTokens > 0 || props.session.outputTokens > 0"
      class="text-[10px] font-mono text-muted whitespace-nowrap"
    >
      ↑{{ formatTokens(props.session.inputTokens) }} ↓{{ formatTokens(props.session.outputTokens) }}
    </span>

    <!-- Status -->
    <StatusIndicator :status="props.session.status" show-label />
  </div>
</template>
