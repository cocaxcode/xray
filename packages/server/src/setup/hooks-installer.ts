import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { XrayHookConfig } from '../types.js';

const XRAY_MARKER = 'localhost';

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

/**
 * Genera la configuracion de hooks para xray
 */
export function generateHookConfig(port: number): Record<string, XrayHookConfig[]> {
  const baseUrl = `http://localhost:${port}/api/hook`;

  const events: Array<{ name: string; timeout?: number }> = [
    { name: 'SessionStart' },
    { name: 'SessionEnd' },
    { name: 'PreToolUse' },
    { name: 'PostToolUse' },
    { name: 'PostToolUseFailure' },
    { name: 'PermissionRequest', timeout: 120 },
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
      hooks: [{
        type: 'http',
        url: `${baseUrl}/${slug}`,
        ...(event.timeout ? { timeout: event.timeout } : {}),
      }],
    };
    hooks[event.name] = [hookEntry];
  }

  return hooks;
}

/**
 * Verifica si los hooks de xray ya estan configurados
 */
export function isXrayConfigured(port: number): boolean {
  const settings = readSettings();
  const hooks = settings.hooks as Record<string, unknown[]> | undefined;
  if (!hooks) return false;

  const marker = `localhost:${port}/api/hook`;
  return JSON.stringify(hooks).includes(marker);
}

/**
 * Instala los hooks de xray en settings.json
 */
export function installHooks(port: number): { installed: boolean; message: string } {
  if (isXrayConfigured(port)) {
    return { installed: false, message: 'Hooks ya configurados' };
  }

  const settings = readSettings();
  backupSettings();

  if (!settings.hooks) {
    settings.hooks = {};
  }

  const xrayHooks = generateHookConfig(port);
  const existingHooks = settings.hooks as Record<string, unknown[]>;

  for (const [eventName, hookConfigs] of Object.entries(xrayHooks)) {
    if (!existingHooks[eventName]) {
      existingHooks[eventName] = [];
    }
    // Append xray hooks (don't touch existing ones)
    existingHooks[eventName].push(...hookConfigs);
  }

  writeSettings(settings);
  return { installed: true, message: `Hooks configurados para puerto ${port}` };
}

/**
 * Desinstala solo los hooks de xray (por URL pattern)
 */
export function uninstallHooks(port: number): { removed: number; message: string } {
  const settings = readSettings();
  const hooks = settings.hooks as Record<string, unknown[]> | undefined;
  if (!hooks) return { removed: 0, message: 'No hay hooks configurados' };

  backupSettings();

  const marker = `localhost:${port}/api/hook`;
  let removed = 0;

  for (const eventName of Object.keys(hooks)) {
    const before = hooks[eventName].length;
    hooks[eventName] = hooks[eventName].filter((entry) => {
      const str = JSON.stringify(entry);
      return !str.includes(marker);
    });
    removed += before - hooks[eventName].length;

    // Clean up empty arrays
    if (hooks[eventName].length === 0) {
      delete hooks[eventName];
    }
  }

  // Clean up empty hooks object
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
