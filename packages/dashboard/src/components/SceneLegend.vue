<script setup lang="ts">
import { computed } from 'vue';
import type { Session } from '../types';
import type { Character, GameState } from '../engine/types';
import { CharacterState } from '../engine/types';
import { getMcpSpriteKey } from '../engine/renderer';
import { formatTokens } from '../utils/format';

const props = defineProps<{
  sessions: Map<string, Session>;
  gameState: GameState | null;
  tick: number; // Forces reactivity update each frame
}>();

const entries = computed(() => {
  // Touch tick to force recomputation
  void props.tick;
  if (!props.gameState) return [];

  const result: Array<{
    sessionId: string;
    projectName: string;
    topic: string | null;
    status: string;
    model: string;
    tokens: string;
    mainChar: Character | null;
    companions: Character[];
    mcps: string[];
    skills: string[];
    enemyCount: number;
  }> = [];

  // Group characters by sessionId (main sessions only)
  for (const session of props.sessions.values()) {
    const mainChar = props.gameState.characters.get(session.id) || null;
    const companions: Character[] = [];

    for (const char of props.gameState.characters.values()) {
      if (char.isCompanion && char.sessionId === session.id) {
        companions.push(char);
      }
    }

    result.push({
      sessionId: session.id,
      projectName: session.projectName,
      topic: session.topic,
      status: session.status,
      model: session.model,
      tokens: `${formatTokens(session.inputTokens)}/${formatTokens(session.outputTokens)}`,
      mainChar,
      companions,
      mcps: session.mcps.map(m => m.name),
      skills: session.skills,
      enemyCount: mainChar?.enemies.length ?? 0,
    });
  }

  return result;
});

// Get the template name from the current view
function getTemplateName(): string {
  // Default to warriors — could be made dynamic
  return 'warriors';
}

function getEnemySpriteUrl(): string {
  return `/templates/${getTemplateName()}/assets/enemies/goblin-idle.png`;
}

function getCharSpriteUrl(spriteKey: string): string {
  return `/templates/${getTemplateName()}/assets/characters/${spriteKey}-idle.png`;
}

function getEquipmentUrl(equipmentKey: string): string {
  return `/templates/${getTemplateName()}/assets/equipment/${equipmentKey}.png`;
}

function getMcpUrl(mcpName: string): string {
  // Use same function as renderer for consistent colors
  const template = props.gameState?.template;
  const sprite = template ? getMcpSpriteKey(mcpName, template) : 'portal';
  return `/templates/${getTemplateName()}/assets/environment/${sprite}.png`;
}

function statusEmoji(status: string): string {
  switch (status) {
    case 'active': return '⚔️';
    case 'idle': return '💤';
    case 'waiting_permission': return '🛡️';
    case 'waiting_input': return '❓';
    case 'error': return '❌';
    case 'stopped': return '💀';
    default: return '•';
  }
}

function stateLabel(state: CharacterState): string {
  switch (state) {
    case CharacterState.WORKING: return 'Luchando';
    case CharacterState.IDLE: return 'Descansando';
    case CharacterState.WALKING: return 'Caminando';
    case CharacterState.SPAWNING: return 'Apareciendo';
    case CharacterState.DYING: return 'Muriendo';
    default: return '';
  }
}
</script>

