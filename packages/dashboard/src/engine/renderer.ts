import type { GameState, Character, EnemyState, TemplateConfig, MapDef, PropDef } from './types';
import { CharacterState } from './types';
import { applyCamera, resetCamera } from './camera';
import { getHueShiftedSprite } from './spriteLoader';

interface Drawable {
  y: number;
  draw: () => void;
}

// ── Shared MCP color assignment (consistent between renderer and legend) ──

const MCP_CRYSTAL_CYCLE = ['crystal-blue', 'crystal-red', 'crystal-green', 'crystal-purple', 'portal'];
const mcpSpriteCache = new Map<string, string>();
let mcpSpriteIdx = 0;

export function getMcpSpriteKey(mcpName: string, template: TemplateConfig): string {
  // First check template environmentMap
  if (template.environmentMap[mcpName]) return template.environmentMap[mcpName];

  // Otherwise assign a consistent color from the cycle
  if (!mcpSpriteCache.has(mcpName)) {
    mcpSpriteCache.set(mcpName, MCP_CRYSTAL_CYCLE[mcpSpriteIdx % MCP_CRYSTAL_CYCLE.length]);
    mcpSpriteIdx++;
  }
  return mcpSpriteCache.get(mcpName)!;
}

// ── Main Render ──

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
): void {
  const { template, activeMap, characters, images, camera } = state;
  const tileSize = template.tileSize;

  // Get CSS dimensions (not canvas pixel dimensions which include DPR)
  const cssWidth = ctx.canvas.getBoundingClientRect().width;
  const cssHeight = ctx.canvas.getBoundingClientRect().height;

  // Clear entire canvas with water/background color
  ctx.fillStyle = '#3a6b8a';
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  // Apply camera transform
  applyCamera(ctx, camera);

  // Fill exact map area with grass color (under tiles)
  const [mapCols, mapRows] = activeMap.mapSize;
  ctx.fillStyle = '#4a7c59';
  ctx.fillRect(0, 0, mapCols * tileSize, mapRows * tileSize);

  // 1. Tiles
  drawTileMap(ctx, template, activeMap, images, tileSize);

  // 2. Collect drawables (props + characters + enemies + environment)
  const drawables: Drawable[] = [];

  // Static props
  for (const prop of template.props) {
    const py = prop.y * tileSize;
    drawables.push({
      y: py,
      draw: () => drawProp(ctx, images, template, prop, tileSize),
    });
  }

  // Random decorations (drawn on ground — characters walk OVER them)
  for (const prop of state.randomProps) {
    drawProp(ctx, images, template, prop, tileSize);
  }

  // Goblin camps: dirt patch + house (drawn before characters)
  for (const char of characters.values()) {
    if (!char.isCompanion && char.enemies.length > 0) {
      let gx = 0, gy = 0;
      for (const e of char.enemies) { gx += e.baseX; gy += e.baseY; }
      gx /= char.enemies.length;
      gy /= char.enemies.length;

      // Draw dirt patch as smooth filled ellipse with pattern
      const tilemapImg = images.get('tile:1');
      if (tilemapImg) {
        const sandRegion = template.tiles['1']?.region;
        if (sandRegion) {
          // Create sand pattern from tile
          const patternCanvas = document.createElement('canvas');
          patternCanvas.width = 64;
          patternCanvas.height = 64;
          const pctx = patternCanvas.getContext('2d')!;
          pctx.drawImage(tilemapImg, sandRegion[0], sandRegion[1], 64, 64, 0, 0, 64, 64);
          const pattern = ctx.createPattern(patternCanvas, 'repeat');

          if (pattern) {
            ctx.save();
            ctx.beginPath();
            const rx = tileSize * 2.2;
            const ry = tileSize * 1.5;
            // Irregular edge using many points with noise
            const points = 40;
            for (let i = 0; i <= points; i++) {
              const angle = (i / points) * Math.PI * 2;
              // Noise per point for bumpy edge
              const seed = Math.sin(gx * 0.1 + angle * 3) * 0.15
                         + Math.sin(gy * 0.1 + angle * 5) * 0.1
                         + Math.sin(angle * 7) * 0.08;
              const r = 1 + seed;
              const px = gx + Math.cos(angle) * rx * r;
              const py = gy + Math.sin(angle) * ry * r;
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fillStyle = pattern;
            ctx.fill();
            ctx.restore();
          }
        }
      }

      // Draw goblin house above
      const houseImg = images.get('sprite:goblin-house');
      if (houseImg) {
        const houseW = tileSize * 1.2;
        const houseH = tileSize * 1.8;
        drawables.push({
          y: gy - tileSize,
          draw: () => {
            ctx.drawImage(houseImg, 0, 0, 128, 192, gx - houseW / 2, gy - houseH - tileSize * 0.5, houseW, houseH);
          },
        });
      }
    }
  }

  // Characters + their enemies + environment
  for (const char of characters.values()) {
    drawables.push({
      y: char.y,
      draw: () => {
        drawCharacter(ctx, images, template, char, tileSize);
        if (char.equipment) {
          drawEquipment(ctx, images, template, char, tileSize);
        }
        for (const enemy of char.enemies) {
          if (!enemy.markedForRemoval) {
            drawEnemy(ctx, images, template, enemy, tileSize, char.x);
          }
        }
        // MCP crystals floating around character
        for (let mi = 0; mi < char.environmentMcps.length; mi++) {
          const mcpKey = char.environmentMcps[mi];
          const angle = (mi * Math.PI * 2) / char.environmentMcps.length + Date.now() / 3000;
          const radius = tileSize * 0.6;
          const mx = char.x + Math.cos(angle) * radius;
          const my = char.y - tileSize * 0.5 + Math.sin(angle) * radius * 0.3;
          drawEnvironment(ctx, images, template, mx, my, mcpKey, tileSize);
        }
      },
    });

  }

  // 3. Sort by Y (lower Y = further from camera = drawn first)
  drawables.sort((a, b) => a.y - b.y);

  // 4. Draw all
  for (const d of drawables) d.draw();

  // 5. Name labels (drawn last, always on top)
  for (const char of characters.values()) {
    drawNameLabel(ctx, char, tileSize);
  }

  // 6. Empty state
  if (characters.size === 0) {
    drawEmptyState(ctx, activeMap, tileSize);
  }

  // Reset camera transform
  resetCamera(ctx);
}

// ── Tile Map ──

function drawTileMap(
  ctx: CanvasRenderingContext2D,
  template: TemplateConfig,
  activeMap: MapDef,
  images: Map<string, HTMLImageElement>,
  tileSize: number,
): void {
  const [cols, rows] = activeMap.mapSize;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tileId = activeMap.map[row]?.[col];
      if (tileId === undefined) continue;

      const tileDef = template.tiles[String(tileId)];
      if (!tileDef) {
        // Fallback: draw colored rectangle
        ctx.fillStyle = tileId === 0 ? '#4a7c59' : '#6b5b3e';
        ctx.fillRect(col * tileSize, row * tileSize, tileSize, tileSize);
        continue;
      }

      const img = images.get(`tile:${tileId}`);
      if (img) {
        if (tileDef.region) {
          // Draw sub-region from tilemap sheet
          const [rx, ry] = tileDef.region;
          ctx.drawImage(img, rx, ry, 64, 64, col * tileSize, row * tileSize, tileSize, tileSize);
        } else {
          ctx.drawImage(img, col * tileSize, row * tileSize, tileSize, tileSize);
        }
      } else {
        ctx.fillStyle = '#4a7c59';
        ctx.fillRect(col * tileSize, row * tileSize, tileSize, tileSize);
      }
    }
  }
}

