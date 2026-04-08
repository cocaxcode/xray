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
import { findPath } from '../engine/pathfinding';
import { useConfig } from './useConfig';
import { useSessions } from './useSessions';

// ── State ──

const gameState = shallowRef<GameState | null>(null);
const focusedSessionId = ref<string | null>(null);
const selectedSessionId = ref<string | null>(null);
const tick = ref(0); // Incremented each frame to force legend reactivity

// Track session index for hue shift assignment
let sessionCounter = 0;
const idleTimers = new Map<string, number>(); // charId → setTimeout ID
const sessionHueShifts = new Map<string, number>();

// ── Init ──

function init(
  template: TemplateConfig,
  images: Map<string, HTMLImageElement>,
  currentSessions: Session[],
): void {
  const activeMap = selectMap(template, currentSessions.length);

  // Generate random decorations
  const randomProps = generateRandomDecorations(template, activeMap);

  const state: GameState = {
    characters: new Map(),
    template,
    activeMap,
    images,
    occupiedSeats: new Set(),
    seatQueue: [],
    camera: createCamera(),
    randomProps,
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
    hueShift, spawnPos, false, undefined, state.template,
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

  // Don't recreate if companion already exists
  if (state.characters.has(agent.id)) return;

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
    hueShift, spawnPos, true, agent.type, state.template,
  );

  // Set project name as topic for sub-agent
  char.topic = parentSession?.projectName || null;

  char.x = spawnPos.x * state.template.tileSize + state.template.tileSize / 2;
  char.y = spawnPos.y * state.template.tileSize + state.template.tileSize / 2;

  state.characters.set(agent.id, char);

  // Position companion BEHIND the parent (opposite side of enemies)
  const parent = state.characters.get(sessionId);
  if (parent?.assignedSeat) {
    // Companion goes opposite side of enemies (configurable offset)
    const companionOffset = state.template.mechanics?.companionOffsetX ?? -2;
    const behindX = parent.assignedSeat.x + companionOffset;
    const behindY = parent.assignedSeat.y + (state.characters.size % 3 - 1); // stagger vertically
    const ts = state.template.tileSize;

    // Don't use assignSeat — companion stays behind parent, not at a work seat
    char.assignedSeat = { x: Math.max(1, behindX), y: Math.max(1, Math.min(state.activeMap.mapSize[1] - 2, behindY)) };

    if (parentSession?.status === 'active') {
      const path = findPath(state.activeMap.walkable, { x: char.tileX, y: char.tileY }, char.assignedSeat, state.occupiedSeats);
      if (path.length > 0) {
        char.path = path;
        char.moveProgress = 0;
        char.state = CharacterState.WALKING;
        char.targetState = CharacterState.WORKING;
        char.currentAnim = 'walk';
        char.animFrame = 0;
        char.animTimer = 0;
      } else {
        // Teleport
        char.tileX = char.assignedSeat.x;
        char.tileY = char.assignedSeat.y;
        char.x = char.assignedSeat.x * ts + ts / 2;
        char.y = char.assignedSeat.y * ts + ts / 2;
        char.state = CharacterState.WORKING;
        char.currentAnim = state.template.animations?.working || 'attack';
        char.animFrame = 0;
        char.animTimer = 0;
      }
    }
  } else if (parentSession?.status === 'active') {
    transitionToActive(char, state.template, state.activeMap, state.occupiedSeats, state.template.tileSize);
  }
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

  // Allow interrupting wander (WALKING with targetState IDLE) when session becomes active
  const isWandering = char.state === CharacterState.WALKING && char.targetState === CharacterState.IDLE;
  if (session.status === 'active' && !prevWorking && (char.state !== CharacterState.WALKING || isWandering)) {
    const toolAnim = getToolAnimation(state.template, session.activeTool?.toolName);
    transitionToActive(char, state.template, state.activeMap, state.occupiedSeats, state.template.tileSize, toolAnim);
  } else if ((session.status === 'idle' || session.status === 'waiting_input') && prevWorking) {
    // Delay idle transition — between tool calls there's a brief idle gap
    // Only transition if still idle after 2 seconds
    const charId = char.id;
    if (!idleTimers.has(charId)) {
      idleTimers.set(charId, window.setTimeout(() => {
        idleTimers.delete(charId);
        const currentChar = gameState.value?.characters.get(charId);
        if (currentChar && currentChar.state === CharacterState.WORKING) {
          const sess = useSessions().sessions.value.get(currentChar.sessionId);
          if (sess && (sess.status === 'idle' || sess.status === 'waiting_input')) {
            transitionToIdle(currentChar, gameState.value!.occupiedSeats, gameState.value!.template);
          }
        }
      }, 2000));
    }
  } else if (session.status === 'active' && idleTimers.has(char.id)) {
    // Cancel pending idle transition — session is active again
    clearTimeout(idleTimers.get(char.id));
    idleTimers.delete(char.id);
  }
  if (session.status === 'stopped') {
    transitionToStopped(char, state.activeMap, state.occupiedSeats, state.template.tileSize, state.template);
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

  // Companion stays on map — goes to idle (resting), doesn't disappear
  transitionToIdle(char, state.occupiedSeats, state.template);
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
  const cs = state.template.tileSize * (state.template.mechanics?.characterScale ?? 1);

  for (const char of state.characters.values()) {
    if (
      world.x >= char.x - cs / 2 && world.x <= char.x + cs / 2 &&
      world.y >= char.y - cs / 2 && world.y <= char.y + cs / 2
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
  // Clean up idle timers
  for (const timer of idleTimers.values()) clearTimeout(timer);
  idleTimers.clear();
}

// ── Helpers ──

function generateRandomDecorations(template: TemplateConfig, activeMap: MapDef): import('../engine/types').PropDef[] {
  const config = template.decorations;
  if (!config) return [];

  const [cols, rows] = activeMap.mapSize;
  const margin = config.margin || 1;
  const props: import('../engine/types').PropDef[] = [];
  const used = new Set<string>();

  // Groups: place clusters of 2-3 similar items near each other
  // More rocks/plants, fewer bones/pumpkins
  const weighted = [
    ...config.sprites.filter(s => s.includes('rock')),
    ...config.sprites.filter(s => s.includes('rock')),   // rocks appear more
    ...config.sprites.filter(s => s.includes('plant')),
    ...config.sprites.filter(s => s.includes('plant')),  // plants appear more
    ...config.sprites.filter(s => s.includes('bush')),
    ...config.sprites.filter(s => s.includes('mushroom')),
    ...config.sprites.filter(s => s.includes('bone')),
    ...config.sprites.filter(s => s.includes('pumpkin')),
  ];

  let placed = 0;
  let attempts = 0;

  while (placed < config.count && attempts < 200) {
    attempts++;
    // Pick random position inside walkable area
    const x = margin + Math.floor(Math.random() * (cols - margin * 2));
    const y = margin + Math.floor(Math.random() * (rows - margin * 2));
    const key = `${x},${y}`;

    if (used.has(key) || !activeMap.walkable[y]?.[x]) continue;

    // Pick random sprite from weighted list
    const sprite = weighted[Math.floor(Math.random() * weighted.length)];
    props.push({ sprite, x, y });
    used.add(key);
    placed++;

    // 50% chance to place a neighbor (cluster)
    if (Math.random() < 0.5 && placed < config.count) {
      const nx = x + (Math.random() > 0.5 ? 1 : -1);
      const ny = y + (Math.random() > 0.5 ? 1 : 0);
      const nkey = `${nx},${ny}`;
      if (!used.has(nkey) && nx >= margin && nx < cols - margin && activeMap.walkable[ny]?.[nx]) {
        const nsprite = weighted[Math.floor(Math.random() * weighted.length)];
        props.push({ sprite: nsprite, x: nx, y: ny });
        used.add(nkey);
        placed++;
      }
    }
  }

  return props;
}

function getMainSpriteKey(template: TemplateConfig): string {
  // Use the first sprite key that has a walk animation, or just the first sprite
  for (const [key, sprite] of Object.entries(template.sprites)) {
    if (sprite.animations.walk || sprite.animations.idle) {
      return key;
    }
  }
  return Object.keys(template.sprites)[0] || 'character';
}

function getToolAnimation(template: TemplateConfig, toolName?: string): string {
  const workingAnim = template.animations?.working || 'attack';
  if (!toolName || !template.toolAnimations) return workingAnim;

  // Parse base tool name from MCP pattern (mcp__server__tool → tool)
  let baseName = toolName;
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__');
    baseName = parts[2] || parts[1] || toolName;
  }

  return template.toolAnimations[baseName] || template.toolAnimations.default || workingAnim;
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
