<script setup lang="ts">
import { computed } from 'vue';
import type { Character, Camera } from '../engine/types';
import type { Session } from '../types';
import { worldToScreen } from '../engine/camera';
import { usePermissions } from '../composables/usePermissions';

const props = defineProps<{
  characters: Map<string, Character>;
  sessions: Map<string, Session>;
  camera: Camera;
  canvasWidth: number;
  canvasHeight: number;
  tick: number;
}>();

const { getBySession, resolve } = usePermissions();

// Characters whose session is waiting for user input (not permission, just idle/waiting)
const waitingCharacters = computed(() => {
  void props.tick;
  const result: Character[] = [];
  for (const char of props.characters.values()) {
    if (char.isCompanion) continue;
    const session = props.sessions.get(char.sessionId);
    if (session?.status === 'waiting_input' && !getBySession(char.sessionId)) {
      result.push(char);
    }
  }
  return result;
});

function getScreenPos(char: Character) {
  void props.tick; // reactive dependency for template re-evaluation
  return worldToScreen(char.x, char.y, props.camera);
}

function getPermission(char: Character) {
  return getBySession(char.sessionId);
}

function formatPermissionInput(toolName: string, toolInput: Record<string, unknown>): string {
  // Show the most relevant field based on tool type
  if (toolName === 'Bash' && toolInput.command) return String(toolInput.command);
  if (toolName === 'Edit' && toolInput.file_path) return `Edit: ${toolInput.file_path}`;
  if (toolName === 'Write' && toolInput.file_path) return `Write: ${toolInput.file_path}`;
  if (toolName === 'Read' && toolInput.file_path) return `Read: ${toolInput.file_path}`;
  if (toolInput.url) return String(toolInput.url);
  if (toolInput.command) return String(toolInput.command);
  if (toolInput.file_path) return String(toolInput.file_path);
  // For MCP tools, show the action/query
  if (toolInput.action) return `${toolInput.action}`;
  if (toolInput.query) return String(toolInput.query).slice(0, 80);
  // Fallback: first string value
  for (const val of Object.values(toolInput)) {
    if (typeof val === 'string' && val.length > 0) return val.slice(0, 80);
  }
  return toolName;
}

async function handleResolve(permissionId: number, decision: 'approve' | 'deny') {
  resolve(permissionId, decision);
}
</script>

<template>
  <!-- Permission bubbles (only for main characters, not companions) -->
  <div
    v-for="char in Array.from(characters.values()).filter(c => !c.isCompanion && getPermission(c))"
    :key="'perm-' + char.id"
    class="absolute z-20"
    :style="{
      left: getScreenPos(char).x + 'px',
      top: (getScreenPos(char).y - 80) + 'px',
      transform: 'translateX(-50%)',
    }"
  >
    <div class="bg-surface border-2 border-amber rounded-lg px-3 py-2 max-w-[240px] pointer-events-auto shadow-lg">
      <div class="text-[10px] font-mono text-amber font-semibold truncate">
        {{ getPermission(char)!.toolName }}
      </div>
      <div class="text-[9px] font-mono text-text mt-0.5 break-all line-clamp-2">
        {{ formatPermissionInput(getPermission(char)!.toolName, getPermission(char)!.toolInput) }}
      </div>
      <div class="flex gap-2 mt-2">
        <button
          @click="handleResolve(getPermission(char)!.id, 'approve')"
          class="flex-1 text-[10px] font-mono font-semibold px-2 py-1.5 rounded-md bg-green/20 text-green hover:bg-green/40 border border-green/30 transition-colors"
        >
          Aprobar
        </button>
        <button
          @click="handleResolve(getPermission(char)!.id, 'deny')"
          class="flex-1 text-[10px] font-mono font-semibold px-2 py-1.5 rounded-md bg-red/20 text-red hover:bg-red/40 border border-red/30 transition-colors"
        >
          Denegar
        </button>
      </div>
    </div>
  </div>

  <!-- Waiting input bubbles — AI is idle, waiting for user to respond -->
  <div
    v-for="char in waitingCharacters"
    :key="'wait-' + char.id"
    class="absolute z-15 pointer-events-none"
    :style="{
      left: getScreenPos(char).x + 'px',
      top: (getScreenPos(char).y - 70) + 'px',
      transform: 'translateX(-50%)',
    }"
  >
    <div class="bg-surface/90 border border-purple rounded-lg px-3 py-1.5 shadow-lg animate-pulse">
      <div class="text-[10px] font-mono text-purple font-semibold">
        Esperando respuesta...
      </div>
    </div>
  </div>
</template>