// ── Character ──

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  images: Map<string, HTMLImageElement>,
  template: TemplateConfig,
  char: Character,
  tileSize: number,
): void {
  const sprite = template.sprites[char.spriteKey];
  if (!sprite) return;

  const img = images.get(`sprite:${char.spriteKey}`);
  if (!img) return;

  const anim = sprite.animations[char.currentAnim];
  if (!anim) return;

  const [frameW, frameH] = sprite.frameSize;

  // Per-animation sheet (Tiny Swords format) or multi-row sheet
  let srcImg = img;
  let srcX: number;
  let srcY: number;

  if (anim.sheet) {
    // Sprite strip: single row, frames side by side
    const animImg = images.get(`sprite:${char.spriteKey}:${char.currentAnim}`);
    if (animImg) srcImg = animImg;
    srcX = char.animFrame * frameW;
    srcY = 0;
  } else {
    // Multi-row sheet
    srcX = char.animFrame * frameW;
    srcY = anim.row * frameH;
  }

  // Apply hue shift — include animation name in cache key to avoid cross-animation conflicts
  const hueKey = anim.sheet ? `${char.spriteKey}:${char.currentAnim}` : char.spriteKey;
  const source = getHueShiftedSprite(srcImg, hueKey, char.hueShift);

  // Flip horizontally based on facing direction
  // Sprites face right by default — flip for left
  const flipX = char.facing === 'left';

  // Spawn effect (fade in)
  if (char.state === CharacterState.SPAWNING) {
    ctx.globalAlpha = 1 - (char.spawnTimer / 0.5);
  }

  // Dying effect (fade out)
  if (char.state === CharacterState.DYING) {
    const sp2 = template.sprites[char.spriteKey];
    const deathAnim = sp2?.animations.death;
    if (deathAnim && deathAnim.frames > 0) {
      ctx.globalAlpha = 1 - (char.animFrame / (deathAnim.frames - 1));
    }
  }

  ctx.save();
  if (flipX) {
    ctx.translate(char.x, char.y);
    ctx.scale(-1, 1);
    ctx.drawImage(source, srcX, srcY, frameW, frameH, -tileSize / 2, -tileSize / 2, tileSize, tileSize);
  } else {
    ctx.drawImage(source, srcX, srcY, frameW, frameH, char.x - tileSize / 2, char.y - tileSize / 2, tileSize, tileSize);
  }
  ctx.restore();

  ctx.globalAlpha = 1;
}

