<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuth } from './composables/useAuth';
import { useWebSocket } from './composables/useWebSocket';
import { useSessions } from './composables/useSessions';
import { useConfig } from './composables/useConfig';
import { useViewMode } from './composables/useViewMode';
import { useAutoApprove } from './composables/useAutoApprove';
import TopBar from './components/TopBar.vue';
import AuthPrompt from './components/AuthPrompt.vue';
import SettingsDrawer from './components/SettingsDrawer.vue';
import PanelView from './views/PanelView.vue';
import SceneView from './views/SceneView.vue';
import OptimizationView from './views/OptimizationView.vue';

const { handleQrAuth, token, checkAuth } = useAuth();
const { connect, onMessage } = useWebSocket();
const { handleWSEvent, loadInitialState } = useSessions();
const { loadConfig } = useConfig();
const { current: viewMode, loadAvailableTemplates } = useViewMode();
const { fetchState: fetchAutoApprove, setFromWS } = useAutoApprove();

const authMode = ref<'loading' | 'local' | 'authenticated' | 'needs_auth'>('loading');
const settingsOpen = ref(false);

// Request browser notification permission
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

onMounted(async () => {
  handleQrAuth();
  const mode = await checkAuth();
  authMode.value = mode;
  if (mode !== 'needs_auth') init();
});

function init(): void {
  connect(token.value);
  onMessage(handleWSEvent);
  onMessage((event) => {
    if (event.type === 'config:auto-approve') {
      setFromWS(event.data.enabled);
    }
  });
  loadInitialState(false);
  loadConfig();
  loadAvailableTemplates();
  fetchAutoApprove();
}

function onAuthenticated(): void {
  authMode.value = 'authenticated';
  init();
}
</script>

<template>
  <!-- Loading -->
  <div v-if="authMode === 'loading'" class="flex items-center justify-center h-screen bg-bg">
    <span class="text-muted text-sm font-mono">Conectando...</span>
  </div>

  <!-- Auth -->
  <AuthPrompt v-else-if="authMode === 'needs_auth'" @authenticated="onAuthenticated" />

  <!-- Dashboard -->
  <div v-else class="flex flex-col h-screen bg-bg overflow-hidden">
    <TopBar
      @open-settings="settingsOpen = true"
    />

    <!-- View Content -->
    <PanelView
      v-if="viewMode === 'panel'"
      @open-settings="settingsOpen = true"
    />
    <OptimizationView
      v-else-if="viewMode === 'optimization'"
    />
    <SceneView
      v-else
      :template-name="viewMode"
    />

    <!-- Settings drawer -->
    <SettingsDrawer
      v-if="settingsOpen"
      @close="settingsOpen = false"
    />
  </div>
</template>
