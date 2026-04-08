<script setup lang="ts">
import { computed, ref, reactive } from 'vue';
import type { Session } from '../types';
import type { Character, GameState } from '../engine/types';
import { CharacterState } from '../engine/types';
import { getMcpSpriteKey } from '../engine/renderer';
import { formatTokens } from '../utils/format';

const props = defineProps<{
  sessions: Map<string, Session>;
  gameState: GameState | null;
  tick: number;
  templateName: string;
}>();

const emit = defineEmits<{
  dismissSession: [sessionId: string];
}>();

// Track which entries are expanded (first 2 auto-expand)
const expandedSessions = reactive(new Set<string>());
const hiddenSessions = reactive(new Set<string>());
const showHidden = ref(false);

function toggleExpand(sessionId: string): void {
  if (expandedSessions.has(sessionId)) {
    expandedSessions.delete(sessionId);
  } else {
    expandedSessions.add(sessionId);
  }
}

function isExpanded(sessionId: string, index: number): boolean {
  // First 2 are expanded by default unless user collapsed them
  if (expandedSessions.has(sessionId)) return true;
  if (index < 2 && !expandedSessions.has('_collapsed_' + sessionId)) return true;
  return false;
}

function collapseEntry(sessionId: string): void {
  expandedSessions.delete(sessionId);
  expandedSessions.add('_collapsed_' + sessionId);
}

function dismissSession(sessionId: string): void {
  hiddenSessions.add(sessionId);
  emit('dismissSession', sessionId);
}

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

const visibleEntries = computed(() => entries.value.filter(e => !hiddenSessions.has(e.sessionId)));
const hiddenEntries = computed(() => entries.value.filter(e => hiddenSessions.has(e.sessionId)));

// Build asset URLs dynamically from template config
function getSpriteSheetUrl(spriteKey: string): string {
  const template = props.gameState?.template;
  if (!template) return '';
  const sprite = template.sprites[spriteKey];
  if (!sprite) return '';
  // Use idle animation sheet if available, otherwise main sheet
  const idleAnim = sprite.animations.idle;
  const sheet = idleAnim?.sheet || sprite.sheet;
  return `/templates/${props.templateName}/${sheet}`;
}

function getEnemySpriteUrl(): string {
  const template = props.gameState?.template;
  if (!template?.enemyScaling?.thresholds?.length) return '';
  const firstEnemySprite = template.enemyScaling.thresholds[0].sprite;
  return getSpriteSheetUrl(firstEnemySprite);
}

function getCharSpriteUrl(spriteKey: string): string {
  return getSpriteSheetUrl(spriteKey);
}

function getEquipmentUrl(equipmentKey: string): string {
  return getSpriteSheetUrl(equipmentKey);
}

