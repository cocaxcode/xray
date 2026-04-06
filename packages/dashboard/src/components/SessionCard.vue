<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Session } from '../types';
import { useSessions } from '../composables/useSessions';
import { usePermissions } from '../composables/usePermissions';
import { useAuth } from '../composables/useAuth';

const { getSessionActivity, removeSession } = useSessions();
import { formatModel, getModelColor, formatTokens, timeAgo } from '../utils/format';
import SessionCardMeta from './SessionCardMeta.vue';
import SessionCardActivity from './SessionCardActivity.vue';
import SessionCardPermission from './SessionCardPermission.vue';
import StatusIndicator from './StatusIndicator.vue';

const props = defineProps<{
  session: Session;
  selected?: boolean;
  compact?: boolean;
}>();

const emit = defineEmits<{
  select: [id: string];
  dismiss: [id: string];
}>();

const messageExpanded = ref(false);

function formatMessage(md: string): string {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') // escape HTML
    .replace(/\*\*(.*?)\*\*/g, '<strong class="text-text font-semibold">$1</strong>')
    .replace(/`(.*?)`/g, '<code class="text-cyan/80 bg-border/30 px-0.5 rounded text-[10px]">$1</code>')
    .replace(/^[-*]\s+/gm, '  &bull; ')  // bullet lists
    .replace(/^#{1,6}\s+(.*)/gm, '<strong class="text-text">$1</strong>');
}

const { getBySession } = usePermissions();

const activity = computed(() => getSessionActivity(props.session.id));
const pendingPermission = computed(() => getBySession(props.session.id));

const borderClass = computed(() => {
  if (props.selected) return 'border-cyan ring-1 ring-cyan/30';
  switch (props.session.status) {
    case 'active': return 'border-cyan/40';
    case 'idle': return 'border-border';
    case 'waiting_permission': return 'border-amber/60 animate-blink-border';
    case 'waiting_input': return 'border-purple/60';
    case 'error': return 'border-red/60';
    case 'stopped': return 'border-border/30 opacity-50';
    default: return 'border-border';
  }
});

async function handleDismiss(e: Event): Promise<void> {
  e.stopPropagation();
  const { getAuthHeaders } = useAuth();
  try {
    if (props.session.status === 'stopped') {
      // Already stopped → delete permanently
      await fetch(`/api/sessions/${props.session.id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
    } else {
      // Active/idle → mark as stopped
      await fetch(`/api/sessions/${props.session.id}/dismiss`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
    }
  } catch { /* ignore */ }
  if (props.session.status === 'stopped') {
    removeSession(props.session.id);
  }
  emit('dismiss', props.session.id);
}
</script>

<template>
  <div
    class="rounded-xl border bg-surface p-3 space-y-2 transition-all duration-200 cursor-pointer hover:bg-surface-hover group"
    :class="borderClass"
    @click="emit('select', props.session.id)"
  >
    <!-- Header row: model + context + status + dismiss -->
    <div class="flex items-center gap-2">
      <!-- Model badge -->
      <span
        class="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-full"
        :style="{ backgroundColor: getModelColor(session.model) + '20', color: getModelColor(session.model) }"
      >
        {{ formatModel(session.model) }}
      </span>

      <!-- Context bar -->
      <div class="flex-1 h-1 rounded-full bg-border overflow-hidden">
        <div
          class="h-full rounded-full transition-all duration-500"
          :class="session.contextPercent > 80 ? 'bg-red' : session.contextPercent > 50 ? 'bg-amber' : 'bg-cyan'"
          :style="{ width: Math.min(session.contextPercent, 100) + '%' }"
        />
      </div>
      <span class="text-[9px] font-mono text-muted">~{{ Math.round(session.contextPercent) }}%</span>

      <!-- Tokens -->
      <span
        v-if="session.inputTokens > 0"
        class="text-[9px] font-mono text-muted"
      >
        ↑{{ formatTokens(session.inputTokens) }} ↓{{ formatTokens(session.outputTokens) }}
      </span>

      <!-- Status -->
      <StatusIndicator :status="session.status" />

      <!-- Dismiss button -->
      <button
        @click="handleDismiss($event)"
        class="opacity-0 group-hover:opacity-100 text-muted hover:text-red transition-all p-0.5"
        :title="session.status === 'stopped' ? 'Eliminar sesion' : 'Cerrar sesion'"
      >
        <!-- Trash icon for stopped, X for active -->
        <svg v-if="session.status === 'stopped'" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- Topic -->
    <div v-if="session.topic" class="text-[11px] font-mono text-text truncate">
      {{ session.topic }}
    </div>

    <!-- Meta: MCPs + Skills (compact) -->
    <SessionCardMeta
      v-if="!compact && (session.mcps.length > 0 || session.skills.length > 0 || session.agents.length > 0)"
      :session="session"
    />

    <!-- Permission (if pending) -->
    <SessionCardPermission
      v-if="pendingPermission"
      :permission="pendingPermission"
    />

    <!-- Activity (last tool calls, compact shows fewer) -->
    <SessionCardActivity
      v-if="!compact && activity.size > 0"
      :activity="activity"
      :agents="session.agents"
    />

    <!-- Last message -->
    <div
      v-if="session.lastMessage"
      class="text-[11px] text-muted cursor-pointer overflow-hidden"
      :class="messageExpanded ? 'max-h-48 overflow-y-auto' : 'max-h-[4.5em]'"
      @click.stop="messageExpanded = !messageExpanded"
    >
      <div class="whitespace-pre-line break-words" v-html="formatMessage(session.lastMessage)" />
    </div>

    <!-- Session ID + time ago -->
    <div class="flex items-center justify-between text-[9px] font-mono text-muted/60">
      <span>{{ session.id.slice(0, 10) }}</span>
      <span>{{ timeAgo(session.lastEventAt) }}</span>
    </div>
  </div>
</template>
