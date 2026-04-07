import type { Camera, Position } from './types';

export function createCamera(): Camera {
  return {
    x: 0,
    y: 0,
    zoom: 1.0,
    minZoom: 0.5,
    maxZoom: 3.0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragStartCamX: 0,
    dragStartCamY: 0,
  };
}

export function applyCamera(ctx: CanvasRenderingContext2D, camera: Camera): void {
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);
}

export function resetCamera(ctx: CanvasRenderingContext2D): void {
  ctx.restore();
}

/**
 * Convert screen coordinates to world coordinates (invert camera transform).
 * Used for hit detection.
 */
export function screenToWorld(screenX: number, screenY: number, camera: Camera): Position {
  return {
    x: (screenX - camera.x) / camera.zoom,
    y: (screenY - camera.y) / camera.zoom,
  };
}

/**
 * Convert world coordinates to screen coordinates.
 * Used for positioning HTML overlays.
 */
export function worldToScreen(worldX: number, worldY: number, camera: Camera): Position {
  return {
    x: worldX * camera.zoom + camera.x,
    y: worldY * camera.zoom + camera.y,
  };
}

/**
 * Zoom centered on a specific screen position.
 * delta > 0 = zoom in, delta < 0 = zoom out.
 */
export function zoomAt(camera: Camera, screenX: number, screenY: number, delta: number): void {
  const zoomFactor = delta > 0 ? 1.1 : 0.9;
  const newZoom = Math.max(camera.minZoom, Math.min(camera.maxZoom, camera.zoom * zoomFactor));

  if (newZoom === camera.zoom) return;

  // Adjust position so zoom is centered on cursor
  const worldBefore = screenToWorld(screenX, screenY, camera);
  camera.zoom = newZoom;
  const worldAfter = screenToWorld(screenX, screenY, camera);

  camera.x += (worldAfter.x - worldBefore.x) * camera.zoom;
  camera.y += (worldAfter.y - worldBefore.y) * camera.zoom;
}

/**
 * Center camera on a world position.
 */
export function panTo(
  camera: Camera,
  worldX: number,
  worldY: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  camera.x = canvasWidth / 2 - worldX * camera.zoom;
  camera.y = canvasHeight / 2 - worldY * camera.zoom;
}

/**
 * Start a drag operation.
 */
export function startDrag(camera: Camera, screenX: number, screenY: number): void {
  camera.isDragging = true;
  camera.dragStartX = screenX;
  camera.dragStartY = screenY;
  camera.dragStartCamX = camera.x;
  camera.dragStartCamY = camera.y;
}

/**
 * Update camera position during drag.
 */
export function updateDrag(camera: Camera, screenX: number, screenY: number): void {
  if (!camera.isDragging) return;
  camera.x = camera.dragStartCamX + (screenX - camera.dragStartX);
  camera.y = camera.dragStartCamY + (screenY - camera.dragStartY);
}

/**
 * End a drag operation.
 */
export function endDrag(camera: Camera): void {
  camera.isDragging = false;
}
