import type {
  Character, EnemyState, Position, TemplateConfig, MapDef,
  SpriteDef, AnimationDef, EnemyScaling, CharacterState as CharState,
} from './types';
import { CharacterState } from './types';
import { findPath, findNearestWalkable } from './pathfinding';

// ── Constants ──

const WALK_SPEED = 3;           // tiles per second
const WANDER_MIN = 2;           // seconds
const WANDER_MAX = 20;          // seconds
const SPAWN_DURATION = 0.5;     // seconds
const HUE_SHIFTS = [0, 45, 90, 135, 180, 225, 270, 315];

// ── Factory ──

export function createCharacter(
  id: string,
  sessionId: string,
  spriteKey: string,
  name: string,
  hueShift: number,
  spawnPos: Position,
  isCompanion = false,
  agentType?: string,
): Character {
  return {
    id,
    sessionId,
    isCompanion,
    agentType,
    spriteKey,
    name,
    hueShift,
    equipment: null,
    environmentMcps: [],
    x: spawnPos.x,
    y: spawnPos.y,
    tileX: spawnPos.x,
    tileY: spawnPos.y,
    state: CharacterState.SPAWNING,
    targetState: null,
    facing: 'down',
    currentAnim: 'idle',
    animFrame: 0,
    animTimer: 0,
    path: [],
    moveProgress: 0,
    walkSpeed: WALK_SPEED,
    wanderTimer: 0,
    spawnTimer: SPAWN_DURATION,
    enemies: [],
    topic: null,
    assignedSeat: null,
    markedForRemoval: false,
  };
}

// ── Hue Shift Assignment ──

export function getHueShift(index: number): number {
  return HUE_SHIFTS[index % HUE_SHIFTS.length];
}

export function getCompanionHueShift(parentHueShift: number): number {
  return (parentHueShift + 20) % 360;
}

// ── FSM Update ──

export function updateCharacter(
  char: Character,
  dt: number,
  template: TemplateConfig,
  activeMap: MapDef,
  occupied: Set<string>,
  tileSize: number,
): void {
  switch (char.state) {
    case CharacterState.SPAWNING:
      char.spawnTimer -= dt;
      if (char.spawnTimer <= 0) {
        char.state = CharacterState.IDLE;
        char.currentAnim = 'idle';
        char.animFrame = 0;
        char.animTimer = 0;
      }
      break;

    case CharacterState.IDLE:
      char.wanderTimer -= dt;
      if (char.wanderTimer <= 0) {
        const target = pickRandomWalkableTile(activeMap, occupied, char.tileX, char.tileY);
        if (target) {
          const path = findPath(activeMap.walkable, { x: char.tileX, y: char.tileY }, target, occupied);
          if (path.length > 0) {
            char.path = path;
            char.moveProgress = 0;
            char.state = CharacterState.WALKING;
            char.targetState = CharacterState.IDLE;
            char.currentAnim = 'walk';
            char.animFrame = 0;
            char.animTimer = 0;
          }
        }
        char.wanderTimer = randomRange(WANDER_MIN, WANDER_MAX);
      }
      updateAnimation(char, dt, template);
      // Enemies idle at base with slight wobble
      for (let ei = 0; ei < char.enemies.length; ei++) {
        const enemy = char.enemies[ei];
        enemy.currentAnim = 'idle';
        updateEnemyAnimation(enemy, dt, template);
        const wobbleX = Math.sin(Date.now() / 2000 + ei * 3.7) * tileSize * 0.15;
        const wobbleY = Math.cos(Date.now() / 2500 + ei * 2.1) * tileSize * 0.1;
        enemy.x = enemy.baseX + wobbleX;
        enemy.y = enemy.baseY + wobbleY;
      }
      break;

    case CharacterState.WALKING:
      updateMovement(char, dt, tileSize);
      updateAnimation(char, dt, template);
      for (const enemy of char.enemies) {
        updateEnemyAnimation(enemy, dt, template);
      }
      break;

    case CharacterState.WORKING:
      updateAnimation(char, dt, template);
      if (char.enemies.length > 0) {
        // Home = assigned seat position (not current tile which may be mid-walk)
        const seat = char.assignedSeat || { x: char.tileX, y: char.tileY };
        const homeX = seat.x * tileSize + tileSize / 2;
        const homeY = seat.y * tileSize + tileSize / 2;

        // Find nearest enemy BASE position (not animated position)
        let nearestEnemy = char.enemies[0];
        let nearestDist = Infinity;
        for (const e of char.enemies) {
          const d = Math.abs(e.baseX - homeX) + Math.abs(e.baseY - homeY);
          if (d < nearestDist) { nearestDist = d; nearestEnemy = e; }
        }

        // Calculate group center of goblins (using BASE positions)
        let groupBaseX = 0, groupBaseY = 0;
        for (const e of char.enemies) { groupBaseX += e.baseX; groupBaseY += e.baseY; }
        groupBaseX /= char.enemies.length;
        groupBaseY /= char.enemies.length;

        // Combat phase: warrior charges toward goblin group center then retreats
        const combatPhase = (Math.sin(Date.now() / 1000) + 1) / 2;

        // Warrior advances 80% toward goblin group center directly
        char.x = homeX + (groupBaseX - homeX) * 0.8 * combatPhase;
        char.y = homeY + (groupBaseY - homeY) * 0.5 * combatPhase;

        // Face toward goblins
        char.facing = groupBaseX > homeX ? 'right' : 'left';

        // All goblins advance toward meeting point as a group
        for (let ei = 0; ei < char.enemies.length; ei++) {
          const enemy = char.enemies[ei];
          enemy.currentAnim = 'attack';
          updateEnemyAnimation(enemy, dt, template);

          // Each goblin keeps its formation offset but group moves together
          const offsetFromGroupX = enemy.baseX - groupBaseX;
          const offsetFromGroupY = enemy.baseY - groupBaseY;

          // Stagger slightly so they don't ALL hit at the same frame
          const stagger = Math.sin(Date.now() / 800 + ei * 1.5) * tileSize * 0.15;

          // Group advances toward warrior home position
          const groupX = groupBaseX + (homeX - groupBaseX) * 0.5 * combatPhase;
          const groupY = groupBaseY + (homeY - groupBaseY) * 0.3 * combatPhase;

          enemy.x = groupX + offsetFromGroupX * 0.6 + stagger;
          enemy.y = groupY + offsetFromGroupY * 0.6;
        }
      }
      break;

    case CharacterState.DYING:
      updateAnimation(char, dt, template);
      // Check if death animation finished (oneshot)
      const sprite = template.sprites[char.spriteKey];
      const anim = sprite?.animations[char.currentAnim];
      if (anim && !anim.loop && char.animFrame >= anim.frames - 1) {
        char.markedForRemoval = true;
      }
      break;
  }
}

