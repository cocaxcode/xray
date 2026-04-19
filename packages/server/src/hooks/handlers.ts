import type {
  SessionStartPayload,
  PreToolUsePayload,
  PostToolUsePayload,
  PostToolUseFailurePayload,
  SubagentStartPayload,
  SubagentStopPayload,
  NotificationPayload,
  StopPayload,
  ServerWSEvent,
  Agent,
  TokenOptimizerEvent,
  TokenOptimizerSummary,
} from '../types.js';
import type { SessionManager } from '../sessions/manager.js';
import type { Queries } from '../db/queries.js';
import type { PermissionHandler } from './permission.js';
import { parseTurnBreakdown, estimateTokensFromChars } from '../sessions/transcript-reader.js';

export class HookHandlers {
  private manager: SessionManager;
  private queries: Queries;
  private broadcast: (event: ServerWSEvent) => void;
  private permissionHandler: PermissionHandler | null = null;

  constructor(
    manager: SessionManager,
    queries: Queries,
    broadcast: (event: ServerWSEvent) => void
  ) {
    this.manager = manager;
    this.queries = queries;
    this.broadcast = broadcast;
  }

  setPermissionHandler(handler: PermissionHandler): void {
    this.permissionHandler = handler;
  }

  /**
   * Cuando llega un PostToolUse/Failure, si hay un permiso pendiente para esa sesion, limpiarlo.
   * Significa que Claude Code ya proceso la accion (aprobada en terminal o auto-aprobada).
   */
  private cleanupStalePermissions(sessionId: string): void {
    if (this.permissionHandler) {
      this.permissionHandler.cleanupBySession(sessionId);
    }
  }

  handleSessionStart(payload: SessionStartPayload): void {
    const session = this.manager.handleSessionStart({
      session_id: payload.session_id,
      cwd: payload.cwd,
      model: payload.model,
      source: payload.source,
      transcript_path: payload.transcript_path,
    });

    this.queries.insertEvent({
      sessionId: payload.session_id,
      eventType: 'SessionStart',
    });

    this.broadcast({ type: 'session:start', data: session });
  }

  handlePreToolUse(payload: PreToolUsePayload): void {
    // Si llega un PreToolUse, cualquier permiso pendiente de esta sesion ya fue resuelto
    this.cleanupStalePermissions(payload.session_id);

    // Track active tool (in-memory for animated views)
    this.manager.setActiveTool(payload.session_id, {
      toolName: payload.tool_name,
      toolUseId: payload.tool_use_id,
      agentId: null,
    });

    // Transition to active
    this.manager.transitionTo(payload.session_id, 'active');

    // Update MCP detection
    this.manager.updateMcpsFromToolCall(payload.session_id, payload.tool_name, true);

    // Update context estimate
    this.manager.updateContextEstimate(payload.session_id, payload.tool_name);

    // Store event
    const eventId = this.queries.insertEvent({
      sessionId: payload.session_id,
      eventType: 'PreToolUse',
      toolName: payload.tool_name,
      toolInput: JSON.stringify(payload.tool_input),
      toolUseId: payload.tool_use_id,
    });

    // Broadcast tool activity
    this.broadcast({
      type: 'tool:activity',
      data: {
        id: eventId,
        sessionId: payload.session_id,
        eventType: 'PreToolUse',
        toolName: payload.tool_name,
        toolInput: payload.tool_input,
        success: true,
        createdAt: new Date().toISOString(),
      },
    });

    // Broadcast session update
    const session = this.manager.getSession(payload.session_id);
    if (session) {
      this.broadcast({ type: 'session:update', data: { id: session.id, status: session.status, mcps: session.mcps, contextPercent: session.contextPercent, eventCount: session.eventCount, activeTool: this.manager.getActiveTool(session.id) } });
    }
  }

