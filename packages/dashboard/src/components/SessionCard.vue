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
  // 1. Extraer bloques de codigo para no procesarlos como markdown
  const codeBlocks: string[] = [];
  let processed = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').trimEnd();
    const langBadge = lang ? `<span class="absolute top-1 right-1.5 text-[8px] text-muted/50 uppercase">${lang}</span>` : '';
    codeBlocks.push(
      `<div class="relative my-1 rounded bg-bg border border-border/50 overflow-x-auto">${langBadge}<pre class="p-2 text-[10px] font-mono text-cyan/90 whitespace-pre leading-relaxed">${escaped}</pre></div>`
    );
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  // 2. Escape HTML del resto
  processed = processed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 3. Detectar tablas markdown
  processed = processed.replace(/((?:^\|.+\|$\n?){2,})/gm, (tableBlock) => {
    const rows = tableBlock.trim().split('\n').filter(r => r.trim());
    // Filtrar la fila separadora (|---|---|)
    const dataRows = rows.filter(r => !/^\|[\s\-:|]+\|$/.test(r));
    if (dataRows.length === 0) return tableBlock;

    const parseRow = (row: string) =>
      row.split('|').slice(1, -1).map(c => c.trim());

    const headerCells = parseRow(dataRows[0]);
    const isHeader = rows.length > dataRows.length; // hay fila separadora = tiene header

    let html = '<div class="my-1 overflow-x-auto rounded border border-border/50"><table class="w-full text-[10px] font-mono">';

    if (isHeader) {
      html += '<thead><tr>';
      headerCells.forEach(c => { html += `<th class="px-2 py-1 text-left text-text font-semibold bg-border/30 border-b border-border/50">${c}</th>`; });
      html += '</tr></thead><tbody>';
      dataRows.slice(1).forEach(row => {
        html += '<tr>';
        parseRow(row).forEach(c => { html += `<td class="px-2 py-0.5 text-muted border-b border-border/30">${c}</td>`; });
        html += '</tr>';
      });
    } else {
      html += '<tbody>';
      dataRows.forEach(row => {
        html += '<tr>';
        parseRow(row).forEach(c => { html += `<td class="px-2 py-0.5 text-muted border-b border-border/30">${c}</td>`; });
        html += '</tr>';
      });
    }

    html += '</tbody></table></div>';
    return html;
  });

  // 4. Inline markdown
  processed = processed
    .replace(/\*\*(.*?)\*\*/g, '<strong class="text-text font-semibold">$1</strong>')
    .replace(/`(.*?)`/g, '<code class="text-cyan/80 bg-border/30 px-0.5 rounded text-[10px]">$1</code>')
    .replace(/^[-*]\s+/gm, '  &bull; ')
    .replace(/^#{1,6}\s+(.*)/gm, '<strong class="text-text">$1</strong>');

  // 5. Restaurar bloques de codigo
  codeBlocks.forEach((block, i) => {
    processed = processed.replace(`__CODE_BLOCK_${i}__`, block);
  });

  return processed;
}

const { getBySession } = usePermissions();

const deltaInput = computed(() => props.session.inputTokens - (props.session.inputTokensAtStop || 0));
const deltaOutput = computed(() => props.session.outputTokens - (props.session.outputTokensAtStop || 0));

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
    data-session-card
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

      <!-- Tokens (delta since last stop) -->
      <span
        v-if="deltaInput > 0 || deltaOutput > 0"
        class="text-[9px] font-mono text-muted"
      >
        ↑{{ formatTokens(deltaInput) }} ↓{{ formatTokens(deltaOutput) }}
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

    <!-- Waiting input (AI asked a question) -->
    <div
      v-if="!pendingPermission && session.status === 'waiting_input' && session.lastMessage"
      class="mx-3 mb-2 p-2 rounded-md border border-purple/40 bg-purple/10"
    >
      <div class="text-[9px] font-mono text-purple font-semibold mb-1 animate-pulse">
        Esperando respuesta
      </div>
      <div class="text-[9px] font-mono text-text line-clamp-3">
        {{ session.lastMessage }}
      </div>
    </div>

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
