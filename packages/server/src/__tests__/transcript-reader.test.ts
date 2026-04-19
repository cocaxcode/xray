import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readNewTokens, parseTurnBreakdown, estimateTokensFromChars } from '../sessions/transcript-reader.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'xray-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('readNewTokens', () => {
  it('should extract tokens from JSONL with usage field', () => {
    const filePath = join(tmpDir, 'transcript.jsonl');
    const lines = [
      JSON.stringify({ type: 'human', message: 'hello' }),
      JSON.stringify({ type: 'assistant', message: 'hi', usage: { input_tokens: 100, output_tokens: 50 } }),
      JSON.stringify({ type: 'assistant', message: 'ok', usage: { input_tokens: 200, output_tokens: 100 } }),
    ].join('\n') + '\n';

    writeFileSync(filePath, lines);

    const result = readNewTokens(filePath, 0);
    expect(result.inputTokens).toBe(300);
    expect(result.outputTokens).toBe(150);
    expect(result.newOffset).toBeGreaterThan(0);
  });

  it('should read incrementally from offset', () => {
    const filePath = join(tmpDir, 'transcript.jsonl');
    const line1 = JSON.stringify({ type: 'assistant', usage: { input_tokens: 100, output_tokens: 50 } }) + '\n';
    const line2 = JSON.stringify({ type: 'assistant', usage: { input_tokens: 200, output_tokens: 100 } }) + '\n';

    writeFileSync(filePath, line1);

    const result1 = readNewTokens(filePath, 0);
    expect(result1.inputTokens).toBe(100);

    // Append second line
    writeFileSync(filePath, line1 + line2);

    const result2 = readNewTokens(filePath, result1.newOffset);
    expect(result2.inputTokens).toBe(200);
    expect(result2.outputTokens).toBe(100);
  });

  it('should return zeros for non-existent file', () => {
    const result = readNewTokens('/nonexistent/path.jsonl', 0);
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.newOffset).toBe(0);
  });

  it('should skip lines without usage field', () => {
    const filePath = join(tmpDir, 'transcript.jsonl');
    const lines = [
      JSON.stringify({ type: 'human', message: 'hello' }),
      JSON.stringify({ type: 'system', content: 'prompt' }),
      JSON.stringify({ type: 'assistant', usage: { input_tokens: 50, output_tokens: 25 } }),
    ].join('\n') + '\n';

    writeFileSync(filePath, lines);

    const result = readNewTokens(filePath, 0);
    expect(result.inputTokens).toBe(50);
    expect(result.outputTokens).toBe(25);
  });

  it('should handle empty file', () => {
    const filePath = join(tmpDir, 'empty.jsonl');
    writeFileSync(filePath, '');

    const result = readNewTokens(filePath, 0);
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it('should handle malformed JSON lines gracefully', () => {
    const filePath = join(tmpDir, 'broken.jsonl');
    const lines = [
      '{"valid": true, "usage": {"input_tokens": 10, "output_tokens": 5}}',
      'not json at all',
      '{"also_valid": true}',
    ].join('\n') + '\n';

    writeFileSync(filePath, lines);

    const result = readNewTokens(filePath, 0);
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
  });
});

describe('estimateTokensFromChars', () => {
  it('applies chars × 0.27 rounded up', () => {
    expect(estimateTokensFromChars(100)).toBe(27);
    expect(estimateTokensFromChars(1000)).toBe(270);
    expect(estimateTokensFromChars(1)).toBe(1);
    expect(estimateTokensFromChars(0)).toBe(0);
  });
});

describe('parseTurnBreakdown', () => {
  const makeAssistant = (id: string, blocks: Array<Record<string, unknown>>) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-04-19T12:00:00Z',
      message: { id, model: 'claude-sonnet-4-6-20250514', content: blocks },
    });

  it('extracts thinking, text and tool_use blocks from a turn', () => {
    const filePath = join(tmpDir, 't.jsonl');
    const content = [
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      makeAssistant('msg_01A', [
        { type: 'thinking', thinking: 'a'.repeat(300) },
        { type: 'text', text: 'b'.repeat(100) },
        { type: 'tool_use', id: 'toolu_01X', name: 'Bash', input: { command: 'ls' } },
      ]),
    ].join('\n') + '\n';
    writeFileSync(filePath, content);

    const { turns, lastMessageId } = parseTurnBreakdown(filePath, null);
    expect(turns).toHaveLength(1);
    expect(turns[0].messageId).toBe('msg_01A');
    expect(turns[0].model).toBe('claude-sonnet-4-6-20250514');
    expect(turns[0].thinkingChars).toBe(300);
    expect(turns[0].textChars).toBe(100);
    expect(turns[0].toolUses).toHaveLength(1);
    expect(turns[0].toolUses[0].id).toBe('toolu_01X');
    expect(turns[0].toolUses[0].name).toBe('Bash');
    expect(turns[0].toolUses[0].inputChars).toBe(JSON.stringify({ command: 'ls' }).length);
    expect(lastMessageId).toBe('msg_01A');
  });

  it('resumes from sinceMessageId (skips processed turns)', () => {
    const filePath = join(tmpDir, 't.jsonl');
    const content = [
      makeAssistant('msg_A', [{ type: 'thinking', thinking: 'one' }]),
      makeAssistant('msg_B', [{ type: 'text', text: 'two' }]),
      makeAssistant('msg_C', [{ type: 'text', text: 'three' }]),
    ].join('\n') + '\n';
    writeFileSync(filePath, content);

    const { turns, lastMessageId } = parseTurnBreakdown(filePath, 'msg_A');
    expect(turns.map((t) => t.messageId)).toEqual(['msg_B', 'msg_C']);
    expect(lastMessageId).toBe('msg_C');
  });

  it('ignores non-assistant entries', () => {
    const filePath = join(tmpDir, 't.jsonl');
    const content = [
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      JSON.stringify({ type: 'system', content: 'prompt' }),
      makeAssistant('msg_X', [{ type: 'text', text: 'hello' }]),
    ].join('\n') + '\n';
    writeFileSync(filePath, content);

    const { turns } = parseTurnBreakdown(filePath, null);
    expect(turns).toHaveLength(1);
    expect(turns[0].messageId).toBe('msg_X');
  });

  it('skips assistant messages without message.id', () => {
    const filePath = join(tmpDir, 't.jsonl');
    const content = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'no id' }] } }),
      makeAssistant('msg_Z', [{ type: 'text', text: 'ok' }]),
    ].join('\n') + '\n';
    writeFileSync(filePath, content);

    const { turns } = parseTurnBreakdown(filePath, null);
    expect(turns.map((t) => t.messageId)).toEqual(['msg_Z']);
  });

  it('returns empty when file does not exist', () => {
    const { turns, lastMessageId } = parseTurnBreakdown('/nope/x.jsonl', null);
    expect(turns).toEqual([]);
    expect(lastMessageId).toBeNull();
  });

  it('when sinceMessageId is not found, preserves it (no rewind)', () => {
    const filePath = join(tmpDir, 't.jsonl');
    const content = makeAssistant('msg_A', [{ type: 'text', text: 'x' }]) + '\n';
    writeFileSync(filePath, content);

    const { turns, lastMessageId } = parseTurnBreakdown(filePath, 'msg_UNKNOWN');
    expect(turns).toEqual([]);
    expect(lastMessageId).toBe('msg_UNKNOWN');
  });
});