<template>
  <div
    class="absolute top-14 left-2 z-20 w-64 max-h-[calc(100vh-100px)] overflow-y-auto
           bg-surface/90 backdrop-blur-sm border border-border rounded-lg shadow-lg"
  >
    <!-- Header -->
    <div class="px-3 py-2 border-b border-border/50 flex items-center justify-between">
      <span class="text-[11px] font-mono font-semibold text-text">Leyenda</span>
      <span class="text-[9px] font-mono text-muted">{{ entries.length }} proyecto{{ entries.length !== 1 ? 's' : '' }}</span>
    </div>

    <!-- Entries -->
    <div class="divide-y divide-border/30">
      <div
        v-for="entry in entries"
        :key="entry.sessionId"
        class="px-3 py-2 space-y-1.5"
      >
        <!-- Project header -->
        <div class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full shrink-0"
            :class="entry.status === 'active' ? 'bg-cyan' : entry.status === 'idle' ? 'bg-muted' : entry.status === 'waiting_permission' ? 'bg-amber animate-pulse' : entry.status === 'waiting_input' ? 'bg-purple' : 'bg-red'"
          />
          <span class="text-[11px] font-mono font-semibold text-text truncate">{{ entry.projectName }}</span>
          <span class="text-[8px] font-mono text-muted ml-auto">{{ entry.model }}</span>
        </div>

        <!-- Topic -->
        <div v-if="entry.topic" class="text-[9px] font-mono text-cyan truncate pl-4">
          {{ entry.topic }}
        </div>

        <!-- Main character -->
        <div v-if="entry.mainChar" class="flex items-center gap-1.5 pl-2">
          <span class="text-[12px]">🗡️</span>
          <span class="text-[9px] font-mono text-text">{{ entry.mainChar.name }}</span>
          <span class="text-[8px] font-mono text-muted">{{ stateLabel(entry.mainChar.state) }}</span>
        </div>

        <!-- Sub-agents with sprites -->
        <div
          v-for="comp in entry.companions"
          :key="comp.id"
          class="flex items-center gap-1.5 pl-4"
        >
          <span class="text-[10px]">{{ comp.agentType === 'Explore' ? '🏹' : comp.agentType === 'Plan' ? '🔮' : '⚔️' }}</span>
          <span class="text-[9px] font-mono text-text">{{ comp.name }}</span>
          <span class="text-[8px] font-mono text-muted">{{ stateLabel(comp.state) }}</span>
        </div>

        <!-- Enemies -->
        <div v-if="entry.enemyCount > 0" class="flex items-center gap-1.5 pl-2">
          <span class="text-[10px]">👹</span>
          <span class="text-[9px] font-mono text-red">{{ entry.enemyCount }} enemigo{{ entry.enemyCount > 1 ? 's' : '' }}</span>
        </div>

        <!-- Equipment (active skill) -->
        <div v-if="entry.mainChar?.equipment" class="pl-2 flex items-center gap-1.5">
          <img
            :src="getEquipmentUrl(entry.mainChar.equipment)"
            class="w-4 h-4 pixelated"
            :alt="entry.mainChar.equipment"
          />
          <span class="text-[8px] font-mono text-amber">{{ entry.mainChar.equipment }}</span>
        </div>

        <!-- MCPs with sprite images -->
        <div v-if="entry.mcps.length > 0" class="pl-2 flex flex-wrap gap-1">
          <div
            v-for="mcp in entry.mcps"
            :key="mcp"
            class="flex items-center gap-1.5 text-[9px] font-mono px-1.5 py-1 rounded bg-purple/15 text-purple"
          >
            <img
              :src="getMcpUrl(mcp)"
              class="w-4 h-4 pixelated"
              :alt="mcp"
            />
            {{ mcp }}
          </div>
        </div>

        <!-- Skills -->
        <div v-if="entry.skills.length > 0" class="pl-2 flex flex-wrap gap-1">
          <span
            v-for="skill in entry.skills.slice(0, 5)"
            :key="skill"
            class="text-[8px] font-mono px-1 py-0.5 rounded bg-cyan/15 text-cyan"
          >
            {{ skill }}
          </span>
          <span v-if="entry.skills.length > 5" class="text-[8px] font-mono text-muted">
            +{{ entry.skills.length - 5 }}
          </span>
        </div>

        <!-- Tokens -->
        <div class="flex items-center gap-1 pl-2">
          <span class="text-[8px] font-mono text-muted">Tokens: {{ entry.tokens }}</span>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="entries.length === 0" class="px-3 py-4 text-center">
      <span class="text-[10px] font-mono text-muted">Sin sesiones activas</span>
    </div>
  </div>
</template>

<style scoped>
.pixelated {
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}
</style>
