<script setup lang="ts">
import { ref } from 'vue';
import { useTheme } from '../composables/useTheme';
import { useWebSocket } from '../composables/useWebSocket';
import { useSessions } from '../composables/useSessions';
import { useSearch } from '../composables/useSearch';
import { usePermissions } from '../composables/usePermissions';
import { useViewMode } from '../composables/useViewMode';
import { useAutoApprove } from '../composables/useAutoApprove';

const emit = defineEmits<{ openSettings: [] }>();

const { isDark, toggle: toggleTheme } = useTheme();
const { connected, reconnecting } = useWebSocket();
const { totals } = useSessions();
const { searchQuery, clearSearch } = useSearch();
const { count: permissionCount } = usePermissions();
const { current: viewMode, availableTemplates, setView } = useViewMode();
const { autoApprove, toggle: toggleAutoApprove } = useAutoApprove();

const searchOpen = ref(false);

function toggleSearch(): void {
  searchOpen.value = !searchOpen.value;
  if (!searchOpen.value) clearSearch();
}
</script>

<template>
  <header class="h-12 flex items-center gap-2 px-3 bg-surface border-b border-border flex-shrink-0">
    <!-- Search: icon on mobile, full input on desktop -->
    <div class="relative" :class="searchOpen ? 'flex-1 max-w-md' : ''">
      <!-- Mobile: search icon button -->
      <button
        v-if="!searchOpen"
        @click="toggleSearch"
        class="sm:hidden text-muted hover:text-text p-1"
        title="Buscar"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </button>

      <!-- Desktop: always show input. Mobile: show only when open -->
      <div :class="searchOpen ? 'block' : 'hidden sm:block'" class="relative flex-1 max-w-md">
        <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Buscar..."
          class="w-full h-8 pl-8 pr-8 text-xs font-mono bg-bg border border-border rounded-md text-text placeholder:text-muted focus:border-cyan focus:outline-none"
        />
        <button
          @click="toggleSearch"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Stats (hide on small) -->
    <div class="hidden md:flex items-center gap-3 text-[11px] font-mono text-muted">
      <span>{{ totals.activeSessions }} activas</span>
      <span v-if="totals.idleSessions > 0">{{ totals.idleSessions }} idle</span>
    </div>

    <!-- View Switcher (always visible) -->
    <div v-if="!searchOpen" class="flex items-center gap-1 border border-border rounded-md p-0.5">
      <button
        @click="setView('panel')"
        class="text-[10px] font-mono px-2 py-1 rounded transition-colors"
        :class="viewMode === 'panel' ? 'bg-cyan/20 text-cyan' : 'text-muted hover:text-text'"
      >
        Panel
      </button>
      <button
        v-for="template in availableTemplates"
        :key="template.name"
        @click="setView(template.name.toLowerCase().replace(/\s+/g, '-'))"
        class="text-[10px] font-mono px-2 py-1 rounded transition-colors"
        :class="viewMode === template.name.toLowerCase().replace(/\s+/g, '-') ? 'bg-cyan/20 text-cyan' : 'text-muted hover:text-text'"
      >
        {{ template.name }}
      </button>
    </div>

    <!-- Spacer -->
    <div class="flex-1" />

    <!-- Permissions badge -->
    <button
      v-if="permissionCount > 0"
      class="relative text-amber hover:text-amber/80 transition-colors shrink-0"
      title="Permisos pendientes"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
      <span class="absolute -top-1 -right-1 h-4 w-4 flex items-center justify-center text-[9px] font-bold bg-amber text-bg rounded-full">
        {{ permissionCount }}
      </span>
    </button>

    <!-- Auto-approve toggle -->
    <button
      @click="toggleAutoApprove"
      class="text-[10px] font-mono font-semibold px-2.5 py-1 rounded-md border transition-colors shrink-0 flex items-center gap-1.5"
      :class="autoApprove
        ? 'bg-green/20 text-green border-green/40 hover:bg-green/30 animate-pulse'
        : 'bg-surface text-muted border-border hover:text-text'"
      :title="autoApprove ? 'Auto-aprobar activo — click para desactivar' : 'Click para auto-aprobar todo'"
    >
      <span class="w-2 h-2 rounded-full" :class="autoApprove ? 'bg-green' : 'bg-muted/40'" />
      {{ autoApprove ? 'Auto-approve ON' : 'Auto-approve' }}
    </button>

    <!-- Settings -->
    <button
      @click="emit('openSettings')"
      class="text-muted hover:text-text transition-colors p-1 shrink-0"
      title="Configuracion"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    </button>

    <!-- Theme toggle (hide on very small) -->
    <button
      @click="toggleTheme"
      class="hidden sm:block text-muted hover:text-text transition-colors p-1 shrink-0"
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
    <span class="flex items-center shrink-0">
      <span
        class="h-2 w-2 rounded-full"
        :class="connected ? 'bg-green' : reconnecting ? 'bg-amber animate-pulse' : 'bg-red'"
      />
    </span>
  </header>
</template>
