import { ref, shallowRef } from 'vue';
import type { Session, Agent, ToolEvent } from '../types';
import type { TemplateConfig, MapDef, GameState, Character, Position, Camera } from '../engine/types';
import { CharacterState } from '../engine/types';
import { createCamera } from '../engine/camera';
import {
  createCharacter,
  getHueShift,
  getCompanionHueShift,
  updateCharacter,
  transitionToActive,
  transitionToIdle,
  transitionToStopped,
  updateEnemies,
  resolveCharacterName,
  getUniqueName,
  type NameConfig,
} from '../engine/characters';
import { screenToWorld } from '../engine/camera';
import { useConfig } from './useConfig';
import { useSessions } from './useSessions';

// ── State ──

const gameState = shallowRef<GameState | null>(null);
const focusedSessionId = ref<string | null>(null);
const selectedSessionId = ref<string | null>(null);
const tick = ref(0); // Incremented each frame to force legend reactivity

// Track session index for hue shift assignment
let sessionCounter = 0;
const sessionHueShifts = new Map<string, number>();

// ── Init ──

function init(
  template: TemplateConfig,
  images: Map<string, HTMLImageElement>,
  currentSessions: Session[],
): void {
  const activeMap = selectMap(template, currentSessions.length);

  const state: GameState = {
    characters: new Map(),
    template,
    activeMap,
    images,
    occupiedSeats: new Set(),
    seatQueue: [],
    camera: createCamera(),
  };

  gameState.value = state;
  sessionCounter = 0;
  sessionHueShifts.clear();

  // Populate existing sessions
  for (const session of currentSessions) {
    addSessionCharacter(session);
  }
}

// ── Map Selection ──

function selectMap(template: TemplateConfig, sessionCount: number): MapDef {
  if (sessionCount <= 6 && template.maps.small) return template.maps.small;
  if (sessionCount <= 14 && template.maps.medium) return template.maps.medium;
  if (template.maps.large) return template.maps.large;
  // Fallback to whatever exists
  return template.maps.medium || template.maps.small || template.maps.large;
}

// ── Session → Character ──

function addSessionCharacter(session: Session): void {
  const state = gameState.value;
  if (!state) return;

  const { config } = useConfig();
  const nameConfig: NameConfig = {
    avatarName: config.value?.avatar?.name,
    agentTypeNames: config.value?.agentTypeNames,
  };

  const hueShift = getHueShift(sessionCounter++);
  sessionHueShifts.set(session.id, hueShift);

  // Use project name instead of generic "Agent"
  const charName = session.projectName || resolveCharacterName(null, nameConfig, state.template);

  const spawnZone = state.activeMap.zones.spawn;
  const spawnPos = spawnZone.length > 0
    ? { x: spawnZone[0].x, y: spawnZone[0].y }
    : { x: 0, y: 0 };

  const spriteKey = getMainSpriteKey(state.template);
  const char = createCharacter(
    session.id, session.id, spriteKey, charName,
    hueShift, spawnPos,
  );

  // Set topic from session
  char.topic = session.topic || null;

  // Load existing MCPs from session
  for (const mcp of session.mcps) {
    if (!char.environmentMcps.includes(mcp.name)) {
      char.environmentMcps.push(mcp.name);
    }
  }

  // Set pixel position
  char.x = spawnPos.x * state.template.tileSize + state.template.tileSize / 2;
  char.y = spawnPos.y * state.template.tileSize + state.template.tileSize / 2;

  state.characters.set(session.id, char);

  // If session is already active, transition
  if (session.status === 'active') {
    transitionToActive(char, state.template, state.activeMap, state.occupiedSeats, state.template.tileSize);
  }

  // Existing agents
  for (const agent of session.agents) {
    if (agent.status === 'running') {
      addCompanionCharacter(session.id, agent);
    }
  }
}

