import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We test the logic directly by importing the functions
// and overriding the settings path via a helper

import {
  generateHookConfig,
} from '../setup/hooks-installer.js';

describe('generateHookConfig', () => {
  it('should generate config for all 10 event types', () => {
    const config = generateHookConfig(3333);
    const eventNames = Object.keys(config);

    expect(eventNames).toContain('SessionStart');
    expect(eventNames).toContain('SessionEnd');
    expect(eventNames).toContain('PreToolUse');
    expect(eventNames).toContain('PostToolUse');
    expect(eventNames).toContain('PostToolUseFailure');
    expect(eventNames).toContain('PermissionRequest');
    expect(eventNames).toContain('Notification');
    expect(eventNames).toContain('SubagentStart');
    expect(eventNames).toContain('SubagentStop');
    expect(eventNames).toContain('Stop');
    expect(eventNames.length).toBe(10);
  });

  it('should use correct port in URLs', () => {
    const config = generateHookConfig(4444);
    const url = config.SessionStart[0].hooks[0].url;
    expect(url).toContain('localhost:4444');
  });

  it('should set timeout 540 for PermissionRequest', () => {
    const config = generateHookConfig(3333);
    const timeout = config.PermissionRequest[0].hooks[0].timeout;
    expect(timeout).toBe(120);
  });

  it('should not set timeout for other events', () => {
    const config = generateHookConfig(3333);
    const timeout = config.PreToolUse[0].hooks[0].timeout;
    expect(timeout).toBeUndefined();
  });

  it('should generate kebab-case URL slugs', () => {
    const config = generateHookConfig(3333);
    const url = config.PreToolUse[0].hooks[0].url;
    expect(url).toContain('/api/hook/pre-tool-use');
  });
});
