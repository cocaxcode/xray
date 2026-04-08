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
  enemyScaling?: EnemyScaling;
  decorations?: DecorationConfig;

  // ── Template-agnostic config (optional, with sensible defaults) ──

  /** Canvas background colors */
  colors?: {
    background: string;   // outer area (water in warriors)
    ground: string;       // under-tile fill
    fallbackTile?: string; // fallback for non-zero tiles without image
  };

  /** Animation name mappings — allows templates to use custom anim names */
  animations?: {
    working: string;  // 'attack' in warriors, 'coding' in office, etc.
    death: string;    // 'death' in warriors, 'die' in others
  };

  /** Enemy camp visual config */
  enemyCamp?: {
    structure?: string;   // sprite key for camp building ('goblin-house' in warriors)
    groundTile?: string;  // tile key for dirt patch texture ('1' in warriors)
  };

  /** MCP environment sprite rotation — fallback cycle for unmapped MCPs */
  environmentCycle?: string[];

  /** Labels for character states in the legend */
  stateLabels?: Record<string, string>;

  /** Auto-generate random work zones instead of fixed positions */
  workZoneGen?: {
    count: number;          // max zones to generate
    minSpacing: number;     // min tiles between zones
    marginTop: number;      // tiles from top edge
    marginBottom: number;   // tiles from bottom edge
    marginSide: number;     // tiles from left/right edges
  };

  /** Gameplay mechanics — all optional with sensible defaults */
  mechanics?: MechanicsConfig;
}

export interface MechanicsConfig {
  // Movement
  walkSpeed?: number;          // tiles per second (default: 3)
  wanderMin?: number;          // min seconds between wanders (default: 2)
  wanderMax?: number;          // max seconds between wanders (default: 20)
  spawnDuration?: number;      // fade-in seconds (default: 0.5)

  // Combat positioning
  combatAdvanceMin?: number;   // character min advance toward enemies (default: 0.7 = 70%)
  combatAdvanceRange?: number; // oscillation range (default: 0.2 → 70-90%)
  enemyAdvance?: number;       // enemy advance toward character (default: 0.15 = 15%)

  // Enemy placement (relative to assigned seat)
  enemyOffsetX?: number;       // tiles to the right (default: 2)
  enemySpreadCols?: number;    // columns in formation (default: 3)
  enemySpreadRowH?: number;    // vertical spacing per row (default: 0.8)

  // Companion placement
  companionOffsetX?: number;   // tiles behind parent (default: -2, negative = left)

  // Render sizes
  characterScale?: number;     // character render size in tiles (default: 1, use 2 for small tiles)
  enemyScale?: number;         // enemy render size as fraction of character size (default: 0.8)
  mcpScale?: number;           // MCP crystal render size (default: 0.25)
  mcpOrbitRadius?: number;     // orbit distance from character (default: 0.6)
  campStructureW?: number;     // camp building width in tiles (default: 1.2)
  campStructureH?: number;     // camp building height in tiles (default: 1.8)
  campGroundRx?: number;       // dirt patch X radius in tiles (default: 2.2)
  campGroundRy?: number;       // dirt patch Y radius in tiles (default: 1.5)
}

export interface MapDef {
  mapSize: [number, number]; // [cols, rows]
  map: number[][];
  walkable: boolean[][];
  zones: {
    work: WorkPosition[];
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

export interface DecorationConfig {
  sprites: string[];   // sprite keys to randomly pick from
  count: number;       // how many to place
  margin: number;      // tiles from edge to avoid
}

export interface Position {
  x: number;
  y: number;
}

export type Facing = 'up' | 'down' | 'left' | 'right';

/** Work zone position with optional facing direction */
export interface WorkPosition extends Position {
  facing?: Facing;
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
  /** Enemy sprite variants to rotate between (e.g. ['goblin', 'goblin-tnt']) */
  variants?: string[];
}

// ── Engine Runtime State ──

export enum CharacterState {
  SPAWNING = 'spawning',
  IDLE = 'idle',
  WALKING = 'walking',
  WORKING = 'working',
  DYING = 'dying',
}

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
  assignedSeat: WorkPosition | null;

  // Marked for removal after DYING animation completes
  markedForRemoval: boolean;

  // Hidden from rendering (dismissed in legend, can be restored)
  hidden: boolean;
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
  randomProps: PropDef[];  // randomly generated decorations
  mouseWorldX?: number;    // mouse position in world coords (for hover effects)
  mouseWorldY?: number;
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