  handlePostToolUse(payload: PostToolUsePayload): void {
    // Clear active tool
    this.manager.clearActiveTool(payload.session_id);

    // Calculate duration from PreToolUse
    const preTimestamp = this.queries.getPreToolTimestamp(payload.session_id, payload.tool_use_id);
    const durationMs = preTimestamp ? Date.now() - new Date(preTimestamp).getTime() : undefined;

    const eventId = this.queries.insertEvent({
      sessionId: payload.session_id,
      eventType: 'PostToolUse',
      toolName: payload.tool_name,
      toolInput: JSON.stringify(payload.tool_input),
      toolResponse: JSON.stringify(payload.tool_response),
      toolUseId: payload.tool_use_id,
      success: true,
      durationMs,
    });

    // Update tokens from transcript
    this.manager.updateTokens(payload.session_id);

    this.broadcast({
      type: 'tool:activity',
      data: {
        id: eventId,
        sessionId: payload.session_id,
        eventType: 'PostToolUse',
        toolName: payload.tool_name,
        toolInput: payload.tool_input,
        toolResponse: payload.tool_response,
        success: true,
        durationMs,
        createdAt: new Date().toISOString(),
      },
    });

    // Broadcast updated tokens
    const session = this.manager.getSession(payload.session_id);
    if (session) {
      this.broadcast({ type: 'session:update', data: { id: session.id, inputTokens: session.inputTokens, outputTokens: session.outputTokens, activeTool: null } });
    }
  }

  handlePostToolUseFailure(payload: PostToolUseFailurePayload): void {
    this.manager.clearActiveTool(payload.session_id);
    this.manager.transitionTo(payload.session_id, 'error');
    this.manager.updateMcpsFromToolCall(payload.session_id, payload.tool_name, false);

    const eventId = this.queries.insertEvent({
      sessionId: payload.session_id,
      eventType: 'PostToolUseFailure',
      toolName: payload.tool_name,
      toolInput: JSON.stringify(payload.tool_input),
      toolResponse: JSON.stringify({ error: payload.error }),
      toolUseId: payload.tool_use_id,
      success: false,
    });

    this.broadcast({
      type: 'tool:activity',
      data: {
        id: eventId,
        sessionId: payload.session_id,
        eventType: 'PostToolUseFailure',
        toolName: payload.tool_name,
        toolInput: payload.tool_input,
        toolResponse: { error: payload.error },
        success: false,
        createdAt: new Date().toISOString(),
      },
    });

    const session = this.manager.getSession(payload.session_id);
    if (session) {
      this.broadcast({ type: 'session:update', data: { id: session.id, status: 'error', mcps: session.mcps } });
    }
  }

  handleSubagentStart(payload: SubagentStartPayload): void {
    const agent: Agent = {
      id: payload.agent_id,
      type: payload.agent_type,
      status: 'running',
      startedAt: new Date().toISOString(),
    };

    this.manager.addAgent(payload.session_id, agent);

    this.queries.insertEvent({
      sessionId: payload.session_id,
      eventType: 'SubagentStart',
      agentId: payload.agent_id,
      agentType: payload.agent_type,
    });

    this.broadcast({
      type: 'agent:start',
      data: { sessionId: payload.session_id, agent },
    });
  }

  handleSubagentStop(payload: SubagentStopPayload): void {
    const agent = this.manager.completeAgent(payload.session_id, payload.agent_id);

    this.queries.insertEvent({
      sessionId: payload.session_id,
      eventType: 'SubagentStop',
      agentId: payload.agent_id,
      agentType: payload.agent_type,
      durationMs: agent?.duration,
    });

    this.broadcast({
      type: 'agent:stop',
      data: { sessionId: payload.session_id, agentId: payload.agent_id },
    });
  }

  handleNotification(payload: NotificationPayload): void {
    if (payload.notification_type === 'idle_prompt') {
      this.manager.transitionTo(payload.session_id, 'waiting_input');
    }

    this.queries.insertEvent({
      sessionId: payload.session_id,
      eventType: 'Notification',
    });

    this.broadcast({
      type: 'notification',
      data: {
        sessionId: payload.session_id,
        type: payload.notification_type,
        message: payload.message,
      },
    });

    const session = this.manager.getSession(payload.session_id);
    if (session) {
      this.broadcast({ type: 'session:update', data: { id: session.id, status: session.status, lastMessage: payload.message } });
    }
  }