// ── Equipment Overlay ──

function drawEquipment(
  ctx: CanvasRenderingContext2D,
  images: Map<string, HTMLImageElement>,
  template: TemplateConfig,
  char: Character,
  tileSize: number,
): void {
  if (!char.equipment) return;

  const img = images.get(`sprite:${char.equipment}`);
  if (!img) return;

  const sprite = template.sprites[char.equipment];
  if (!sprite) return;

  const anim = sprite.animations.idle || Object.values(sprite.animations)[0];
  if (!anim) return;

  const [frameW, frameH] = sprite.frameSize;
  const srcX = 0; // Equipment shows first frame
  const srcY = anim.row * frameH;

  // Draw offset from character (weapon position)
  const offsetX = tileSize * 0.3;
  const offsetY = -tileSize * 0.1;

  ctx.drawImage(
    img,
    srcX, srcY, frameW, frameH,
    char.x - tileSize / 4 + offsetX,
    char.y - tileSize / 2 + offsetY,
    tileSize * 0.6,
    tileSize * 0.6,
  );
}

// ── Enemy ──

function drawEnemy(
  ctx: CanvasRenderingContext2D,
  images: Map<string, HTMLImageElement>,
  template: TemplateConfig,
  enemy: EnemyState,
  tileSize: number,
  targetX?: number,
): void {
  const sprite = template.sprites[enemy.spriteKey];
  if (!sprite) return;

  const anim = sprite.animations[enemy.currentAnim] || sprite.animations.idle;
  if (!anim) return;

  // Per-animation sheet or multi-row sheet
  let srcImg: HTMLImageElement | HTMLCanvasElement | undefined;
  let srcX: number;
  let srcY: number;

  if (anim.sheet) {
    srcImg = images.get(`sprite:${enemy.spriteKey}:${enemy.currentAnim}`);
    srcX = enemy.animFrame * sprite.frameSize[0];
    srcY = 0;
  } else {
    srcImg = images.get(`sprite:${enemy.spriteKey}`);
    srcX = enemy.animFrame * sprite.frameSize[0];
    srcY = anim.row * sprite.frameSize[1];
  }

  if (!srcImg) {
    // Fallback: try default key
    srcImg = images.get(`sprite:${enemy.spriteKey}`);
  }

  if (!srcImg) {
    return;
  }

  const [frameW, frameH] = sprite.frameSize;

  // Enemies render at 80% of tile size
  const enemySize = tileSize * 0.8;

  // Flip to face the warrior — sprites face right by default
  const flipX = targetX !== undefined && targetX < enemy.x;

  ctx.save();
  if (flipX) {
    ctx.translate(enemy.x, enemy.y);
    ctx.scale(-1, 1);
    ctx.drawImage(srcImg, srcX, srcY, frameW, frameH, -enemySize / 2, -enemySize / 2, enemySize, enemySize);
  } else {
    ctx.drawImage(srcImg, srcX, srcY, frameW, frameH, enemy.x - enemySize / 2, enemy.y - enemySize / 2, enemySize, enemySize);
  }
  ctx.restore();
}

// ── Environmental (MCPs) ──

