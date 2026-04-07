<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { useTemplateLoader } from '../composables/useTemplateLoader';
import { useGameEngine } from '../composables/useGameEngine';
import { useSessions } from '../composables/useSessions';
import { useWebSocket } from '../composables/useWebSocket';
import { usePermissions } from '../composables/usePermissions';
import { createGameLoop, type GameLoop } from '../engine/gameLoop';
import { render } from '../engine/renderer';
import { zoomAt, startDrag, updateDrag, endDrag, panTo } from '../engine/camera';
import SceneOverlay from '../components/SceneOverlay.vue';
import SceneLegend from '../components/SceneLegend.vue';
import PromptBubble from '../components/PromptBubble.vue';
import ResponsePanel from '../components/ResponsePanel.vue';
import type { ServerWSEvent } from '../types';

const props = defineProps<{
  templateName: string;
}>();

const { loading, error, progress, load } = useTemplateLoader();
const {
  gameState, tick, focusedSessionId, selectedSessionId,
  init, onSessionStart, onSessionUpdate, onSessionEnd,
  onAgentStart, onAgentStop, onToolActivity,
  update, getCharacterAtPixel, focusCharacter, selectCharacter, destroy,
} = useGameEngine();
const { sessions } = useSessions();
const { onMessage } = useWebSocket();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const canvasWidth = ref(0);
const canvasHeight = ref(0);

let gameLoop: GameLoop | null = null;
let wsCleanup: (() => void) | null = null;

// ── Focused session data ──

const focusedSession = computed(() => {
  if (!focusedSessionId.value) return null;
  return sessions.value.get(focusedSessionId.value) ?? null;
});

// ── Lifecycle ──

onMounted(async () => {
  if (!canvasRef.value) return;

  try {
    // Load template
    const { config, images } = await load(props.templateName);

    // Wait a tick for sessions to be populated from loadInitialState
    await new Promise(r => setTimeout(r, 500));

    const currentSessions = Array.from(sessions.value.values());
    init(config, images, currentSessions);

    // Create game loop
    gameLoop = createGameLoop(
      canvasRef.value,
      (dt) => update(dt),
      (ctx) => {
        if (gameState.value) render(ctx, gameState.value);
      },
    );

    gameLoop.start();

    // Wire WebSocket events to engine
    // Note: handleWSEvent is already called by App.vue — we only route to engine here
    wsCleanup = onMessage((event: ServerWSEvent) => {
      switch (event.type) {
        case 'session:start':
          onSessionStart(event.data);
          break;
        case 'session:update':
          const session = sessions.value.get(event.data.id);
          if (session) onSessionUpdate(session);
          break;
        case 'session:end':
          onSessionEnd(event.data.id);
          break;
        case 'agent:start':
          onAgentStart(event.data.sessionId, event.data.agent);
          break;
        case 'agent:stop':
          onAgentStop(event.data.sessionId, event.data.agentId);
          break;
        case 'tool:activity':
          onToolActivity(event.data);
          break;
      }
    });

    // Update canvas dimensions for overlay positioning
    updateCanvasRect();
  } catch (err) {
    console.error('Error loading template:', err);
  }
});

onUnmounted(() => {
  gameLoop?.stop();
  gameLoop = null;
  wsCleanup?.();
  wsCleanup = null;
  destroy();
});

// ── Canvas Dimensions ──

function updateCanvasRect(): void {
  if (!canvasRef.value) return;
  const rect = canvasRef.value.getBoundingClientRect();
  canvasWidth.value = rect.width;
  canvasHeight.value = rect.height;
}

// ResizeObserver for overlay positioning
let resizeObs: ResizeObserver | null = null;
onMounted(() => {
  if (canvasRef.value) {
    resizeObs = new ResizeObserver(updateCanvasRect);
    resizeObs.observe(canvasRef.value);
  }
});
onUnmounted(() => {
  resizeObs?.disconnect();
});

