<script setup lang="ts">
import type { PendingPermission } from '../types';
import { formatToolDisplay } from '../utils/mcpParser';
import { usePermissions } from '../composables/usePermissions';

const props = defineProps<{ permission: PendingPermission }>();
const emit = defineEmits<{ resolved: [] }>();
const { resolve } = usePermissions();

const displayText = formatToolDisplay(props.permission.toolName, props.permission.toolInput);

async function handleResolve(decision: 'approve' | 'deny' | 'allowAlways'): Promise<void> {
  emit('resolved');
  await resolve(props.permission.id, decision);
}
</script>

<template>
  <div class="rounded-lg border-2 border-amber/50 bg-amber/5 p-3 space-y-2">
    <div class="flex items-start gap-2">
      <span class="text-amber text-lg">⚠</span>
      <div class="flex-1 min-w-0">
        <div class="text-xs font-mono font-semibold text-amber">
          {{ props.permission.toolName }}
        </div>
        <div class="text-xs font-mono text-text mt-0.5 truncate">
          {{ displayText }}
        </div>
      </div>
    </div>
    <div class="flex gap-2" @click.stop>
      <button
        @click="handleResolve('allowAlways')"
        class="flex-1 text-xs font-semibold py-1.5 px-3 rounded-md bg-green/20 text-green hover:bg-green/30 transition-colors"
      >
        Aprobar siempre
      </button>
      <button
        @click="handleResolve('approve')"
        class="flex-1 text-xs font-semibold py-1.5 px-3 rounded-md bg-cyan/20 text-cyan hover:bg-cyan/30 transition-colors"
      >
        Una vez
      </button>
      <button
        @click="handleResolve('deny')"
        class="flex-1 text-xs font-semibold py-1.5 px-3 rounded-md bg-red/20 text-red hover:bg-red/30 transition-colors"
      >
        Denegar
      </button>
    </div>
  </div>
</template>
