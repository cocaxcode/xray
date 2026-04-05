<script setup lang="ts">
import { computed } from 'vue';
import { useSessions } from '../composables/useSessions';
import { useSearch } from '../composables/useSearch';
import { useConfig } from '../composables/useConfig';
import { usePermissions } from '../composables/usePermissions';

const emit = defineEmits<{ openSettings: [] }>();

const { projectGroups, totals } = useSessions();
const { selectedProject, selectProject, statusFilter, toggleStatus } = useSearch();
const { getProjectAlias, getProjectColor } = useConfig();
const { count: permissionCount } = usePermissions();

const projects = computed(() =>
  projectGroups.value.map(g => ({
    name: getProjectAlias(g.path) || g.name,
    path: g.path,
    count: g.sessions.length,
    color: getProjectColor(g.path) || 'var(--color-cyan)',
    hasPermissions: g.pendingPermissions > 0,
  }))
);

const statuses = [
  { key: 'active' as const, label: 'Activas', color: 'bg-green' },
  { key: 'idle' as const, label: 'Idle', color: 'bg-muted' },
  { key: 'waiting_permission' as const, label: 'Permisos', color: 'bg-amber' },
  { key: 'waiting_input' as const, label: 'Input', color: 'bg-purple' },
  { key: 'error' as const, label: 'Error', color: 'bg-red' },
  { key: 'stopped' as const, label: 'Cerradas', color: 'bg-muted/50' },
];
</script>

<template>
  <aside class="w-56 h-full flex flex-col bg-surface border-r border-border overflow-y-auto">
    <!-- Logo -->
    <div class="px-4 py-3 border-b border-border">
      <span class="text-lg font-bold font-heading text-cyan">xray</span>
      <span class="text-[10px] font-mono text-muted ml-2">v0.1</span>
    </div>

    <!-- Projects -->
    <div class="flex-1 px-2 py-3">
      <div class="text-[10px] font-mono text-muted uppercase tracking-wider px-2 mb-2">Proyectos</div>

      <!-- All projects -->
      <button
        @click="selectProject(null)"
        class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono transition-colors"
        :class="selectedProject === null ? 'bg-cyan/10 text-cyan' : 'text-text hover:bg-surface-hover'"
      >
        <span class="h-2 w-2 rounded-full bg-cyan" />
        <span class="flex-1 text-left">Todos</span>
        <span class="text-muted">{{ totals.activeSessions + totals.idleSessions }}</span>
      </button>

      <!-- Individual projects -->
      <button
        v-for="project in projects"
        :key="project.path"
        @click="selectProject(project.path)"
        class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono transition-colors mt-0.5"
        :class="selectedProject === project.path ? 'bg-cyan/10 text-cyan' : 'text-text hover:bg-surface-hover'"
      >
        <span class="h-2 w-2 rounded-full" :style="{ backgroundColor: project.color }" />
        <span class="flex-1 text-left truncate">{{ project.name }}</span>
        <span v-if="project.hasPermissions" class="h-1.5 w-1.5 rounded-full bg-amber animate-pulse" />
        <span class="text-muted">{{ project.count }}</span>
      </button>
    </div>

    <!-- Status filters -->
    <div class="px-2 py-3 border-t border-border">
      <div class="text-[10px] font-mono text-muted uppercase tracking-wider px-2 mb-2">Filtros</div>
      <label
        v-for="status in statuses"
        :key="status.key"
        class="flex items-center gap-2 px-2 py-1 text-xs font-mono cursor-pointer hover:bg-surface-hover rounded"
      >
        <input
          type="checkbox"
          :checked="statusFilter.has(status.key)"
          @change="toggleStatus(status.key)"
          class="h-3 w-3 rounded accent-cyan"
        />
        <span class="h-1.5 w-1.5 rounded-full" :class="status.color" />
        <span class="text-text">{{ status.label }}</span>
      </label>
    </div>

    <!-- Settings -->
    <div class="px-2 py-3 border-t border-border">
      <button
        @click="emit('openSettings')"
        class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono text-muted hover:text-text hover:bg-surface-hover transition-colors"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Configuracion
      </button>
    </div>
  </aside>
</template>