// ── Movement ──

function updateMovement(char: Character, dt: number, tileSize: number): void {
  if (char.path.length === 0) {
    // Arrived at destination
    const next = char.targetState ?? CharacterState.IDLE;
    char.state = next;
    char.targetState = null;
    char.currentAnim = next === CharacterState.WORKING ? 'attack' : 'idle';
    char.animFrame = 0;
    char.animTimer = 0;
    return;
  }

  char.moveProgress += char.walkSpeed * dt;

  if (char.moveProgress >= 1) {
    // Arrived at next tile
    const nextTile = char.path.shift()!;
    char.tileX = nextTile.x;
    char.tileY = nextTile.y;
    char.x = nextTile.x * tileSize + tileSize / 2;
    char.y = nextTile.y * tileSize + tileSize / 2;
    char.moveProgress = 0;

    if (char.path.length === 0) {
      // Arrived at final destination
      const next = char.targetState ?? CharacterState.IDLE;
      char.state = next;
      char.targetState = null;
      char.currentAnim = next === CharacterState.WORKING ? 'attack' : 'idle';
      char.animFrame = 0;
      char.animTimer = 0;
    }
  } else {
    // Interpolate position
    const fromX = char.tileX * tileSize + tileSize / 2;
    const fromY = char.tileY * tileSize + tileSize / 2;
    const toX = char.path[0].x * tileSize + tileSize / 2;
    const toY = char.path[0].y * tileSize + tileSize / 2;
    char.x = fromX + (toX - fromX) * char.moveProgress;
    char.y = fromY + (toY - fromY) * char.moveProgress;

    // Update facing
    updateFacing(char, toX - fromX, toY - fromY);
  }
}

// ── State Transitions ──

export function transitionToActive(
  char: Character,
  template: TemplateConfig,
  activeMap: MapDef,
  occupied: Set<string>,
  tileSize: number,
  toolAnim?: string,
): void {
  const seat = assignSeat(activeMap.zones.work, occupied);
  if (seat) {
    char.assignedSeat = seat;
    const path = findPath(activeMap.walkable, { x: char.tileX, y: char.tileY }, seat, occupied);
    if (path.length > 0) {
      char.path = path;
      char.moveProgress = 0;
      char.state = CharacterState.WALKING;
      char.targetState = CharacterState.WORKING;
      char.currentAnim = 'walk';
      char.animFrame = 0;
      char.animTimer = 0;
    } else {
      // Can't pathfind — just teleport
      char.tileX = seat.x;
      char.tileY = seat.y;
      char.x = seat.x * tileSize + tileSize / 2;
      char.y = seat.y * tileSize + tileSize / 2;
      char.state = CharacterState.WORKING;
      char.currentAnim = toolAnim || 'attack';
      char.animFrame = 0;
      char.animTimer = 0;
    }
  } else {
    // No seats available — stay where we are, play working anim anyway
    char.state = CharacterState.WORKING;
    char.currentAnim = toolAnim || 'attack';
    char.animFrame = 0;
    char.animTimer = 0;
  }
}

