<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Session } from '../types';

const props = defineProps<{
  sessions: Map<string, Session>;
}>();

const emit = defineEmits<{
  focusSession: [sessionId: string];
}>();

const collapsed = ref(false);

const sessionList = computed(() => Array.from(props.sessions.values()));

function statusColor(status: string): string {
  switch (status) {
    case 'active': return 'border-cyan text-cyan';
    case 'idle': return 'border-muted text-muted';
    case 'waiting_permission': return 'border-amber text-amber';
    case 'waiting_input': return 'border-purple text-purple';
    case 'error': return 'border-red text-red';
    case 'stopped': return 'border-muted/30 text-muted/30';
    default: return 'border-muted text-muted';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'active': return 'Luchando';
    case 'idle': return 'Descansando';
    case 'waiting_permission': return 'Esperando permiso';
    case 'waiting_input': return 'Esperando input';
    case 'error': return 'Error';
    case 'stopped': return 'Detenido';
    default: return status;
  }
}
</script>

<template>
  <div class="absolute left-2 top-14 z-20 flex flex-col gap-1">
    <!-- Collapse toggle -->
    <button
      @click="collapsed = !collapsed"
      class="w-6 h-6 rounded-full bg-surface/80 border border-border flex items-center justify-center text-muted hover:text-text transition-colors text-[10px]"
      :title="collapsed ? 'Expandir' : 'Colapsar'"
    >
      {{ collapsed ? '>' : '<' }}
    </button>

    <!-- Session list -->
    <template v-if="!collapsed">
      <button
        v-for="session in sessionList"
        :key="session.id"
        @click="emit('focusSession', session.id)"
        class="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface/80 backdrop-blur-sm border transition-all hover:bg-surface"
        :class="statusColor(session.status)"
      >
        <!-- Status dot -->
        <span class="w-2 h-2 rounded-full shrink-0"
          :class="session.status === 'active' ? 'bg-cyan' : session.status === 'idle' ? 'bg-muted' : session.status === 'waiting_permission' ? 'bg-amber' : 'bg-muted'"
        />
        <!-- Project name + status -->
        <div class="text-left min-w-0">
          <div class="text-[10px] font-mono font-semibold truncate max-w-[120px]">
            {{ session.projectName }}
          </div>
          <div class="text-[8px] font-mono opacity-70">
            {{ statusLabel(session.status) }}
          </div>
        </div>
      </button>
    </template>
  </div>
</template>