function addCompanionCharacter(sessionId: string, agent: Agent): void {
  const state = gameState.value;
  if (!state) return;

  const { config } = useConfig();
  const nameConfig: NameConfig = {
    avatarName: config.value?.avatar?.name,
    agentTypeNames: config.value?.agentTypeNames,
  };

  // Same color as parent (same project = same color)
  const hueShift = sessionHueShifts.get(sessionId) ?? 0;

  const baseName = resolveCharacterName(agent.type, nameConfig, state.template);
  const existingNames = Array.from(state.characters.values()).map(c => c.name);
  const name = getUniqueName(baseName, existingNames);

  // Get parent session for project name as topic
  const { sessions: sessionsRef } = useSessions();
  const parentSession = sessionsRef.value.get(sessionId);

  const agentVisual = state.template.agentTypes[agent.type] || state.template.agentTypes.default;
  const spriteKey = agentVisual?.sprite || getMainSpriteKey(state.template);

  const spawnZone = state.activeMap.zones.spawn;
  const spawnPos = spawnZone.length > 0
    ? { x: spawnZone[0].x, y: spawnZone[0].y }
    : { x: 0, y: 0 };

  const char = createCharacter(
    agent.id, sessionId, spriteKey, name,
    hueShift, spawnPos, true, agent.type,
  );

  // Set project name as topic for sub-agent
  char.topic = parentSession?.projectName || null;

  char.x = spawnPos.x * state.template.tileSize + state.template.tileSize / 2;
  char.y = spawnPos.y * state.template.tileSize + state.template.tileSize / 2;

  state.characters.set(agent.id, char);

  // Walk to work zone if parent session is active
  if (parentSession?.status === 'active') {
    transitionToActive(char, state.template, state.activeMap, state.occupiedSeats, state.template.tileSize);
  }
  // Otherwise stay spawning → will transition to idle
}

// ── Event Handlers ──

function onSessionStart(session: Session): void {
  addSessionCharacter(session);
}

function onSessionUpdate(session: Session): void {
  const state = gameState.value;
  if (!state) return;

  const char = state.characters.get(session.id);
  if (!char) {
    // Session not tracked yet — add it
    addSessionCharacter(session);
    return;
  }

  // Status change → FSM transition
  const prevWorking = char.state === CharacterState.WORKING;
  const prevIdle = char.state === CharacterState.IDLE || char.state === CharacterState.SPAWNING;

  if (session.status === 'active' && !prevWorking && char.state !== CharacterState.WALKING) {
    const toolAnim = getToolAnimation(state.template, session.activeTool?.toolName);
    transitionToActive(char, state.template, state.activeMap, state.occupiedSeats, state.template.tileSize, toolAnim);
  } else if ((session.status === 'idle' || session.status === 'waiting_input') && prevWorking) {
    transitionToIdle(char, state.occupiedSeats);
  } else if (session.status === 'stopped') {
    transitionToStopped(char, state.activeMap, state.occupiedSeats, state.template.tileSize);
  }

  // Sync topic
  if (session.topic) {
    char.topic = session.topic;
  }

  // Update tool animation
  if (session.activeTool && char.state === CharacterState.WORKING) {
    char.currentAnim = getToolAnimation(state.template, session.activeTool.toolName);
  }

  // Equipment (skills)
  if (session.activeTool?.toolName === 'Skill') {
    const skillName = (session.activeTool as any).toolInput?.skill as string | undefined;
    if (skillName) {
      char.equipment = state.template.equipmentMap[skillName] || state.template.equipmentMap.default || null;
    }
  }

  // Environment (MCPs) from activeTool
  if (session.activeTool?.toolName?.startsWith('mcp__')) {
    const mcpName = session.activeTool.toolName.split('__')[1];
    if (mcpName && !char.environmentMcps.includes(mcpName)) {
      char.environmentMcps.push(mcpName);
    }
  }

  // Enemy scaling
  const totalTokens = session.inputTokens + session.outputTokens;
  updateEnemies(char, state.template, totalTokens, state.template.tileSize);

  // Check if map resize needed
  const totalSessions = state.characters.size;
  const currentMapSize = state.activeMap.mapSize[0] * state.activeMap.mapSize[1];
  const newMap = selectMap(state.template, totalSessions);
  if (newMap !== state.activeMap) {
    // TODO: implement map transition (fade out → rebuild → fade in)
    // For now, just switch
    state.activeMap = newMap;
  }
}

function onSessionEnd(sessionId: string): void {
  const state = gameState.value;
  if (!state) return;

  const char = state.characters.get(sessionId);
  if (!char) return;

  transitionToStopped(char, state.activeMap, state.occupiedSeats, state.template.tileSize);
}

function onAgentStart(sessionId: string, agent: Agent): void {
  addCompanionCharacter(sessionId, agent);
}

function onAgentStop(_sessionId: string, agentId: string): void {
  const state = gameState.value;
  if (!state) return;

  const char = state.characters.get(agentId);
  if (!char) return;

  transitionToStopped(char, state.activeMap, state.occupiedSeats, state.template.tileSize);
}

