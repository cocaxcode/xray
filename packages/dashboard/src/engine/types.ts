// ── Template Config (loaded from template.json) ──

export interface TemplateConfig {
  name: string;
  author: string;
  version: string;
  description?: string;
  tileSize: number;

  maps: {
    small: MapDef;   // 1-6 sessions
    medium: MapDef;  // 7-14 sessions
    large: MapDef;   // 15+ sessions
  };

  tiles: Record<string, TileDef>;
  sprites: Record<string, SpriteDef>;
  props: PropDef[];

  stateMap: Record<string, StateVisual>;
  toolAnimations: Record<string, string>;
  agentTypes: Record<string, AgentTypeVisual>;
  equipmentMap: Record<string, string>;
  environmentMap: Record<string, string>;
  enemyScaling: EnemyScaling;
}

export interface MapDef {
  mapSize: [number, number]; // [cols, rows]
  map: number[][];
  walkable: boolean[][];
  zones: {
    work: Position[];
    rest: Position[];
    spawn: Position[];
    exit: Position[];
  };
}

export interface TileDef {
  sheet: string;
  frameSize?: [number, number];
  frames?: number;
  region?: [number, number]; // [x, y] offset in tilemap sheet (64x64 sub-tile)
}

export interface SpriteDef {
  sheet: string;                              // single sheet with rows (legacy)
  frameSize: [number, number];
  animations: Record<string, AnimationDef>;
}

export interface AnimationDef {
  row: number;                                // row index in multi-row sheet
  frames: number;
  speed: number;  // seconds per frame
  loop?: boolean; // default true, false for death/oneshot
  sheet?: string; // per-animation sheet (overrides SpriteDef.sheet) — for sprite strips like Tiny Swords
}

export interface PropDef {
  sprite: string;
  x: number;
  y: number;
  animation?: string;
}

export interface Position {
  x: number;
  y: number;
}

export interface StateVisual {
  anim: string;
  zone?: string;
  bubble?: string;
  spawnEnemy?: boolean;
  enemySprite?: string;
}

export interface AgentTypeVisual {
  name: string;
  sprite: string;
}

export interface EnemyScaling {
  metric: 'totalTokens';
  thresholds: Array<{
    tokens: number;
    enemies: number;
    sprite: string;
  }>;
}

// ── Engine Runtime State ──

export enum CharacterState {
  SPAWNING = 'spawning',
  IDLE = 'idle',
  WALKING = 'walking',
  WORKING = 'working',
  DYING = 'dying',
}

export type Facing = 'up' | 'down' | 'left' | 'right';

export interface Character {
  id: string;
  sessionId: string;
  isCompanion: boolean;
  agentType?: string;

  // Visual
  spriteKey: string;
  name: string;
  hueShift: number;
  equipment: string | null;
  environmentMcps: string[];

  // Position (pixels)
  x: number;
  y: number;
  // Position (grid)
  tileX: number;
  tileY: number;

  // State
  state: CharacterState;
  targetState: CharacterState | null; // state to transition to after WALKING
  facing: Facing;

  // Animation
  currentAnim: string;
  animFrame: number;
  animTimer: number;

  // Movement
  path: Position[];
  moveProgress: number;
  walkSpeed: number; // tiles per second

  // Timers
  wanderTimer: number;
  spawnTimer: number;

  // Enemies (scales with tokens via enemyScaling)
  enemies: EnemyState[];

  // Topic / subtitle
  topic: string | null;

  // Assigned work seat (null if none)
  assignedSeat: Position | null;

  // Marked for removal after DYING animation completes
  markedForRemoval: boolean;
}

export interface EnemyState {
  spriteKey: string;
  x: number;
  y: number;
  baseX: number;  // home position (enemies return here after advancing)
  baseY: number;
  animFrame: number;
  animTimer: number;
  currentAnim: string;
  markedForRemoval: boolean;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  isDragging: boolean;
  dragStartX: number;
  dragStartY: number;
  dragStartCamX: number;
  dragStartCamY: number;
}

export interface GameState {
  characters: Map<string, Character>;
  template: TemplateConfig;
  activeMap: MapDef;
  images: Map<string, HTMLImageElement>;
  occupiedSeats: Set<string>; // "x,y" strings
  seatQueue: string[];        // character IDs waiting for a seat
  camera: Camera;
}

// ── Template Metadata (from GET /api/templates) ──

export interface TemplateMeta {
  name: string;
  author: string;
  version: string;
  description: string;
  tileSize: number;
  preview: string;
}
