<script setup lang="ts">
import { ref, computed } from 'vue';
import { useSearch } from '../composables/useSearch';
import { useSessions } from '../composables/useSessions';
import Sidebar from '../components/Sidebar.vue';
import EmptyState from '../components/EmptyState.vue';
import SessionCard from '../components/SessionCard.vue';
import SessionDetailPanel from '../components/SessionDetailPanel.vue';

const emit = defineEmits<{ openSettings: [] }>();

const { filteredGroups } = useSearch();

const sidebarOpen = ref(typeof window !== 'undefined' && window.innerWidth >= 1024);
const selectedSessionId = ref<string | null>(null);

const selectedSession = computed(() => {
  if (!selectedSessionId.value) return null;
  for (const group of filteredGroups.value) {
    const s = group.sessions.find(s => s.id === selectedSessionId.value);
    if (s) return s;
  }
  return null;
});

function selectSession(id: string): void {
  selectedSessionId.value = selectedSessionId.value === id ? null : id;
}

function dismissSession(id: string): void {
  if (selectedSessionId.value === id) selectedSessionId.value = null;
}
</script>

<template>
  <div class="flex flex-1 overflow-hidden">
    <!-- Sidebar -->
    <Sidebar
      v-if="sidebarOpen"
      class="hidden lg:flex flex-shrink-0"
      @open-settings="emit('openSettings')"
    />

    <!-- Mobile sidebar overlay -->
    <div
      v-if="sidebarOpen"
      class="lg:hidden fixed inset-0 z-40"
      @click="sidebarOpen = false"
    >
      <div class="absolute inset-0 bg-black/50" />
      <Sidebar
        class="relative z-50 h-full"
        @open-settings="emit('openSettings'); sidebarOpen = false"
      />
    </div>

    <!-- Main area -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Content -->
      <div class="flex-1 flex flex-col overflow-hidden">
        <!-- Session grid -->
        <div class="flex-1 overflow-y-auto p-4">
          <EmptyState v-if="filteredGroups.length === 0" />

          <template v-else>
            <div
              v-for="group in filteredGroups"
              :key="group.path"
              class="mb-6"
            >
              <!-- Group header -->
              <div class="flex items-center gap-2 mb-3">
                <h2 class="text-sm font-heading font-semibold text-text">{{ group.name }}</h2>
                <span class="text-[10px] font-mono text-muted">{{ group.sessions.length }} sesiones</span>
                <span
                  v-if="group.pendingPermissions > 0"
                  class="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded-full bg-amber/20 text-amber"
                >
                  {{ group.pendingPermissions }} permisos
                </span>
              </div>

              <!-- Cards grid -->
              <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                <SessionCard
                  v-for="session in group.sessions"
                  :key="session.id"
                  :session="session"
                  :selected="selectedSessionId === session.id"
                  @select="selectSession"
                  @dismiss="dismissSession"
                />
              </div>
            </div>
          </template>
        </div>

        <!-- Detail panel (selected session) -->
        <div
          v-if="selectedSession"
          class="border-t border-border bg-surface flex-shrink-0"
        >
          <div class="flex items-center justify-between px-4 py-2 border-b border-border/50">
            <div class="flex items-center gap-2 text-xs font-mono">
              <span class="text-cyan font-semibold">{{ selectedSession.projectName }}</span>
              <span class="text-muted">/</span>
              <span class="text-text">{{ selectedSession.id.slice(0, 10) }}</span>
            </div>
            <button
              @click="selectedSessionId = null"
              class="text-muted hover:text-text p-1"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <SessionDetailPanel
            :key="selectedSession.id"
            :session-id="selectedSession.id"
            :event-count="selectedSession.eventCount"
          />
        </div>
      </div>
    </div>
  </div>
</template>