function onToolActivity(event: ToolEvent): void {
  const state = gameState.value;
  if (!state) return;

  // Find target character (main or companion)
  const targetId = event.agentId || event.sessionId;
  const char = state.characters.get(targetId);
  if (!char) return;

  if (event.eventType === 'PreToolUse' && char.state === CharacterState.WORKING) {
    // Update animation based on tool type
    char.currentAnim = getToolAnimation(state.template, event.toolName);

    // Skill detection
    if (event.toolName === 'Skill' && event.toolInput?.skill) {
      const skillName = event.toolInput.skill as string;
      char.equipment = state.template.equipmentMap[skillName] || state.template.equipmentMap.default || null;
    }

    // MCP detection
    if (event.toolName.startsWith('mcp__')) {
      const mcpName = event.toolName.split('__')[1];
      if (mcpName && !char.environmentMcps.includes(mcpName)) {
        char.environmentMcps.push(mcpName);
      }
    }
  }
}

// ── Update (called every frame) ──

function update(dt: number): void {
  const state = gameState.value;
  if (!state) return;

  const { sessions } = useSessions();
  const toRemove: string[] = [];

  for (const [id, char] of state.characters) {
    updateCharacter(char, dt, state.template, state.activeMap, state.occupiedSeats, state.template.tileSize);

    // Update enemies for all characters (enemies are always present)
    if (!char.isCompanion) {
      const session = sessions.value.get(char.sessionId);
      if (session) {
        const totalTokens = session.inputTokens + session.outputTokens;
        updateEnemies(char, state.template, totalTokens, state.template.tileSize);
      }
    }

    if (char.markedForRemoval) {
      toRemove.push(id);
    }
  }

  for (const id of toRemove) {
    state.characters.delete(id);
    sessionHueShifts.delete(id);
  }

  // Companions face toward parent's enemies
  for (const char of state.characters.values()) {
    if (char.isCompanion && (char.state === CharacterState.WORKING || char.state === CharacterState.IDLE)) {
      const parent = state.characters.get(char.sessionId);
      if (parent && parent.enemies.length > 0) {
        const enemyCenterX = parent.enemies.reduce((s, e) => s + e.x, 0) / parent.enemies.length;
        char.facing = enemyCenterX > char.x ? 'right' : 'left';
      }
    }
  }

  // Tick counter for legend reactivity (every 30 frames ≈ 0.5s)
  tick.value++;
}

// ── Hit Detection ──

function getCharacterAtPixel(screenX: number, screenY: number): Character | null {
  const state = gameState.value;
  if (!state) return null;

  const world = screenToWorld(screenX, screenY, state.camera);
  const ts = state.template.tileSize;

  for (const char of state.characters.values()) {
    if (
      world.x >= char.x - ts / 2 && world.x <= char.x + ts / 2 &&
      world.y >= char.y - ts / 2 && world.y <= char.y + ts / 2
    ) {
      return char;
    }
  }
  return null;
}

// ── Focus / Select ──

function focusCharacter(sessionId: string): void {
  focusedSessionId.value = sessionId;
}

function selectCharacter(sessionId: string | null): void {
  selectedSessionId.value = selectedSessionId.value === sessionId ? null : sessionId;
}

// ── Destroy ──

function destroy(): void {
  gameState.value = null;
  focusedSessionId.value = null;
  selectedSessionId.value = null;
  sessionCounter = 0;
  sessionHueShifts.clear();
}

// ── Helpers ──

function getMainSpriteKey(template: TemplateConfig): string {
  // Use the first sprite key that has a walk animation, or just the first sprite
  for (const [key, sprite] of Object.entries(template.sprites)) {
    if (sprite.animations.walk || sprite.animations.idle) {
      return key;
    }
  }
  return Object.keys(template.sprites)[0] || 'warrior-1';
}

function getToolAnimation(template: TemplateConfig, toolName?: string): string {
  if (!toolName || !template.toolAnimations) return 'attack';

  // Parse base tool name from MCP pattern (mcp__server__tool → tool)
  let baseName = toolName;
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__');
    baseName = parts[2] || parts[1] || toolName;
  }

  return template.toolAnimations[baseName] || template.toolAnimations.default || 'attack';
}

// ── Export ──

export function useGameEngine() {
  return {
    gameState,
    tick,
    focusedSessionId,
    selectedSessionId,
    init,
    onSessionStart,
    onSessionUpdate,
    onSessionEnd,
    onAgentStart,
    onAgentStop,
    onToolActivity,
    update,
    getCharacterAtPixel,
    focusCharacter,
    selectCharacter,
    destroy,
  };
}
