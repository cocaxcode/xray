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
} from '../types.js';
import type { SessionManager } from '../sessions/manager.js';
import type { Queries } from '../db/queries.js';

export class HookHandlers {
  private manager: SessionManager;
  private queries: Queries;
  private broadcast: (event: ServerWSEvent) => void;

  constructor(
    manager: SessionManager,
    queries: Queries,
    broadcast: (event: ServerWSEvent) => void
  ) {
    this.manager = manager;
    this.queries = queries;
    this.broadcast = broadcast;
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
      this.broadcast({ type: 'session:update', data: { id: session.id, status: session.status, mcps: session.mcps, contextPercent: session.contextPercent } });
    }
  }

  handlePostToolUse(payload: PostToolUsePayload): void {
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
      this.broadcast({ type: 'session:update', data: { id: session.id, inputTokens: session.inputTokens, outputTokens: session.outputTokens } });
    }
  }

  handlePostToolUseFailure(payload: PostToolUseFailurePayload): void {
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

    const session = this.manager.getSession(payload.session_id);
    if (session) {
      this.broadcast({ type: 'session:update', data: { id: session.id, status: 'idle', lastMessage: session.lastMessage, inputTokens: session.inputTokens, outputTokens: session.outputTokens } });
    }
  }

  handleSessionEnd(sessionId: string): void {
    this.manager.handleSessionEnd(sessionId);

    this.queries.insertEvent({
      sessionId,
      eventType: 'SessionEnd',
    });

    this.broadcast({ type: 'session:end', data: { id: sessionId } });
  }
}