export function transitionToIdle(
  char: Character,
  occupied: Set<string>,
): void {
  if (char.assignedSeat) {
    releaseSeat(char.assignedSeat, occupied);
    char.assignedSeat = null;
  }
  char.state = CharacterState.IDLE;
  char.currentAnim = 'idle';
  char.animFrame = 0;
  char.animTimer = 0;
  char.wanderTimer = randomRange(WANDER_MIN, WANDER_MAX);

  // Despawn enemies
  for (const enemy of char.enemies) {
    enemy.markedForRemoval = true;
  }
  char.enemies = [];
}

export function transitionToStopped(
  char: Character,
  activeMap: MapDef,
  occupied: Set<string>,
  tileSize: number,
): void {
  if (char.assignedSeat) {
    releaseSeat(char.assignedSeat, occupied);
    char.assignedSeat = null;
  }

  const exitZone = activeMap.zones.exit;
  if (exitZone.length > 0) {
    const exit = exitZone[0];
    const path = findPath(activeMap.walkable, { x: char.tileX, y: char.tileY }, exit, occupied);
    if (path.length > 0) {
      char.path = path;
      char.moveProgress = 0;
      char.state = CharacterState.WALKING;
      char.targetState = CharacterState.DYING;
      char.currentAnim = 'walk';
      char.animFrame = 0;
      char.animTimer = 0;
    } else {
      // Can't pathfind to exit — die in place
      char.state = CharacterState.DYING;
      char.currentAnim = 'death';
      char.animFrame = 0;
      char.animTimer = 0;
    }
  } else {
    char.state = CharacterState.DYING;
    char.currentAnim = 'death';
    char.animFrame = 0;
    char.animTimer = 0;
  }

  // Despawn enemies
  for (const enemy of char.enemies) {
    enemy.markedForRemoval = true;
  }
  char.enemies = [];
}

// ── Seat Management ──

const seatQueue: string[] = [];

export function assignSeat(workZones: Position[], occupied: Set<string>): Position | null {
  for (const seat of workZones) {
    const key = `${seat.x},${seat.y}`;
    if (!occupied.has(key)) {
      occupied.add(key);
      return seat;
    }
  }
  return null;
}

export function releaseSeat(pos: Position, occupied: Set<string>): void {
  occupied.delete(`${pos.x},${pos.y}`);
}

export function addToSeatQueue(charId: string): void {
  if (!seatQueue.includes(charId)) seatQueue.push(charId);
}

export function getNextFromSeatQueue(): string | undefined {
  return seatQueue.shift();
}

// ── Animation ──

export function updateAnimation(char: Character, dt: number, template: TemplateConfig): void {
  const sprite = template.sprites[char.spriteKey];
  if (!sprite) return;

  const anim = sprite.animations[char.currentAnim];
  if (!anim) return;

  // Safety clamp — prevent frame from exceeding animation length
  if (char.animFrame >= anim.frames) {
    char.animFrame = 0;
  }

  char.animTimer += dt;
  if (char.animTimer >= anim.speed) {
    char.animTimer -= anim.speed;
    const loop = anim.loop !== false; // default true
    if (loop) {
      char.animFrame = (char.animFrame + 1) % anim.frames;
    } else {
      if (char.animFrame < anim.frames - 1) {
        char.animFrame++;
      }
    }
  }
}

function updateEnemyAnimation(enemy: EnemyState, dt: number, template: TemplateConfig): void {
  const sprite = template.sprites[enemy.spriteKey];
  if (!sprite) return;

  const anim = sprite.animations[enemy.currentAnim];
  if (!anim) return;

  enemy.animTimer += dt;
  if (enemy.animTimer >= anim.speed) {
    enemy.animTimer -= anim.speed;
    enemy.animFrame = (enemy.animFrame + 1) % anim.frames;
  }
}

// ── Facing ──

function updateFacing(char: Character, dx: number, dy: number): void {
  if (Math.abs(dx) > Math.abs(dy)) {
    char.facing = dx > 0 ? 'right' : 'left';
  } else if (dy !== 0) {
    char.facing = dy > 0 ? 'down' : 'up';
  }
}

// ── Enemy Scaling ──

/**
 * Update enemies for a character.
 * Enemies are ALWAYS present (idle near the character's work zone).
 * When character is WORKING, enemies play attack animation and orbit.
 * Count scales with tokens via enemyScaling thresholds.
 */
