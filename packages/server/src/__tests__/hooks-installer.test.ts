import { describe, it, expect } from 'vitest';

import { generateHookConfig } from '../setup/hooks-installer.js';
import type { XrayCommandHookEntry } from '../types.js';

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

  it('should emit hooks of type command (not http)', () => {
    const config = generateHookConfig(3333);
    const entry = config.PreToolUse[0].hooks[0];
    expect(entry.type).toBe('command');
    expect('command' in entry).toBe(true);
    expect('url' in entry).toBe(false);
  });

  it('should embed the port in the command string', () => {
    const config = generateHookConfig(4444);
    const entry = config.PreToolUse[0].hooks[0] as XrayCommandHookEntry;
    expect(entry.command).toContain('4444');
  });

  it('should use cxc-xray-hook as the wrapper binary', () => {
    const config = generateHookConfig(3333);
    const entry = config.SessionStart[0].hooks[0] as XrayCommandHookEntry;
    expect(entry.command).toMatch(/^cxc-xray-hook /);
  });

  it('should generate kebab-case event slugs in command args', () => {
    const config = generateHookConfig(3333);
    const entry = config.PreToolUse[0].hooks[0] as XrayCommandHookEntry;
    expect(entry.command).toContain('pre-tool-use');
  });

  it('should set timeout 540 for PermissionRequest (long-polling)', () => {
    const config = generateHookConfig(3333);
    const timeout = config.PermissionRequest[0].hooks[0].timeout;
    expect(timeout).toBe(540);
  });

  it('should not set timeout for other events', () => {
    const config = generateHookConfig(3333);
    const timeout = config.PreToolUse[0].hooks[0].timeout;
    expect(timeout).toBeUndefined();
  });

  it('should emit a distinct kebab-case slug per event', () => {
    const config = generateHookConfig(3333);
    const slugs = new Set<string>();
    for (const eventName of Object.keys(config)) {
      const entry = config[eventName][0].hooks[0] as XrayCommandHookEntry;
      const match = entry.command.match(/^cxc-xray-hook (\S+)/);
      expect(match).not.toBeNull();
      slugs.add(match![1]);
    }
    expect(slugs.size).toBe(10);
  });
});
