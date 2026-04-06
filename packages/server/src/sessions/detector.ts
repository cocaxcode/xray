import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONTEXT_WEIGHTS, CONTEXT_MAX_UNITS, CONTEXT_COMPACT_RESET } from '../types.js';
import type { McpServer } from '../types.js';

/**
 * Parsea tool names con formato mcp__servidor__herramienta
 */
export function parseMcpToolName(toolName: string): { server: string; tool: string } | null {
  if (!toolName.startsWith('mcp__')) return null;
  const parts = toolName.split('__');
  if (parts.length < 3) return null;
  return { server: parts[1], tool: parts.slice(2).join('__') };
}

/**
 * Actualiza la lista de MCPs de una sesion basandose en un tool call
 */
export function updateMcps(
  currentMcps: McpServer[],
  toolName: string,
  success: boolean
): McpServer[] {
  const parsed = parseMcpToolName(toolName);
  if (!parsed) return currentMcps;

  const existingIdx = currentMcps.findIndex(m => m.name === parsed.server);

  if (existingIdx >= 0) {
    const existing = currentMcps[existingIdx];
    const updated: McpServer = {
      name: existing.name,
      toolsUsed: existing.toolsUsed.includes(parsed.tool)
        ? [...existing.toolsUsed]
        : [...existing.toolsUsed, parsed.tool],
      status: !success ? 'error' : existing.status,
    };
    const mcps = [...currentMcps];
    mcps[existingIdx] = updated;
    return mcps;
  }

  const mcps = [...currentMcps];
  mcps.push({
    name: parsed.server,
    status: success ? 'connected' : 'error',
    toolsUsed: [parsed.tool],
  });

  return mcps;
}

/**
 * Calcula el incremento de contexto estimado basado en el tipo de tool
 */
export function calculateContextIncrement(toolName: string): number {
  const baseName = parseMcpToolName(toolName)?.tool ?? toolName;
  const weight = CONTEXT_WEIGHTS[baseName] ?? CONTEXT_WEIGHTS.default;
  return (weight / CONTEXT_MAX_UNITS) * 100;
}

/**
 * Devuelve el porcentaje de contexto despues de una compactacion
 */
export function getCompactResetPercent(): number {
  return CONTEXT_COMPACT_RESET;
}

/**
 * Detecta skills disponibles en un directorio de proyecto
 */
export function detectSkills(cwd: string): string[] {
  const skills: string[] = [];

  // .claude/skills/
  const skillsDir = join(cwd, '.claude', 'skills');
  if (existsSync(skillsDir)) {
    try {
      const entries = readdirSync(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('_')) {
          skills.push(entry.name);
        }
      }
    } catch {
      // Directorio no accesible
    }
  }

  return skills;
}
