import { openSync, readSync, fstatSync, closeSync, readFileSync } from 'node:fs';

export interface TokenResult {
  inputTokens: number;
  outputTokens: number;
  newOffset: number;
}

export interface TurnToolUse {
  id: string;
  name: string;
  inputChars: number;
}

export interface TurnBreakdown {
  messageId: string;
  model: string;
  timestamp: string;
  thinkingChars: number;
  /**
   * Signature length del bloque thinking. Claude 4.7+ devuelve thinking
   * cifrado con thinking="" y signature=base64. Si thinkingChars===0 pero
   * thinkingSignatureChars>0, el modelo SÍ razonó pero no podemos leerlo.
   * Usamos signature_length × 0.75 como proxy (base64 → bytes).
   */
  thinkingSignatureChars: number;
  textChars: number;
  toolUses: TurnToolUse[];
  /** output_tokens reales del message.usage (facturados por Anthropic). */
  outputTokens: number;
}

export interface TurnBreakdownResult {
  turns: TurnBreakdown[];
  lastMessageId: string | null;
}

/**
 * Lee las primeras lineas del transcript para extraer el modelo.
 * Busca campos "model" en las entradas del JSONL.
 */
export function readModelFromTranscript(transcriptPath: string): string | null {
  try {
    // Leer los primeros 64KB — el model puede estar despues del system prompt largo
    const fd = openSync(transcriptPath, 'r');
    const buffer = Buffer.alloc(65536);
    const bytesRead = readSync(fd, buffer, 0, 65536, 0);
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
          // Strip XML/system tags injected by Claude Code harness
          const stripped = text.replace(/<[^>]*>[\s\S]*?<\/[^>]*>/g, '').replace(/<[^>]*>/g, '').trim();
          if (stripped.length >= 3) {
            return stripped.replace(/\n/g, ' ').trim().slice(0, 100);
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
        const usage = entry.usage || entry.message?.usage;
        if (usage) {
          inputTokens += usage.input_tokens ?? 0;
          outputTokens += usage.output_tokens ?? 0;
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

/**
 * Parsea el transcript JSONL y extrae el desglose por turn (assistant message)
 * de los bloques thinking/text/tool_use.
 *
 * Salta mensajes ya procesados: cuando se encuentra `sinceMessageId`, se
 * reanuda desde el SIGUIENTE mensaje. Si sinceMessageId es null, devuelve
 * todos los mensajes.
 *
 * El UNIQUE INDEX sobre input_hash en optimization_events deduplica
 * inserts repetidos si por alguna razón se reparsea el mismo msg_id
 * (ej: sesión resumida, compact).
 */
export function parseTurnBreakdown(
  transcriptPath: string,
  sinceMessageId: string | null,
): TurnBreakdownResult {
  const result: TurnBreakdownResult = { turns: [], lastMessageId: sinceMessageId };
  let content: string;
  try {
    content = readFileSync(transcriptPath, 'utf-8');
  } catch {
    return result;
  }

  const lines = content.split('\n');
  let skip = sinceMessageId !== null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (entry.type !== 'assistant') continue;
    const message = entry.message as Record<string, unknown> | undefined;
    if (!message || typeof message !== 'object') continue;

    const messageId = typeof message.id === 'string' ? message.id : null;
    if (!messageId) continue;

    if (skip) {
      if (messageId === sinceMessageId) skip = false;
      continue;
    }

    const model = typeof message.model === 'string' ? message.model : 'unknown';
    const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString();
    const contentBlocks = Array.isArray(message.content) ? (message.content as Array<Record<string, unknown>>) : [];
    const usage = message.usage as Record<string, unknown> | undefined;
    const outputTokens = typeof usage?.output_tokens === 'number' ? (usage.output_tokens as number) : 0;

    const turn: TurnBreakdown = {
      messageId,
      model,
      timestamp,
      thinkingChars: 0,
      thinkingSignatureChars: 0,
      textChars: 0,
      toolUses: [],
      outputTokens,
    };

    for (const block of contentBlocks) {
      const type = block.type;
      if (type === 'thinking') {
        const text = typeof block.thinking === 'string' ? block.thinking : '';
        turn.thinkingChars += text.length;
        const sig = typeof block.signature === 'string' ? block.signature : '';
        turn.thinkingSignatureChars += sig.length;
      } else if (type === 'text') {
        const text = typeof block.text === 'string' ? block.text : '';
        turn.textChars += text.length;
      } else if (type === 'tool_use') {
        const id = typeof block.id === 'string' ? block.id : null;
        const name = typeof block.name === 'string' ? block.name : 'unknown';
        const input = block.input;
        const inputChars = input !== undefined ? JSON.stringify(input).length : 0;
        if (id) turn.toolUses.push({ id, name, inputChars });
      }
    }

    result.turns.push(turn);
    result.lastMessageId = messageId;
  }

  return result;
}

/**
 * chars × 0.27 — misma heurística que token-optimizer-mcp (estimation_method
 * = 'estimated_heuristic'). Ver CLAUDE.md de xray: los tokens per-tool son
 * estimados con esta fórmula y etiquetados como tal en la UI.
 */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars * 0.27);
}
