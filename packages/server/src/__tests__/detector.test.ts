import { describe, it, expect } from 'vitest';
import {
  parseMcpToolName,
  updateMcps,
  calculateContextIncrement,
  getCompactResetPercent,
} from '../sessions/detector.js';

describe('parseMcpToolName', () => {
  it('should parse standard MCP tool names', () => {
    const result = parseMcpToolName('mcp__memory__recall');
    expect(result).toEqual({ server: 'memory', tool: 'recall' });
  });

  it('should parse MCP tool names with nested underscores', () => {
    const result = parseMcpToolName('mcp__api-testing__flow_run');
    expect(result).toEqual({ server: 'api-testing', tool: 'flow_run' });
  });

  it('should return null for non-MCP tools', () => {
    expect(parseMcpToolName('Bash')).toBeNull();
    expect(parseMcpToolName('Read')).toBeNull();
    expect(parseMcpToolName('Edit')).toBeNull();
  });

  it('should return null for malformed MCP names', () => {
    expect(parseMcpToolName('mcp__')).toBeNull();
    expect(parseMcpToolName('mcp__only')).toBeNull();
  });
});

describe('updateMcps', () => {
  it('should add new MCP on first tool call', () => {
    const result = updateMcps([], 'mcp__memory__recall', true);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('memory');
    expect(result[0].status).toBe('connected');
    expect(result[0].toolsUsed).toEqual(['recall']);
  });

  it('should add tool to existing MCP', () => {
    const existing = [{ name: 'memory', status: 'connected' as const, toolsUsed: ['recall'] }];
    const result = updateMcps(existing, 'mcp__memory__save', true);
    expect(result.length).toBe(1);
    expect(result[0].toolsUsed).toEqual(['recall', 'save']);
  });

  it('should mark MCP as error on failure', () => {
    const existing = [{ name: 'memory', status: 'connected' as const, toolsUsed: ['recall'] }];
    const result = updateMcps(existing, 'mcp__memory__save', false);
    expect(result[0].status).toBe('error');
  });

  it('should not modify MCPs for non-MCP tools', () => {
    const existing = [{ name: 'memory', status: 'connected' as const, toolsUsed: ['recall'] }];
    const result = updateMcps(existing, 'Bash', true);
    expect(result).toBe(existing); // Same reference, no change
  });

  it('should not duplicate tools', () => {
    const existing = [{ name: 'memory', status: 'connected' as const, toolsUsed: ['recall'] }];
    const result = updateMcps(existing, 'mcp__memory__recall', true);
    expect(result[0].toolsUsed).toEqual(['recall']);
  });
});

describe('calculateContextIncrement', () => {
  it('should return higher weight for Bash', () => {
    const bash = calculateContextIncrement('Bash');
    const read = calculateContextIncrement('Read');
    expect(bash).toBeGreaterThan(read);
  });

  it('should return weight for MCP tools using default', () => {
    const result = calculateContextIncrement('mcp__memory__recall');
    expect(result).toBeGreaterThan(0);
  });

  it('should return Agent weight for Agent tool', () => {
    const agent = calculateContextIncrement('Agent');
    const bash = calculateContextIncrement('Bash');
    expect(agent).toBeGreaterThan(bash);
  });
});

describe('getCompactResetPercent', () => {
  it('should return 20', () => {
    expect(getCompactResetPercent()).toBe(20);
  });
});
