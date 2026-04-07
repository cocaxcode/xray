<script setup lang="ts">
import SessionDetailPanel from './SessionDetailPanel.vue';
import { useSessions } from '../composables/useSessions';
import { computed } from 'vue';

const props = defineProps<{
  sessionId: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { sessions } = useSessions();

const session = computed(() => sessions.value.get(props.sessionId));
const eventCount = computed(() => session.value?.eventCount ?? 0);
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center"
    @click.self="emit('close')"
  >
    <!-- Backdrop -->
    <div class="absolute inset-0 bg-black/50" @click="emit('close')" />

    <!-- Modal -->
    <div class="relative z-10 w-full max-w-2xl max-h-[80vh] bg-surface border border-border rounded-xl shadow-2xl overflow-hidden">
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-2 border-b border-border">
        <div class="flex items-center gap-2 text-xs font-mono">
          <span class="text-cyan font-semibold">{{ session?.projectName }}</span>
          <span class="text-muted">/</span>
          <span class="text-text">{{ sessionId.slice(0, 10) }}</span>
        </div>
        <button
          @click="emit('close')"
          class="text-muted hover:text-text p-1 transition-colors"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Content -->
      <div class="overflow-y-auto max-h-[calc(80vh-48px)]">
        <SessionDetailPanel
          :session-id="sessionId"
          :event-count="eventCount"
        />
      </div>
    </div>
  </div>
</template>
