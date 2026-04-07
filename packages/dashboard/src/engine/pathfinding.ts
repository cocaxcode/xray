import type { Position } from './types';

interface Node {
  x: number;
  y: number;
  g: number; // cost from start
  h: number; // heuristic to end
  f: number; // g + h
  parent: Node | null;
}

const DIRECTIONS: Position[] = [
  { x: 0, y: -1 }, // up
  { x: 0, y: 1 },  // down
  { x: -1, y: 0 }, // left
  { x: 1, y: 0 },  // right
];

function manhattan(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function posKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * A* pathfinding on a walkable grid.
 * Returns array of positions from start to end (exclusive of start).
 * Returns empty array if no path exists or start === end.
 * Occupied tiles are treated as non-walkable.
 */
export function findPath(
  walkable: boolean[][],
  start: Position,
  end: Position,
  occupied: Set<string>,
): Position[] {
  if (start.x === end.x && start.y === end.y) return [];

  const rows = walkable.length;
  const cols = walkable[0]?.length ?? 0;

  // Validate bounds
  if (end.y < 0 || end.y >= rows || end.x < 0 || end.x >= cols) return [];
  if (!walkable[end.y][end.x]) return [];

  const open: Node[] = [];
  const closed = new Set<string>();

  const startNode: Node = {
    x: start.x,
    y: start.y,
    g: 0,
    h: manhattan(start, end),
    f: manhattan(start, end),
    parent: null,
  };

  open.push(startNode);

  while (open.length > 0) {
    // Find node with lowest f
    let lowestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[lowestIdx].f) lowestIdx = i;
    }

    const current = open.splice(lowestIdx, 1)[0];
    const key = posKey(current.x, current.y);

    if (current.x === end.x && current.y === end.y) {
      // Reconstruct path
      const path: Position[] = [];
      let node: Node | null = current;
      while (node && !(node.x === start.x && node.y === start.y)) {
        path.unshift({ x: node.x, y: node.y });
        node = node.parent;
      }
      return path;
    }

    closed.add(key);

    for (const dir of DIRECTIONS) {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;
      const nKey = posKey(nx, ny);

      // Bounds check
      if (ny < 0 || ny >= rows || nx < 0 || nx >= cols) continue;

      // Walkable check
      if (!walkable[ny][nx]) continue;

      // Skip occupied (except destination — allow walking to occupied end tile)
      if (occupied.has(nKey) && !(nx === end.x && ny === end.y)) continue;

      // Skip already closed
      if (closed.has(nKey)) continue;

      const g = current.g + 1;
      const h = manhattan({ x: nx, y: ny }, end);

      // Check if already in open with better g
      const existingIdx = open.findIndex(n => n.x === nx && n.y === ny);
      if (existingIdx >= 0 && open[existingIdx].g <= g) continue;

      if (existingIdx >= 0) {
        open.splice(existingIdx, 1);
      }

      open.push({
        x: nx,
        y: ny,
        g,
        h,
        f: g + h,
        parent: current,
      });
    }
  }

  // No path found
  return [];
}

/**
 * Find nearest walkable tile to target that is not occupied.
 * Searches in expanding rings (BFS) from target.
 */
export function findNearestWalkable(
  walkable: boolean[][],
  target: Position,
  occupied: Set<string>,
): Position | null {
  const rows = walkable.length;
  const cols = walkable[0]?.length ?? 0;
  const visited = new Set<string>();
  const queue: Position[] = [target];

  while (queue.length > 0) {
    const pos = queue.shift()!;
    const key = posKey(pos.x, pos.y);

    if (visited.has(key)) continue;
    visited.add(key);

    if (
      pos.y >= 0 && pos.y < rows &&
      pos.x >= 0 && pos.x < cols &&
      walkable[pos.y][pos.x] &&
      !occupied.has(key)
    ) {
      return pos;
    }

    for (const dir of DIRECTIONS) {
      const nx = pos.x + dir.x;
      const ny = pos.y + dir.y;
      // Bounds check to prevent infinite BFS
      if (ny < 0 || ny >= rows || nx < 0 || nx >= cols) continue;
      if (!visited.has(posKey(nx, ny))) {
        queue.push({ x: nx, y: ny });
      }
    }
  }

  return null;
}
