<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { useTemplateLoader } from '../composables/useTemplateLoader';
import { useGameEngine } from '../composables/useGameEngine';
import { useSessions } from '../composables/useSessions';
import { useWebSocket } from '../composables/useWebSocket';
import { usePermissions } from '../composables/usePermissions';
import { createGameLoop, type GameLoop } from '../engine/gameLoop';
import { render } from '../engine/renderer';
import { zoomAt, startDrag, updateDrag, endDrag, panTo, screenToWorld } from '../engine/camera';
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

    // Wait for sessions to load (max 3s, check every 100ms)
    let attempts = 0;
    while (sessions.value.size === 0 && attempts < 30) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }

    const currentSessions = Array.from(sessions.value.values());
    init(config, images, currentSessions);

    // Center camera on first render frame (canvas has real dimensions by then)
    let cameraCentered = false;

    // Create game loop
    gameLoop = createGameLoop(
      canvasRef.value,
      (dt) => update(dt),
      (ctx) => {
        if (!gameState.value) return;
        // Center camera once — wait until canvas has real dimensions
        if (!cameraCentered) {
          updateCanvasRect();
          if (canvasWidth.value > 0 && canvasHeight.value > 0) {
            cameraCentered = true;
            const ts = gameState.value.template.tileSize;
            const mapW = gameState.value.activeMap.mapSize[0] * ts;
            const mapH = gameState.value.activeMap.mapSize[1] * ts;
            // Fit map in canvas with small padding
            const fitZoom = Math.min(
              canvasWidth.value / (mapW + ts * 2),
              canvasHeight.value / (mapH + ts * 2),
            );
            gameState.value.camera.zoom = Math.max(gameState.value.camera.minZoom, Math.min(fitZoom, 1));
            panTo(gameState.value.camera, mapW / 2, mapH / 2, canvasWidth.value, canvasHeight.value);
          }
        }
        render(ctx, gameState.value);
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

    // ResizeObserver for overlay positioning
    updateCanvasRect();
    resizeObs = new ResizeObserver(updateCanvasRect);
    resizeObs.observe(canvasRef.value);
  } catch (err) {
    console.error('Error loading template:', err);
  }
});

onUnmounted(() => {
  gameLoop?.stop();
  gameLoop = null;
  wsCleanup?.();
  wsCleanup = null;
  resizeObs?.disconnect();
  resizeObs = null;
  destroy();
});

// ── Canvas Dimensions ──

function updateCanvasRect(): void {
  if (!canvasRef.value) return;
  const rect = canvasRef.value.getBoundingClientRect();
  canvasWidth.value = rect.width;
  canvasHeight.value = rect.height;
}

// ResizeObserver — created in main onMounted, cleaned up in onUnmounted
let resizeObs: ResizeObserver | null = null;

// ── Dismiss Session ──

function onDismissSession(sessionId: string): void {
  // Hide characters from map rendering (reversible via legend "Mostrar")
  if (!gameState.value) return;
  for (const char of gameState.value.characters.values()) {
    if (char.sessionId === sessionId) {
      char.hidden = true;
    }
  }
}

function onRestoreSession(sessionId: string): void {
  // Restore hidden characters to map
  if (!gameState.value) return;
  for (const char of gameState.value.characters.values()) {
    if (char.sessionId === sessionId) {
      char.hidden = false;
    }
  }
}

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
  // Track mouse in world coords for hover effects (labels)
  const rect = canvasRef.value?.getBoundingClientRect();
  if (rect) {
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, gameState.value.camera);
    gameState.value.mouseWorldX = world.x;
    gameState.value.mouseWorldY = world.y;
  }
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

// ── Touch Events (mobile) ──

let lastTouchDist = 0;
let touchStartX = 0;
let touchStartY = 0;
let isTouchDragging = false;

function onTouchStart(e: TouchEvent): void {
  if (!gameState.value) return;
  e.preventDefault();

  if (e.touches.length === 1) {
    // Single finger — pan
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    startDrag(gameState.value.camera, touchStartX, touchStartY);
    isTouchDragging = true;
  } else if (e.touches.length === 2) {
    // Two fingers — pinch zoom
    isTouchDragging = false;
    endDrag(gameState.value.camera);
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    lastTouchDist = Math.sqrt(dx * dx + dy * dy);
  }
}

function onTouchMove(e: TouchEvent): void {
  if (!gameState.value) return;
  e.preventDefault();

  if (e.touches.length === 1 && isTouchDragging) {
    // Pan
    updateDrag(gameState.value.camera, e.touches[0].clientX, e.touches[0].clientY);
  } else if (e.touches.length === 2) {
    // Pinch zoom
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (lastTouchDist > 0) {
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const rect = canvasRef.value!.getBoundingClientRect();
      const delta = (dist - lastTouchDist) * 2;
      zoomAt(gameState.value.camera, centerX - rect.left, centerY - rect.top, delta);
    }

    lastTouchDist = dist;
  }
}

function onTouchEnd(e: TouchEvent): void {
  if (!gameState.value) return;

  if (e.touches.length === 0) {
    if (isTouchDragging) {
      // Check if it was a tap (no significant movement)
      const moved = e.changedTouches[0] ?
        Math.abs(e.changedTouches[0].clientX - touchStartX) + Math.abs(e.changedTouches[0].clientY - touchStartY) : 999;

      if (moved < 10) {
        // Tap — check character hit
        const rect = canvasRef.value!.getBoundingClientRect();
        const x = (e.changedTouches[0]?.clientX || touchStartX) - rect.left;
        const y = (e.changedTouches[0]?.clientY || touchStartY) - rect.top;
        const char = getCharacterAtPixel(x, y);
        if (char) {
          selectCharacter(char.sessionId);
          focusCharacter(char.sessionId);
        } else {
          selectCharacter(null);
          focusedSessionId.value = null;
        }
      }

      endDrag(gameState.value.camera);
      isTouchDragging = false;
    }
    lastTouchDist = 0;
  } else if (e.touches.length === 1) {
    // Went from 2 to 1 finger — start panning
    lastTouchDist = 0;
    startDrag(gameState.value.camera, e.touches[0].clientX, e.touches[0].clientY);
    isTouchDragging = true;
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
      style="touch-action: none;"
      @wheel.prevent="onWheel"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @mouseleave="onMouseUp"
      @click="onCanvasClick"
      @dblclick="onDblClick"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
    />

    <!-- Scene Overlay (activity + permission bubbles) -->
    <SceneOverlay
      v-if="gameState"
      :characters="gameState.characters"
      :sessions="sessions"
      :camera="gameState.camera"
      :canvas-width="canvasWidth"
      :canvas-height="canvasHeight"
      :tick="tick"
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
      :template-name="templateName"
      @dismiss-session="onDismissSession"
      @restore-session="onRestoreSession"
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
