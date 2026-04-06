import { openSync, readSync, fstatSync, closeSync, readFileSync } from 'node:fs';

export interface TokenResult {
  inputTokens: number;
  outputTokens: number;
  newOffset: number;
}

/**
 * Lee las primeras lineas del transcript para extraer el modelo.
 * Busca campos "model" en las entradas del JSONL.
 */
export function readModelFromTranscript(transcriptPath: string): string | null {
  try {
    // Leer solo los primeros 8KB (suficiente para encontrar el modelo)
    const fd = openSync(transcriptPath, 'r');
    const buffer = Buffer.alloc(8192);
    const bytesRead = readSync(fd, buffer, 0, 8192, 0);
    closeSync(fd);

    const content = buffer.toString('utf-8', 0, bytesRead);
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed);
        // El modelo puede estar en varios campos segun el tipo de entrada
        if (entry.model && typeof entry.model === 'string') {
          return entry.model;
        }
        if (entry.message?.model && typeof entry.message.model === 'string') {
          return entry.message.model;
        }
      } catch {
        // Linea no JSON
      }
    }
  } catch {
    // Archivo no accesible
  }
  return null;
}

/**
 * Lee el transcript para extraer el tema/titulo de la conversacion.
 * Busca el primer mensaje del usuario (type: human) y lo usa como topic.
 */
export function readTopicFromTranscript(transcriptPath: string): string | null {
  try {
    const fd = openSync(transcriptPath, 'r');
    const buffer = Buffer.alloc(16384); // 16KB para encontrar el primer mensaje
    const bytesRead = readSync(fd, buffer, 0, 16384, 0);
    closeSync(fd);

    const content = buffer.toString('utf-8', 0, bytesRead);
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed);
        // Buscar mensaje del usuario (type: "user" con message.role: "user")
        if ((entry.type === 'user' || entry.type === 'human') && entry.message?.content) {
          let text = '';
          if (typeof entry.message.content === 'string') {
            text = entry.message.content;
          } else if (Array.isArray(entry.message.content)) {
            const textBlock = entry.message.content.find((c: { type: string; text?: string }) => c.type === 'text');
            text = textBlock?.text || '';
          }
          if (text) {
            return text.replace(/\n/g, ' ').trim().slice(0, 100);
          }
        }
      } catch {
        // Linea no JSON
      }
    }
  } catch {
    // Archivo no accesible
  }
  return null;
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
