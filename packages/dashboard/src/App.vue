<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuth } from './composables/useAuth';
import { useWebSocket } from './composables/useWebSocket';
import { useSessions } from './composables/useSessions';
import TopBar from './components/TopBar.vue';
import AuthPrompt from './components/AuthPrompt.vue';
import EmptyState from './components/EmptyState.vue';
import ProjectGroup from './components/ProjectGroup.vue';

const { handleQrAuth, token, checkAuth } = useAuth();
const { connect, onMessage } = useWebSocket();
const { projectGroups, handleWSEvent, loadInitialState } = useSessions();

const authMode = ref<'loading' | 'local' | 'authenticated' | 'needs_auth'>('loading');

// Request browser notification permission
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

onMounted(async () => {
  // Step 1: Check for QR auth token in URL
  handleQrAuth();

  // Step 2: Determine auth mode
  const mode = await checkAuth();
  authMode.value = mode;

  if (mode !== 'needs_auth') {
    init();
  }
});

function init(): void {
  // Connect WebSocket
  connect(token.value);

  // Listen for events
  onMessage(handleWSEvent);

  // Load initial state from REST (includes one-time permission sync)
  loadInitialState();
}

function onAuthenticated(): void {
  authMode.value = 'authenticated';
  init();
}
</script>

<template>
  <!-- Loading -->
  <div v-if="authMode === 'loading'" class="flex items-center justify-center h-screen">
    <span class="text-muted text-sm font-mono">Conectando...</span>
  </div>

  <!-- Auth required (PIN input) -->
  <AuthPrompt v-else-if="authMode === 'needs_auth'" @authenticated="onAuthenticated" />

  <!-- Main dashboard -->
  <template v-else>
    <TopBar />

    <main class="pt-14 px-4 pb-8 max-w-5xl mx-auto space-y-6">
      <!-- Empty state -->
      <EmptyState v-if="projectGroups.length === 0" />

      <!-- Project groups -->
      <ProjectGroup
        v-for="group in projectGroups"
        :key="group.path"
        :group="group"
      />
    </main>
  </template>
</template>
