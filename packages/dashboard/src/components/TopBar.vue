<script setup lang="ts">
import { useTheme } from '../composables/useTheme';
import { useWebSocket } from '../composables/useWebSocket';
import { useSessions } from '../composables/useSessions';
import { useSearch } from '../composables/useSearch';
import { usePermissions } from '../composables/usePermissions';

const emit = defineEmits<{ toggleSidebar: []; openSettings: [] }>();

const { isDark, toggle: toggleTheme } = useTheme();
const { connected, reconnecting } = useWebSocket();
const { totals } = useSessions();
const { searchQuery, clearSearch } = useSearch();
const { count: permissionCount } = usePermissions();
</script>

<template>
  <header class="h-12 flex items-center gap-3 px-4 bg-surface border-b border-border">
    <!-- Hamburger (mobile) -->
    <button @click="emit('toggleSidebar')" class="lg:hidden text-muted hover:text-text">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>

    <!-- Search -->
    <div class="flex-1 max-w-md relative">
      <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Buscar proyecto, sesion, modelo..."
        class="w-full h-8 pl-8 pr-8 text-xs font-mono bg-bg border border-border rounded-md text-text placeholder:text-muted focus:border-cyan focus:outline-none"
      />
      <button
        v-if="searchQuery"
        @click="clearSearch"
        class="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- Stats -->
    <div class="hidden md:flex items-center gap-3 text-[11px] font-mono text-muted">
      <span>{{ totals.activeSessions }} activas</span>
      <span v-if="totals.idleSessions > 0">{{ totals.idleSessions }} idle</span>
    </div>

    <!-- Permissions badge -->
    <button
      v-if="permissionCount > 0"
      class="relative text-amber hover:text-amber/80 transition-colors"
      title="Permisos pendientes"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
      <span class="absolute -top-1 -right-1 h-4 w-4 flex items-center justify-center text-[9px] font-bold bg-amber text-bg rounded-full">
        {{ permissionCount }}
      </span>
    </button>

    <!-- Theme toggle -->
    <button
      @click="toggleTheme"
      class="text-muted hover:text-text transition-colors p-1"
      :title="isDark ? 'Modo claro' : 'Modo oscuro'"
    >
      <svg v-if="isDark" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
      <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
      </svg>
    </button>

    <!-- Connection status -->
    <span class="flex items-center gap-1">
      <span
        class="h-2 w-2 rounded-full"
        :class="connected ? 'bg-green' : reconnecting ? 'bg-amber animate-pulse' : 'bg-red'"
      />
    </span>
  </header>
</template>
