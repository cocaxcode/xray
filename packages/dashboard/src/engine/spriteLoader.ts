import type { TemplateConfig } from './types';

// ── Image Cache ──

const imageCache = new Map<string, HTMLImageElement>();

export function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(url, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/**
 * Preload all sprite sheet PNGs referenced in a template.
 * Returns a Map of sprite key → HTMLImageElement.
 * Calls onProgress(0-100) as images load.
 */
export async function preloadAll(
  template: TemplateConfig,
  basePath: string,
  onProgress?: (percent: number) => void,
): Promise<Map<string, HTMLImageElement>> {
  const images = new Map<string, HTMLImageElement>();
  const urls = new Map<string, string>(); // key → url

  // Collect all sprite sheet URLs
  for (const [key, sprite] of Object.entries(template.sprites)) {
    urls.set(`sprite:${key}`, `${basePath}/assets/${sprite.sheet}`);

    // Per-animation sheets (Tiny Swords format: each anim is a separate PNG)
    for (const [animName, anim] of Object.entries(sprite.animations)) {
      if (anim.sheet) {
        urls.set(`sprite:${key}:${animName}`, `${basePath}/assets/${anim.sheet}`);
      }
    }
  }

  for (const [key, tile] of Object.entries(template.tiles)) {
    urls.set(`tile:${key}`, `${basePath}/assets/${tile.sheet}`);
  }

  const entries = Array.from(urls.entries());
  const total = entries.length;
  let loaded = 0;

  // Debug: log all sprite keys being loaded
  console.log('[spriteLoader] Loading', total, 'sprites:', Array.from(urls.keys()).join(', '));

  const promises = entries.map(async ([key, url]) => {
    const img = await loadImage(url);
    images.set(key, img);
    loaded++;
    onProgress?.(Math.round((loaded / total) * 100));
  });

  await Promise.all(promises);
  return images;
}

// ── Hue Shift ──

const hueCache = new Map<string, HTMLCanvasElement>();

/**
 * Apply hue shift to a sprite image.
 * Returns a canvas element that can be used as drawImage source.
 * Results are cached by spriteKey:hueShift.
 */
export function getHueShiftedSprite(
  img: HTMLImageElement,
  spriteKey: string,
  hueShift: number,
): HTMLCanvasElement | HTMLImageElement {
  if (hueShift === 0) return img;

  const cacheKey = `${spriteKey}:${hueShift}`;
  const cached = hueCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue; // skip transparent

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const [h, s, l] = rgbToHsl(r, g, b);
    const [nr, ng, nb] = hslToRgb((h + hueShift / 360) % 1, s, l);

    data[i] = nr;
    data[i + 1] = ng;
    data[i + 2] = nb;
  }

  ctx.putImageData(imageData, 0, 0);
  hueCache.set(cacheKey, canvas);
  return canvas;
}

// ── HSL Helpers ──

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return [
    Math.round(hue2rgb(p, q, h + 1/3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1/3) * 255),
  ];
}
