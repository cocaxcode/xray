import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { XrayHookConfig } from '../types.js';

// Marker del formato nuevo (hooks type: "command")
const XRAY_COMMAND_MARKER = 'cxc-xray-hook';

// Marker del formato viejo (hooks type: "http") para migracion automatica
const XRAY_HTTP_MARKER = '/api/hook';

export function getSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

function readSettings(): Record<string, unknown> {
  const path = getSettingsPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

function writeSettings(settings: Record<string, unknown>): void {
  const path = getSettingsPath();
  const dir = join(homedir(), '.claude');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8');
}

function backupSettings(): void {
  const path = getSettingsPath();
  if (existsSync(path)) {
    copyFileSync(path, path + '.backup');
  }
}

function isXrayEntry(entry: unknown): boolean {
  const str = JSON.stringify(entry);
  return str.includes(XRAY_COMMAND_MARKER) || str.includes(XRAY_HTTP_MARKER);
}

/**
 * Genera la configuracion de hooks para xray (formato nuevo: type command)
 */
export function generateHookConfig(port: number): Record<string, XrayHookConfig[]> {
  const events: Array<{ name: string; timeout?: number }> = [
    { name: 'SessionStart' },
    { name: 'SessionEnd' },
    { name: 'PreToolUse' },
    { name: 'PostToolUse' },
    { name: 'PostToolUseFailure' },
    { name: 'PermissionRequest', timeout: 540 },
    { name: 'Notification' },
    { name: 'SubagentStart' },
    { name: 'SubagentStop' },
    { name: 'Stop' },
  ];

  const hooks: Record<string, XrayHookConfig[]> = {};

  for (const event of events) {
    const slug = event.name.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    const hookEntry: XrayHookConfig = {
      matcher: '',
      hooks: [
        {
          type: 'command',
          command: `cxc-xray-hook ${slug} ${port}`,
          ...(event.timeout ? { timeout: event.timeout } : {}),
        },
      ],
    };
    hooks[event.name] = [hookEntry];
  }

  return hooks;
}

/**
 * Verifica si los hooks de xray ya estan configurados en el formato nuevo.
 * El formato viejo (http) devuelve false para forzar migracion.
 */
export function isXrayConfigured(_port: number): boolean {
  const settings = readSettings();
  const hooks = settings.hooks as Record<string, unknown[]> | undefined;
  if (!hooks) return false;
  return JSON.stringify(hooks).includes(XRAY_COMMAND_MARKER);
}

/**
 * Limpia cualquier hook de xray (tanto formato viejo http como el nuevo command)
 * sin tocar los hooks de otras herramientas.
 */
function removeXrayHooks(hooks: Record<string, unknown[]>): number {
  let removed = 0;
  for (const eventName of Object.keys(hooks)) {
    const before = hooks[eventName].length;
    hooks[eventName] = hooks[eventName].filter((entry) => !isXrayEntry(entry));
    removed += before - hooks[eventName].length;
    if (hooks[eventName].length === 0) {
      delete hooks[eventName];
    }
  }
  return removed;
}

/**
 * Instala los hooks de xray en settings.json.
 * Si detecta hooks del formato viejo (http), los migra al formato nuevo.
 * Si ya estan en formato nuevo, no hace nada.
 */
export function installHooks(port: number): { installed: boolean; message: string; migrated: number } {
  const settings = readSettings();
  const settingsJson = JSON.stringify(settings.hooks ?? {});
  const hasNew = settingsJson.includes(XRAY_COMMAND_MARKER);
  const hasOld = settingsJson.includes(XRAY_HTTP_MARKER);

  if (hasNew && !hasOld) {
    return { installed: false, message: 'Hooks ya configurados (formato actual)', migrated: 0 };
  }

  backupSettings();

  if (!settings.hooks) {
    settings.hooks = {};
  }
  const existingHooks = settings.hooks as Record<string, unknown[]>;

  // Migracion: limpiar cualquier hook viejo o duplicado de xray
  const migrated = removeXrayHooks(existingHooks);

  // Instalar formato nuevo
  const xrayHooks = generateHookConfig(port);
  for (const [eventName, hookConfigs] of Object.entries(xrayHooks)) {
    if (!existingHooks[eventName]) {
      existingHooks[eventName] = [];
    }
    existingHooks[eventName].push(...hookConfigs);
  }

  writeSettings(settings);

  const message =
    migrated > 0
      ? `Migrados ${migrated} hooks del formato anterior al nuevo (type: command)`
      : `Hooks configurados para puerto ${port}`;

  return { installed: true, message, migrated };
}

/**
 * Desinstala todos los hooks de xray (tanto formato viejo como nuevo).
 */
export function uninstallHooks(_port: number): { removed: number; message: string } {
  const settings = readSettings();
  const hooks = settings.hooks as Record<string, unknown[]> | undefined;
  if (!hooks) return { removed: 0, message: 'No hay hooks configurados' };

  backupSettings();

  const removed = removeXrayHooks(hooks);

  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  }

  writeSettings(settings);
  return { removed, message: `${removed} hooks eliminados` };
}

/**
 * Lista los eventos que se configurarian
 */
export function getHookEventList(): string[] {
  return [
    'SessionStart', 'SessionEnd', 'PreToolUse', 'PostToolUse',
    'PostToolUseFailure', 'PermissionRequest', 'Notification',
    'SubagentStart', 'SubagentStop', 'Stop',
  ];
}
