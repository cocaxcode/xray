import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readNewTokens } from '../sessions/transcript-reader.js';

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