function drawEnvironment(
  ctx: CanvasRenderingContext2D,
  images: Map<string, HTMLImageElement>,
  template: TemplateConfig,
  x: number,
  y: number,
  mcpKey: string,
  tileSize: number,
): void {
  // Look up environment sprite key — use consistent color per MCP
  const spriteKey = getMcpSpriteKey(mcpKey, template);
  const img = images.get(`sprite:${spriteKey}`);
  if (!img) return;

  const sprite = template.sprites[spriteKey];
  if (!sprite) return;

  const anim = sprite.animations.idle || Object.values(sprite.animations)[0];
  if (!anim) return;

  const [frameW, frameH] = sprite.frameSize;
  const frame = Math.floor(Date.now() / 200) % anim.frames; // auto-animate
  const srcX = frame * frameW;
  const srcY = anim.row * frameH;

  const size = tileSize * 0.25;
  // Slight pulsing glow effect
  const pulse = 0.7 + Math.sin(Date.now() / 500) * 0.3;
  ctx.globalAlpha = pulse;
  ctx.drawImage(img, srcX, srcY, frameW, frameH, x - size / 2, y - size / 2, size, size);
  ctx.globalAlpha = 1;
}

// ── Props ──

function drawProp(
  ctx: CanvasRenderingContext2D,
  images: Map<string, HTMLImageElement>,
  template: TemplateConfig,
  prop: PropDef,
  tileSize: number,
): void {
  const sprite = template.sprites[prop.sprite];
  if (!sprite) return;

  const img = images.get(`sprite:${prop.sprite}`);
  if (!img) return;

  const animName = prop.animation || Object.keys(sprite.animations)[0];
  const anim = sprite.animations[animName];
  if (!anim) return;

  const [frameW, frameH] = sprite.frameSize;
  const frame = anim.frames > 1
    ? Math.floor(Date.now() / (anim.speed * 1000)) % anim.frames
    : 0;
  const srcX = frame * frameW;
  const srcY = anim.row * frameH;

  // Draw props at half tile size, centered on tile
  const propSize = tileSize * 0.5;
  const offsetX = (tileSize - propSize) / 2;
  const offsetY = (tileSize - propSize) / 2;
  ctx.drawImage(
    img,
    srcX, srcY, frameW, frameH,
    prop.x * tileSize + offsetX, prop.y * tileSize + offsetY, propSize, propSize,
  );
}

// ── Name Label ──

function drawNameLabel(
  ctx: CanvasRenderingContext2D,
  char: Character,
  tileSize: number,
): void {
  const fontSize = Math.max(8, tileSize * 0.18);
  const subtitleSize = Math.max(7, tileSize * 0.14);

  ctx.textAlign = 'center';

  // Main label (project name or character name)
  const mainText = char.name;
  ctx.font = `bold ${fontSize}px monospace`;
  const mainMetrics = ctx.measureText(mainText);

  const labelY = char.y + tileSize / 2 + fontSize + 2;
  const padding = 3;

  // Subtitle (topic)
  const subtitle = char.topic || undefined;
  let totalHeight = fontSize + padding;
  let maxWidth = mainMetrics.width;

  if (subtitle) {
    ctx.font = `${subtitleSize}px monospace`;
    const subMetrics = ctx.measureText(subtitle.length > 30 ? subtitle.slice(0, 30) + '...' : subtitle);
    maxWidth = Math.max(maxWidth, subMetrics.width);
    totalHeight += subtitleSize + 2;
  }

  // Dark background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.fillRect(
    char.x - maxWidth / 2 - padding,
    labelY - fontSize - 1,
    maxWidth + padding * 2,
    totalHeight + 2,
  );

  // Main text
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.fillStyle = '#E4E4E7';
  ctx.fillText(mainText, char.x, labelY);

  // Subtitle
  if (subtitle) {
    ctx.font = `${subtitleSize}px monospace`;
    ctx.fillStyle = '#00F5D4';
    const displaySub = subtitle.length > 30 ? subtitle.slice(0, 30) + '...' : subtitle;
    ctx.fillText(displaySub, char.x, labelY + subtitleSize + 2);
  }
}

// ── Empty State ──

function drawEmptyState(
  ctx: CanvasRenderingContext2D,
  activeMap: MapDef,
  tileSize: number,
): void {
  const [cols, rows] = activeMap.mapSize;
  const centerX = (cols * tileSize) / 2;
  const centerY = (rows * tileSize) / 2;

  // Pulsing alpha
  const alpha = 0.4 + Math.sin(Date.now() / 800) * 0.3;
  ctx.globalAlpha = alpha;
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#E4E4E7';
  ctx.fillText('Esperando agentes...', centerX, centerY);
  ctx.globalAlpha = 1;
}
