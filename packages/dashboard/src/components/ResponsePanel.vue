<script setup lang="ts">
import { ref, computed } from 'vue';
import { stripMarkdown } from '../utils/format';

const props = defineProps<{
  lastMessage: string;
}>();

const expanded = ref(false);
const strippedMessage = computed(() => stripMarkdown(props.lastMessage));
const isLong = computed(() => strippedMessage.value.length > 300);
</script>

<template>
  <div
    class="absolute top-16 right-4 z-20
           w-72 bg-surface/95 backdrop-blur-sm border border-border
           rounded-lg shadow-lg transition-all duration-300 overflow-hidden"
    :class="expanded ? 'max-h-[60vh]' : 'max-h-[200px]'"
  >
    <!-- Header -->
    <div class="px-3 py-2 border-b border-border/50 flex items-center gap-1.5">
      <span class="text-[10px]">&#x1F916;</span>
      <span class="text-[10px] font-mono font-semibold text-cyan">Respuesta</span>
    </div>

    <!-- Content -->
    <div class="px-3 py-2 overflow-y-auto" :class="expanded ? 'max-h-[calc(60vh-40px)]' : 'max-h-[156px]'">
      <p
        class="text-[11px] font-mono text-text leading-relaxed whitespace-pre-line break-words"
        :class="!expanded && 'line-clamp-6'"
      >
        {{ strippedMessage }}
      </p>
    </div>

    <!-- Expand toggle -->
    <button
      v-if="isLong"
      @click.stop="expanded = !expanded"
      class="w-full py-1 text-[9px] font-mono text-muted hover:text-cyan transition-colors border-t border-border/50 text-center"
    >
      {{ expanded ? 'menos ▲' : 'mas ▼' }}
    </button>
  </div>
</template>
