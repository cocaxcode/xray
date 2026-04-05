<script setup lang="ts">
import type { SessionStatus } from '../types';

const props = defineProps<{
  status: SessionStatus;
  showLabel?: boolean;
}>();

const statusConfig: Record<SessionStatus, { color: string; label: string; animate?: string }> = {
  active: { color: 'bg-green', label: 'Activo', animate: 'animate-pulse' },
  idle: { color: 'bg-muted', label: 'Idle' },
  waiting_permission: { color: 'bg-amber', label: 'Permiso', animate: 'animate-pulse' },
  waiting_input: { color: 'bg-purple', label: 'Input', animate: 'animate-pulse' },
  error: { color: 'bg-red', label: 'Error' },
  stopped: { color: 'bg-muted/50', label: 'Detenido' },
};
</script>

<template>
  <span class="inline-flex items-center gap-1.5">
    <span
      class="inline-block h-2 w-2 rounded-full"
      :class="[statusConfig[props.status].color, statusConfig[props.status].animate]"
    />
    <span v-if="showLabel" class="text-xs font-mono text-muted">
      {{ statusConfig[props.status].label }}
    </span>
  </span>
</template>
