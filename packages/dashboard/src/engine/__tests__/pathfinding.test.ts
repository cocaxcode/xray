import { describe, it, expect } from 'vitest';
import { findPath, findNearestWalkable } from '../pathfinding';

// Helper: create walkable grid (true = walkable)
function grid(rows: boolean[][]): boolean[][] {
  return rows;
}

const OPEN_4x4 = grid([
  [true, true, true, true],
  [true, true, true, true],
  [true, true, true, true],
  [true, true, true, true],
]);

describe('findPath (A*)', () => {
  it('finds straight horizontal path', () => {
    const path = findPath(OPEN_4x4, { x: 0, y: 0 }, { x: 3, y: 0 }, new Set());
    expect(path.length).toBe(3);
    expect(path[0]).toEqual({ x: 1, y: 0 });
    expect(path[2]).toEqual({ x: 3, y: 0 });
  });

  it('finds straight vertical path', () => {
    const path = findPath(OPEN_4x4, { x: 0, y: 0 }, { x: 0, y: 3 }, new Set());
    expect(path.length).toBe(3);
    expect(path[2]).toEqual({ x: 0, y: 3 });
  });

  it('finds L-shaped path around wall', () => {
    const walled = grid([
      [true, false, true],
      [true, false, true],
      [true, true,  true],
    ]);
    const path = findPath(walled, { x: 0, y: 0 }, { x: 2, y: 0 }, new Set());
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toEqual({ x: 2, y: 0 });
    // Must go around the wall via row 2
    expect(path.some(p => p.y === 2)).toBe(true);
  });

  it('returns empty array when path is blocked', () => {
    const blocked = grid([
      [true, false, true],
      [false, false, true],
      [true, true,  true],
    ]);
    const path = findPath(blocked, { x: 0, y: 0 }, { x: 2, y: 0 }, new Set());
    expect(path).toEqual([]);
  });

  it('returns empty array when start equals end', () => {
    const path = findPath(OPEN_4x4, { x: 1, y: 1 }, { x: 1, y: 1 }, new Set());
    expect(path).toEqual([]);
  });

  it('avoids occupied tiles', () => {
    const occupied = new Set(['1,0', '2,0']);
    const path = findPath(OPEN_4x4, { x: 0, y: 0 }, { x: 3, y: 0 }, occupied);
    expect(path.length).toBeGreaterThan(0);
    // Should not pass through occupied tiles
    for (const p of path.slice(0, -1)) {
      expect(occupied.has(`${p.x},${p.y}`)).toBe(false);
    }
  });

  it('allows walking to occupied destination', () => {
    const occupied = new Set(['3,0']);
    const path = findPath(OPEN_4x4, { x: 0, y: 0 }, { x: 3, y: 0 }, occupied);
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toEqual({ x: 3, y: 0 });
  });

  it('returns empty array for out-of-bounds destination', () => {
    const path = findPath(OPEN_4x4, { x: 0, y: 0 }, { x: 10, y: 10 }, new Set());
    expect(path).toEqual([]);
  });

  it('returns empty array when destination is non-walkable', () => {
    const walled = grid([
      [true, false],
      [true, true],
    ]);
    const path = findPath(walled, { x: 0, y: 0 }, { x: 1, y: 0 }, new Set());
    expect(path).toEqual([]);
  });

  it('does not use diagonal movement', () => {
    const path = findPath(OPEN_4x4, { x: 0, y: 0 }, { x: 1, y: 1 }, new Set());
    expect(path.length).toBe(2); // Must go via (1,0) or (0,1), not diagonal
  });
});

describe('findNearestWalkable', () => {
  it('returns target if walkable and unoccupied', () => {
    const result = findNearestWalkable(OPEN_4x4, { x: 2, y: 2 }, new Set());
    expect(result).toEqual({ x: 2, y: 2 });
  });

  it('returns adjacent tile if target is occupied', () => {
    const occupied = new Set(['2,2']);
    const result = findNearestWalkable(OPEN_4x4, { x: 2, y: 2 }, occupied);
    expect(result).not.toBeNull();
    expect(result).not.toEqual({ x: 2, y: 2 });
    // Should be adjacent
    const dx = Math.abs(result!.x - 2);
    const dy = Math.abs(result!.y - 2);
    expect(dx + dy).toBe(1);
  });

  it('returns null if all tiles occupied or non-walkable', () => {
    const tiny = grid([[false]]);
    const result = findNearestWalkable(tiny, { x: 0, y: 0 }, new Set());
    expect(result).toBeNull();
  });
});