  handleStop(payload: StopPayload): void {
    // Clear active tool
    this.manager.clearActiveTool(payload.session_id);

    // Limpiar permisos stale (ej: usuario rechazo en terminal → Stop llega)
    this.cleanupStalePermissions(payload.session_id);

    // Update model if it was unknown (session auto-created mid-session)
    if (payload.model) {
      const current = this.manager.getSession(payload.session_id);
      if (current && current.model === 'unknown') {
        this.queries.updateSession(payload.session_id, { model: payload.model });
      }
    }

    this.manager.handleStop({
      session_id: payload.session_id,
      last_assistant_message: payload.last_assistant_message,
    });

    this.queries.insertEvent({
      sessionId: payload.session_id,
      eventType: 'Stop',
    });

    // Update tokens one last time
    this.manager.updateTokens(payload.session_id);

    // Parsear desglose output modelo (thinking/response/tool_use) y emitir
    // eventos por turn. Ver CLAUDE.md — decisión 2026-04-17.
    this.processTurnBreakdown(payload.session_id);

    const session = this.manager.getSession(payload.session_id);
    if (session) {
      // Guardar snapshot de tokens al momento del Stop para calcular delta
      session.inputTokensAtStop = session.inputTokens;
      session.outputTokensAtStop = session.outputTokens;
      this.broadcast({ type: 'session:update', data: {
        id: session.id, status: 'idle', model: session.model, lastMessage: session.lastMessage,
        inputTokens: session.inputTokens, outputTokens: session.outputTokens,
        inputTokensAtStop: session.inputTokensAtStop, outputTokensAtStop: session.outputTokensAtStop,
      } });
    }
  }

  /**
   * Parsea el transcript de una sesión y emite hasta 3 eventos por turn
   * (thinking / response / tool_use) con dedup via input_hash UNIQUE.
   *
   * - Reanuda desde `sessions.last_parsed_message_id` para no reparsear.
   * - Tokens: heurística chars × 0.27 (igual que token-optimizer-mcp).
   * - tool_name = source ('thinking'/'response'/'tool_use'). Las queries
   *   de top-tools filtran por source para no contaminar.
   * - command_preview = model simplificado (ej "sonnet-4.6").
   */
  private processTurnBreakdown(sessionId: string): void {
    const session = this.queries.getSession(sessionId);
    const info = this.queries.getSessionTranscriptInfo(sessionId);
    if (!session || !info || !info.transcriptPath) return;

    const since = this.queries.getLastParsedMessageId(sessionId);
    const { turns, lastMessageId } = parseTurnBreakdown(info.transcriptPath, since);
    if (turns.length === 0) return;

    for (const turn of turns) {
      const modelLabel = simplifyModel(turn.model);

      // Claude 4.7+ devuelve thinking cifrado (thinking="", signature=base64).
      // Si no hay chars plaintext pero sí signature, usamos signature×0.75 como
      // proxy del tamaño en bytes del razonamiento cifrado.
      const thinkingEffective = turn.thinkingChars > 0
        ? turn.thinkingChars
        : Math.round(turn.thinkingSignatureChars * 0.75);

      // thinking
      if (thinkingEffective > 0) {
        this.insertTurnEvent(session, turn.messageId, turn.timestamp, {
          source: 'thinking',
          tool_name: 'thinking',
          chars: thinkingEffective,
          input_hash: `thinking:${turn.messageId}`,
          command_preview: turn.thinkingChars > 0
            ? modelLabel
            : `${modelLabel} · cifrado`,
        });
      }
      // response (text block)
      if (turn.textChars > 0) {
        this.insertTurnEvent(session, turn.messageId, turn.timestamp, {
          source: 'response',
          tool_name: 'response',
          chars: turn.textChars,
          input_hash: `response:${turn.messageId}`,
          command_preview: modelLabel,
        });
      }
      // NO emitir tool_use como línea separada: la tool call real ya se
      // contabiliza vía PostToolUse con su source original (mcp/builtin/rtk…).
      // Emitirla aquí también crearía dos líneas del mismo evento en el feed.
    }

    if (lastMessageId) {
      this.queries.setLastParsedMessageId(sessionId, lastMessageId);
    }
  }

