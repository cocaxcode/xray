<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Session } from '../types';
import { useSessions } from '../composables/useSessions';
import { usePermissions } from '../composables/usePermissions';
import { truncate } from '../utils/format';

const messageExpanded = ref(false);
import SessionCardHeader from './SessionCardHeader.vue';
import SessionCardMeta from './SessionCardMeta.vue';
import SessionCardActivity from './SessionCardActivity.vue';
import SessionCardPermission from './SessionCardPermission.vue';
import SessionDetailPanel from './SessionDetailPanel.vue';

const props = defineProps<{ session: Session }>();

const { getSessionActivity } = useSessions();
const { getBySession } = usePermissions();

const activity = computed(() => getSessionActivity(props.session.id));
const pendingPermission = computed(() => permissionHidden.value ? undefined : getBySession(props.session.id));
const permissionHidden = ref(false);

function onPermissionResolved(): void {
  permissionHidden.value = true;
  // Reset after a bit so new permissions can show
  setTimeout(() => { permissionHidden.value = false; }, 2000);
}

const borderClass = computed(() => {
  switch (props.session.status) {
    case 'active': return 'border-cyan/60 animate-pulse-border';
    case 'idle': return 'border-border';
    case 'waiting_permission': return 'border-amber/60 animate-blink-border';
    case 'waiting_input': return 'border-purple/60';
    case 'error': return 'border-red/60';
    case 'stopped': return 'border-border/30 opacity-50';
    default: return 'border-border';
  }
});
</script>

<template>
  <div
    class="rounded-xl border-2 bg-surface p-4 space-y-3 transition-all duration-300"
    :class="borderClass"
  >
    <!-- ID -->
    <div class="text-[10px] font-mono text-muted">
      {{ props.session.id.slice(0, 12) }}
    </div>

    <!-- Header: model + context + status -->
    <SessionCardHeader :session="props.session" />

    <!-- Meta: MCPs + Skills + Agents -->
    <SessionCardMeta
      v-if="props.session.mcps.length > 0 || props.session.skills.length > 0 || props.session.agents.length > 0"
      :session="props.session"
    />

    <!-- Permission (if pending) -->
    <SessionCardPermission
      v-if="pendingPermission"
      :permission="pendingPermission"
      @resolved="onPermissionResolved"
    />

    <!-- Activity (tool calls) -->
    <SessionCardActivity
      v-if="activity.size > 0"
      :activity="activity"
      :agents="props.session.agents"
    />

    <!-- Last message (when idle) — clickable to expand -->
    <div
      v-if="props.session.status === 'idle' && props.session.lastMessage"
      class="text-xs text-muted italic cursor-pointer hover:text-text transition-colors"
      @click="messageExpanded = !messageExpanded"
    >
      <template v-if="messageExpanded">
        "{{ props.session.lastMessage }}"
      </template>
      <template v-else>
        "{{ truncate(props.session.lastMessage, 100) }}"
        <span v-if="props.session.lastMessage.length > 100" class="text-cyan ml-1 not-italic">...</span>
      </template>
    </div>

    <!-- Waiting input message -->
    <div
      v-if="props.session.status === 'waiting_input' && props.session.lastMessage"
      class="text-xs text-purple cursor-pointer"
      @click="messageExpanded = !messageExpanded"
    >
      <template v-if="messageExpanded">
        {{ props.session.lastMessage }}
      </template>
      <template v-else>
        {{ truncate(props.session.lastMessage, 100) }}
        <span v-if="props.session.lastMessage.length > 100" class="text-cyan ml-1">...</span>
      </template>
      <div class="text-muted mt-0.5">Cambia a esta terminal para responder</div>
    </div>

    <!-- History + Summary (tabs with split detail panel) -->
    <SessionDetailPanel
      :session-id="props.session.id"
      :event-count="props.session.eventCount"
    />
  </div>
</template>