// ── Canvas Events ──

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  if (!gameState.value) return;
  const rect = canvasRef.value!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  zoomAt(gameState.value.camera, x, y, -e.deltaY);
}

function onMouseDown(e: MouseEvent): void {
  if (!gameState.value) return;
  if (e.button !== 0) return; // left click only

  const rect = canvasRef.value!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // Check hit on character first
  const char = getCharacterAtPixel(x, y);
  if (char) {
    selectCharacter(char.sessionId);
    focusCharacter(char.sessionId);
    return;
  }

  // Start drag
  startDrag(gameState.value.camera, e.clientX, e.clientY);
}

function onMouseMove(e: MouseEvent): void {
  if (!gameState.value) return;
  updateDrag(gameState.value.camera, e.clientX, e.clientY);
}

function onMouseUp(): void {
  if (!gameState.value) return;
  endDrag(gameState.value.camera);
}

function onDblClick(e: MouseEvent): void {
  if (!gameState.value) return;
  const rect = canvasRef.value!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const char = getCharacterAtPixel(x, y);
  if (char) {
    // Center + zoom on character
    gameState.value.camera.zoom = 2.0;
    panTo(gameState.value.camera, char.x, char.y, canvasWidth.value, canvasHeight.value);
  }
}

function onCanvasClick(e: MouseEvent): void {
  if (!gameState.value) return;
  const rect = canvasRef.value!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const char = getCharacterAtPixel(x, y);
  if (!char) {
    // Clicked background — deselect
    selectCharacter(null);
    focusedSessionId.value = null;
  }
}

function onFocusSession(sessionId: string): void {
  focusCharacter(sessionId);

  if (!gameState.value) return;
  const char = gameState.value.characters.get(sessionId);
  if (char) {
    gameState.value.camera.zoom = 1.5;
    panTo(gameState.value.camera, char.x, char.y, canvasWidth.value, canvasHeight.value);
  }
}
</script>

<template>
  <div class="relative flex-1 overflow-hidden">
    <!-- Canvas -->
    <canvas
      ref="canvasRef"
      class="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
      @wheel.prevent="onWheel"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @mouseleave="onMouseUp"
      @click="onCanvasClick"
      @dblclick="onDblClick"
    />

    <!-- Scene Overlay (activity + permission bubbles) -->
    <SceneOverlay
      v-if="gameState"
      :characters="gameState.characters"
      :camera="gameState.camera"
      :canvas-width="canvasWidth"
      :canvas-height="canvasHeight"
    />

    <!-- Prompt Bubble (top-right) -->
    <PromptBubble
      v-if="focusedSession?.topic"
      :topic="focusedSession.topic"
    />

    <!-- Response Panel (bottom) -->
    <ResponsePanel
      v-if="focusedSession?.lastMessage"
      :last-message="focusedSession.lastMessage"
    />

    <!-- Legend (top-left, all session info) -->
    <SceneLegend
      :sessions="sessions"
      :game-state="gameState"
      :tick="tick"
    />


    <!-- Loading overlay -->
    <div
      v-if="loading"
      class="absolute inset-0 flex items-center justify-center bg-bg/80 z-30"
    >
      <div class="text-center">
        <div class="text-sm font-mono text-muted">Cargando template...</div>
        <div class="w-48 h-1 bg-border mt-2 rounded-full overflow-hidden">
          <div
            class="h-full bg-cyan transition-all duration-200"
            :style="{ width: progress + '%' }"
          />
        </div>
      </div>
    </div>

    <!-- Error overlay -->
    <div
      v-if="error"
      class="absolute inset-0 flex items-center justify-center bg-bg/80 z-30"
    >
      <div class="text-center max-w-md">
        <div class="text-sm font-mono text-red mb-2">Error cargando template</div>
        <div class="text-xs font-mono text-muted">{{ error }}</div>
      </div>
    </div>
  </div>
</template>
