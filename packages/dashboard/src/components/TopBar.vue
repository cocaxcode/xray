<script setup lang="ts">
import { useTheme } from '../composables/useTheme';
import { useWebSocket } from '../composables/useWebSocket';
import { useSessions } from '../composables/useSessions';

const { isDark, toggle } = useTheme();
const { connected, reconnecting } = useWebSocket();
const { totals } = useSessions();
</script>

<template>
  <header class="fixed top-0 left-0 right-0 z-50 h-12 flex items-center justify-between px-4 bg-surface border-b border-border backdrop-blur">
    <!-- Left: Logo -->
    <div class="flex items-center gap-2">
      <span class="text-lg font-bold font-heading text-cyan">xray</span>
    </div>

    <!-- Center: Counters -->
    <div class="flex items-center gap-3 text-xs font-mono text-muted">
      <span>{{ totals.projects }} proyectos</span>
      <span class="text-border">|</span>
      <span>{{ totals.activeSessions }} activas</span>
      <span class="text-border">|</span>
      <span>{{ totals.idleSessions }} idle</span>
      <span v-if="totals.pendingPermissions > 0" class="text-border">|</span>
      <span v-if="totals.pendingPermissions > 0" class="text-amber font-semibold">
        {{ totals.pendingPermissions }} permisos
      </span>
    </div>

    <!-- Right: Theme toggle + Connection status -->
    <div class="flex items-center gap-3">
      <button
        @click="toggle"
        class="text-muted hover:text-text transition-colors p-1"
        :title="isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'"
      >
        <!-- Sun -->
        <svg v-if="isDark" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
        <!-- Moon -->
        <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      </button>

      <span class="flex items-center gap-1 text-xs font-mono">
        <span
          class="h-2 w-2 rounded-full"
          :class="connected ? 'bg-green' : reconnecting ? 'bg-amber animate-pulse' : 'bg-red'"
        />
        <span class="text-muted">
          {{ connected ? 'Conectado' : reconnecting ? 'Reconectando...' : 'Desconectado' }}
        </span>
      </span>
    </div>
  </header>
</template>