export function updateEnemies(
  char: Character,
  template: TemplateConfig,
  totalTokens: number,
  tileSize: number,
): void {
  const scaling = template.enemyScaling;
  if (!scaling) return;

  // Find current threshold — always at least 1 enemy
  let targetCount = 1;
  let latestSprite = 'goblin';
  for (const threshold of scaling.thresholds) {
    if (totalTokens >= threshold.tokens) {
      targetCount = Math.max(threshold.enemies, 1);
      latestSprite = threshold.sprite;
    }
  }

  // Place enemies grouped near the character's assigned work seat
  // Each session gets a consistent "zone" based on seat position
  const seatX = char.assignedSeat ? char.assignedSeat.x : char.tileX;
  const seatY = char.assignedSeat ? char.assignedSeat.y : char.tileY;

  // Seed random from char ID for consistent positions
  const seed = char.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);

  while (char.enemies.length < targetCount) {
    const idx = char.enemies.length;
    const pseudoRand = Math.sin(seed * 13 + idx * 7) * 0.5 + 0.5;
    const pseudoRand2 = Math.sin(seed * 17 + idx * 11) * 0.5 + 0.5;
    // Direction based on seed (some sessions have goblins right, others left)
    // Goblins always to the right of the seat in a tight formation
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const offsetX = 3 + col * 0.9 + pseudoRand * 0.4;
    const offsetY = (row - 0.5) * 1.1 + (pseudoRand2 - 0.5) * 0.4;
    const rawX = (seatX + offsetX) * tileSize + tileSize / 2;
    const rawY = (seatY + offsetY) * tileSize + tileSize / 2;
    // Clamp to map bounds (keep 1 tile margin) — use largest available map
    const largestMap = template.maps.large || template.maps.medium || template.maps.small;
    const mapW = largestMap.mapSize[0] * tileSize;
    const mapH = largestMap.mapSize[1] * tileSize;
    const ex = Math.max(tileSize, Math.min(mapW - tileSize, rawX));
    const ey = Math.max(tileSize, Math.min(mapH - tileSize, rawY));

    // Every 4th goblin is TNT, rest are torch
    const enemySprite = (idx % 5 === 4 && template.sprites['goblin-tnt']) ? 'goblin-tnt' : 'goblin';

    char.enemies.push({
      spriteKey: enemySprite,
      x: ex,
      y: ey,
      baseX: ex,
      baseY: ey,
      animFrame: 0,
      animTimer: Math.random() * 0.5,
      currentAnim: 'idle',
      markedForRemoval: false,
    });
  }

  // Despawn excess
  while (char.enemies.length > targetCount) {
    char.enemies.pop();
  }

  // Note: spriteKey is set per-enemy at creation time (torch/tnt pattern)
  // Don't override individual enemy types here
}

// ── Name Resolution ──

export interface NameConfig {
  avatarName?: string;
  agentTypeNames?: Record<string, string>;
}

export function resolveCharacterName(
  agentType: string | null,
  config: NameConfig,
  template: TemplateConfig,
): string {
  // Main agent
  if (!agentType) {
    return config.avatarName || 'Agent';
  }

  // User override
  if (config.agentTypeNames?.[agentType]) {
    return config.agentTypeNames[agentType];
  }

  // Template mapping
  if (template.agentTypes[agentType]) {
    return template.agentTypes[agentType].name;
  }

  // Template default
  if (template.agentTypes.default) {
    return template.agentTypes.default.name;
  }

  // Raw type from Claude Code
  return agentType;
}

export function getUniqueName(baseName: string, existingNames: string[]): string {
  if (!existingNames.includes(baseName)) return baseName;
  let i = 2;
  while (existingNames.includes(`${baseName} ${i}`)) i++;
  return `${baseName} ${i}`;
}

// ── Helpers ──

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pickRandomWalkableTile(
  activeMap: MapDef,
  occupied: Set<string>,
  nearX?: number,
  nearY?: number,
): Position | null {
  const [cols, rows] = activeMap.mapSize;
  const candidates: Position[] = [];
  const WANDER_RADIUS = 5;

  // If near position provided, only pick tiles within radius
  const minX = nearX !== undefined ? Math.max(1, nearX - WANDER_RADIUS) : 1;
  const maxX = nearX !== undefined ? Math.min(cols - 2, nearX + WANDER_RADIUS) : cols - 2;
  const minY = nearY !== undefined ? Math.max(1, nearY - WANDER_RADIUS) : 1;
  const maxY = nearY !== undefined ? Math.min(rows - 2, nearY + WANDER_RADIUS) : rows - 2;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (activeMap.walkable[y]?.[x] && !occupied.has(`${x},${y}`)) {
        candidates.push({ x, y });
      }
    }
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
