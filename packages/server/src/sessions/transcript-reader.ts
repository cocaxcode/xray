import { openSync, readSync, fstatSync, closeSync } from 'node:fs';

export interface TokenResult {
  inputTokens: number;
  outputTokens: number;
  newOffset: number;
}

/**
 * Lee nuevas lineas del transcript JSONL desde el offset dado
 * y extrae tokens de uso acumulados.
 */
export function readNewTokens(transcriptPath: string, lastOffset: number): TokenResult {
  let fd: number;
  try {
    fd = openSync(transcriptPath, 'r');
  } catch {
    return { inputTokens: 0, outputTokens: 0, newOffset: lastOffset };
  }

  try {
    const stat = fstatSync(fd);
    const fileSize = stat.size;

    if (fileSize <= lastOffset) {
      return { inputTokens: 0, outputTokens: 0, newOffset: lastOffset };
    }

    const bytesToRead = fileSize - lastOffset;
    // Limitar a 1MB por lectura para no saturar memoria
    const maxRead = Math.min(bytesToRead, 1024 * 1024);
    const buffer = Buffer.alloc(maxRead);
    readSync(fd, buffer, 0, maxRead, lastOffset);

    const content = buffer.toString('utf-8');
    const lines = content.split('\n');

    let inputTokens = 0;
    let outputTokens = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const entry = JSON.parse(trimmed);
        if (entry.usage) {
          inputTokens += entry.usage.input_tokens ?? 0;
          outputTokens += entry.usage.output_tokens ?? 0;
        }
      } catch {
        // Linea incompleta o no JSON — ignorar
      }
    }

    return {
      inputTokens,
      outputTokens,
      newOffset: lastOffset + maxRead,
    };
  } finally {
    closeSync(fd);
  }
}