function getMcpUrl(mcpName: string): string {
  const template = props.gameState?.template;
  if (!template) return '';
  const spriteKey = getMcpSpriteKey(mcpName, template);
  return getSpriteSheetUrl(spriteKey);
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

function stateLabel(state: CharacterState, sessionStatus?: string): string {
  const labels = props.gameState?.template?.stateLabels;
  const defaultLabels: Record<string, string> = {
    working: 'Trabajando',
    idle: 'Descansando',
    walking: 'Caminando',
    spawning: 'Apareciendo',
    dying: 'Muriendo',
    waiting_input: 'Esperando',
    waiting_permission: 'Permiso',
  };
  const l = labels || defaultLabels;

  // Use session status for more accurate label
  if (sessionStatus === 'idle' && state !== CharacterState.DYING) return l.idle || 'Descansando';
  if (sessionStatus === 'waiting_input') return l.waiting_input || 'Esperando';
  if (sessionStatus === 'waiting_permission') return l.waiting_permission || 'Permiso';

  switch (state) {
    case CharacterState.WORKING: return l.working || 'Trabajando';
    case CharacterState.IDLE: return l.idle || 'Descansando';
    case CharacterState.WALKING: return l.walking || 'Caminando';
    case CharacterState.SPAWNING: return l.spawning || 'Apareciendo';
    case CharacterState.DYING: return l.dying || 'Muriendo';
    default: return '';
  }
}

// Legend collapsed state — starts collapsed on mobile
const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
const legendOpen = ref(!isMobile);
</script>

<template>
  <!-- Collapsed: small toggle button -->
  <button
    v-if="!legendOpen"
    @click="legendOpen = true"
    class="absolute top-14 left-2 z-20 flex items-center gap-1.5 px-2.5 py-1.5
           bg-surface/90 backdrop-blur-sm border border-border rounded-lg shadow-lg
           text-[10px] font-mono text-muted hover:text-text transition-colors"
  >
    <span>▶</span>
    <span>Leyenda</span>
    <span class="text-cyan font-semibold">{{ visibleEntries.length }}</span>
  </button>

  <!-- Expanded panel -->
  <div
    v-if="legendOpen"
    class="absolute top-14 left-2 z-20 w-64 max-w-[calc(100vw-24px)] max-h-[calc(100vh-100px)] overflow-y-auto
           bg-surface/90 backdrop-blur-sm border border-border rounded-lg shadow-lg"
  >
    <!-- Header with close button -->
    <div class="px-3 py-2 border-b border-border/50 flex items-center justify-between">
      <span class="text-[11px] font-mono font-semibold text-text">Leyenda</span>
      <div class="flex items-center gap-2">
        <span class="text-[9px] font-mono text-muted">{{ visibleEntries.length }}</span>
        <button @click="legendOpen = false" class="text-muted hover:text-text p-0.5" title="Ocultar">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Active Entries -->
    <div class="divide-y divide-border/30">
      <div
        v-for="(entry, idx) in visibleEntries"
        :key="entry.sessionId"
        class="px-3 py-2"
      >
        <!-- Project header (always visible, clickable to expand/collapse) -->
        <div class="flex items-center gap-1.5 cursor-pointer" @click="isExpanded(entry.sessionId, idx) ? collapseEntry(entry.sessionId) : toggleExpand(entry.sessionId)">
          <span class="w-2 h-2 rounded-full shrink-0"
            :class="entry.status === 'active' ? 'bg-cyan' : entry.status === 'idle' ? 'bg-muted' : entry.status === 'waiting_permission' ? 'bg-amber animate-pulse' : entry.status === 'waiting_input' ? 'bg-purple' : 'bg-red'"
          />
          <span class="text-[11px] font-mono font-semibold text-text truncate">{{ entry.projectName }}</span>
          <span class="text-[8px] font-mono text-muted">{{ entry.model }}</span>
          <!-- Expand/collapse arrow -->
          <span class="text-[8px] text-muted ml-auto">{{ isExpanded(entry.sessionId, idx) ? '▼' : '▶' }}</span>
          <!-- Dismiss button -->
          <button
            @click.stop="dismissSession(entry.sessionId)"
            class="text-muted hover:text-red transition-colors p-0.5"
            title="Ocultar sesion"
          >
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Expanded details -->
        <div v-if="isExpanded(entry.sessionId, idx)" class="space-y-1.5 mt-1.5">
          <!-- Topic -->
          <div v-if="entry.topic" class="text-[9px] font-mono text-cyan truncate pl-4">
            {{ entry.topic }}
          </div>

          <!-- Main character -->
          <div v-if="entry.mainChar" class="flex items-center gap-1.5 pl-2">
            <span class="text-[12px]">🗡️</span>
            <span class="text-[9px] font-mono text-text">{{ entry.mainChar.name }}</span>
            <span class="text-[8px] font-mono text-muted">{{ stateLabel(entry.mainChar.state, entry.status) }}</span>
          </div>

          <!-- Sub-agents -->
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

          <!-- Equipment -->
          <div v-if="entry.mainChar?.equipment" class="pl-2 flex items-center gap-1.5">
            <img :src="getEquipmentUrl(entry.mainChar.equipment)" class="w-4 h-4 pixelated" />
            <span class="text-[8px] font-mono text-amber">{{ entry.mainChar.equipment }}</span>
          </div>

          <!-- MCPs -->
          <div v-if="entry.mcps.length > 0" class="pl-2 flex flex-wrap gap-1">
            <div
              v-for="mcp in entry.mcps"
              :key="mcp"
              class="flex items-center gap-1.5 text-[9px] font-mono px-1.5 py-1 rounded bg-purple/15 text-purple"
            >
              <img :src="getMcpUrl(mcp)" class="w-4 h-4 pixelated" :alt="mcp" />
              {{ mcp }}
            </div>
          </div>

          <!-- Tokens -->
          <div class="flex items-center gap-1 pl-2">
            <span class="text-[8px] font-mono text-muted">Tokens: {{ entry.tokens }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Hidden sessions (collapsed section) -->
    <div v-if="hiddenEntries.length > 0" class="border-t border-border/50">
      <button
        @click="showHidden = !showHidden"
        class="w-full px-3 py-1.5 text-[9px] font-mono text-muted hover:text-text flex items-center gap-1"
      >
        <span>{{ showHidden ? '▼' : '▶' }}</span>
        <span>Ocultas ({{ hiddenEntries.length }})</span>
      </button>
      <div v-if="showHidden" class="divide-y divide-border/30">
        <div
          v-for="entry in hiddenEntries"
          :key="entry.sessionId"
          class="px-3 py-1.5 flex items-center gap-1.5"
        >
          <span class="w-2 h-2 rounded-full shrink-0 bg-muted/30" />
          <span class="text-[10px] font-mono text-muted truncate">{{ entry.projectName }}</span>
          <button
            @click="hiddenSessions.delete(entry.sessionId)"
            class="ml-auto text-[8px] font-mono text-cyan hover:text-text"
          >
            Mostrar
          </button>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="visibleEntries.length === 0 && hiddenEntries.length === 0" class="px-3 py-4 text-center">
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
