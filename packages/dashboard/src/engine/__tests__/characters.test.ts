import { describe, it, expect } from 'vitest';
import {
  resolveCharacterName,
  getUniqueName,
  createCharacter,
  getHueShift,
  getCompanionHueShift,
} from '../characters';
import type { TemplateConfig } from '../types';

// Minimal template for testing
const mockTemplate: TemplateConfig = {
  name: 'Test',
  author: 'test',
  version: '1.0.0',
  tileSize: 64,
  maps: {
    small: {
      mapSize: [4, 4],
      map: [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]],
      walkable: [[true,true,true,true],[true,true,true,true],[true,true,true,true],[true,true,true,true]],
      zones: { work: [{x:1,y:1}], rest: [{x:2,y:2}], spawn: [{x:0,y:3}], exit: [{x:3,y:3}] },
    },
    medium: {
      mapSize: [4, 4],
      map: [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]],
      walkable: [[true,true,true,true],[true,true,true,true],[true,true,true,true],[true,true,true,true]],
      zones: { work: [{x:1,y:1},{x:2,y:1}], rest: [{x:0,y:0}], spawn: [{x:0,y:3}], exit: [{x:3,y:3}] },
    },
    large: {
      mapSize: [4, 4],
      map: [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]],
      walkable: [[true,true,true,true],[true,true,true,true],[true,true,true,true],[true,true,true,true]],
      zones: { work: [{x:1,y:1},{x:2,y:1},{x:3,y:1}], rest: [{x:0,y:0}], spawn: [{x:0,y:3}], exit: [{x:3,y:3}] },
    },
  },
  tiles: {},
  sprites: {},
  props: [],
  stateMap: { active: { anim: 'attack', zone: 'work', spawnEnemy: true }, idle: { anim: 'idle', zone: 'rest' } },
  toolAnimations: { Edit: 'attack', Read: 'idle', default: 'attack' },
  agentTypes: {
    'Explore': { name: 'Explorador', sprite: 'archer' },
    'Plan': { name: 'Estratega', sprite: 'mage' },
    'default': { name: 'Aliado', sprite: 'warrior-2' },
  },
  equipmentMap: { 'sdd-apply': 'sword-big', default: 'sword-short' },
  environmentMap: { database: 'crystal-blue', default: 'portal' },
  enemyScaling: { metric: 'totalTokens', thresholds: [{ tokens: 0, enemies: 1, sprite: 'goblin' }] },
};

describe('resolveCharacterName', () => {
  it('returns avatar name for main agent', () => {
    const name = resolveCharacterName(null, { avatarName: 'Raul' }, mockTemplate);
    expect(name).toBe('Raul');
  });

  it('returns "Agent" when no avatar configured', () => {
    const name = resolveCharacterName(null, {}, mockTemplate);
    expect(name).toBe('Agent');
  });

  it('user override wins over template for sub-agents', () => {
    const name = resolveCharacterName('Explore', { agentTypeNames: { Explore: 'Scout' } }, mockTemplate);
    expect(name).toBe('Scout');
  });

  it('falls back to template mapping for sub-agents', () => {
    const name = resolveCharacterName('Explore', {}, mockTemplate);
    expect(name).toBe('Explorador');
  });

  it('falls back to template default for unknown types', () => {
    const name = resolveCharacterName('my-custom-agent', {}, mockTemplate);
    expect(name).toBe('Aliado');
  });

  it('falls back to raw type when no template default', () => {
    const templateNoDefault = { ...mockTemplate, agentTypes: { Explore: { name: 'Explorador', sprite: 'archer' } } };
    const name = resolveCharacterName('unknown-type', {}, templateNoDefault);
    expect(name).toBe('unknown-type');
  });
});

describe('getUniqueName', () => {
  it('returns base name if no duplicates', () => {
    expect(getUniqueName('Escudero', ['Explorador', 'Estratega'])).toBe('Escudero');
  });

  it('appends 2 for first duplicate', () => {
    expect(getUniqueName('Escudero', ['Escudero'])).toBe('Escudero 2');
  });

  it('appends 3 when 2 already exists', () => {
    expect(getUniqueName('Escudero', ['Escudero', 'Escudero 2'])).toBe('Escudero 3');
  });

  it('handles empty existing names', () => {
    expect(getUniqueName('Agent', [])).toBe('Agent');
  });
});

describe('createCharacter', () => {
  it('creates character with correct initial state', () => {
    const char = createCharacter('s1', 's1', 'warrior-1', 'Raul', 0, { x: 0, y: 3 });
    expect(char.id).toBe('s1');
    expect(char.sessionId).toBe('s1');
    expect(char.name).toBe('Raul');
    expect(char.state).toBe('spawning');
    expect(char.isCompanion).toBe(false);
    expect(char.equipment).toBeNull();
    expect(char.environmentMcps).toEqual([]);
    expect(char.enemies).toEqual([]);
    expect(char.markedForRemoval).toBe(false);
  });

  it('creates companion character', () => {
    const char = createCharacter('a1', 's1', 'archer', 'Explorador', 45, { x: 0, y: 3 }, true, 'Explore');
    expect(char.isCompanion).toBe(true);
    expect(char.agentType).toBe('Explore');
    expect(char.hueShift).toBe(45);
  });
});

describe('hueShift', () => {
  it('returns distinct hue shifts for first 8 indices', () => {
    const shifts = new Set<number>();
    for (let i = 0; i < 8; i++) {
      shifts.add(getHueShift(i));
    }
    expect(shifts.size).toBe(8);
  });

  it('wraps around after 8', () => {
    expect(getHueShift(0)).toBe(getHueShift(8));
  });

  it('companion hue differs from parent', () => {
    const parent = getHueShift(0);
    const companion = getCompanionHueShift(parent);
    expect(companion).not.toBe(parent);
    expect(companion).toBe(20); // 0 + 20
  });
});