  private insertTurnEvent(
    session: { id: string; projectPath?: string; projectName?: string },
    _messageId: string,
    timestamp: string,
    data: { source: 'thinking' | 'response'; tool_name: string; chars: number; input_hash: string; command_preview: string },
  ): void {
    const tokens = estimateTokensFromChars(data.chars);
    const event: TokenOptimizerEvent = {
      session_id: session.id,
      tool_name: data.tool_name,
      source: data.source,
      tokens_estimated: tokens,
      output_bytes: data.chars,
      duration_ms: null,
      estimation_method: 'estimated_heuristic',
      input_hash: data.input_hash,
      created_at: timestamp,
      project_path: session.projectPath,
      project_name: session.projectName,
      command_preview: data.command_preview,
    };

    // Sólo broadcast si la fila se insertó de verdad. Si el UNIQUE INDEX
    // la dedujo (hook re-entry, compact, resume), no propagamos al feed.
    const inserted = this.queries.insertOptimizationEvent(event);
    if (!inserted) return;

    this.broadcast({
      type: 'optimization:event',
      data: {
        sessionId: event.session_id,
        source: event.source,
        tokens: event.tokens_estimated,
        toolName: event.tool_name,
        commandPreview: event.command_preview,
      },
    });
  }

  // ── Token Optimizer Integration ──

  handleTokenOptimizerEvent(event: TokenOptimizerEvent): void {
    // Dedup de origen: el HTTP POST del hook llega SIN input_hash (el hook
    // inserta en su DB source y no propaga el lastInsertRowid). El watcher
    // polling SÍ trae input_hash = id de la row source. Si insertamos los
    // HTTP sin hash, el UNIQUE INDEX parcial no los deduplica (permite
    // múltiples NULL) y acaban apareciendo en mirror dos veces (una por
    // HTTP con NULL, otra por watcher con id). Solución: ignorar inserts
    // sin input_hash y delegar en el watcher, que los capturará en <3s.
    //
    // El broadcast al dashboard sí sigue pasando — la UI en vivo beneficia
    // del HTTP directo aunque la fila definitiva se persista vía watcher.
    const hasHash = event.input_hash !== undefined
      && event.input_hash !== null
      && event.input_hash !== '';
    if (hasHash) {
      this.queries.insertOptimizationEvent(event);
    }

    this.broadcast({
      type: 'optimization:event',
      data: {
        sessionId: event.session_id,
        source: event.source,
        tokens: event.tokens_estimated,
        toolName: event.tool_name,
        ...(event.command_preview !== undefined && { commandPreview: event.command_preview }),
        ...(event.shadow_delta_tokens != null && { shadowDelta: event.shadow_delta_tokens }),
      },
    });
  }

  handleTokenOptimizerSummary(summary: TokenOptimizerSummary): void {
    this.queries.upsertOptimizationSummary(summary);

    this.broadcast({
      type: 'optimization:summary',
      data: { sessionId: summary.session_id },
    });
  }

  handleSessionEnd(sessionId: string): void {
    this.manager.clearActiveTool(sessionId);
    this.manager.handleSessionEnd(sessionId);

    this.queries.insertEvent({
      sessionId,
      eventType: 'SessionEnd',
    });

    this.broadcast({ type: 'session:end', data: { id: sessionId } });
  }
}

/**
 * Simplifica el model string del transcript para UI:
 *   claude-sonnet-4-5-20250929 → sonnet-4.5
 *   claude-opus-4-6            → opus-4.6
 *   claude-haiku-4-5-20251001  → haiku-4.5
 * Cae al string original si no encaja el patrón.
 */
function simplifyModel(model: string): string {
  const m = model.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/);
  if (!m) return model;
  return `${m[1]}-${m[2]}.${m[3]}`;
}
