<script setup lang="ts">
import { ref } from 'vue';
import type { ProjectGroup } from '../types';
import SessionCard from './SessionCard.vue';

const props = defineProps<{ group: ProjectGroup }>();

const collapsed = ref(false);
</script>

<template>
  <section class="space-y-3">
    <!-- Group header -->
    <button
      class="flex items-center gap-2 w-full text-left group"
      @click="collapsed = !collapsed"
    >
      <span class="text-muted text-sm">{{ collapsed ? '▸' : '▾' }}</span>
      <h2 class="text-sm font-heading font-semibold text-text group-hover:text-cyan transition-colors">
        {{ props.group.name }}
      </h2>
      <span class="text-xs font-mono text-muted">
        {{ props.group.sessions.length }} {{ props.group.sessions.length === 1 ? 'sesion' : 'sesiones' }}
      </span>
      <span
        v-if="props.group.pendingPermissions > 0"
        class="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-full bg-amber/20 text-amber"
      >
        {{ props.group.pendingPermissions }} permisos
      </span>
    </button>

    <!-- Session cards -->
    <div v-if="!collapsed" class="space-y-3 pl-4">
      <SessionCard
        v-for="session in props.group.sessions"
        :key="session.id"
        :session="session"
      />
    </div>
  </section>
</template>
