import { Queries } from '../db/queries.js';
import type { Session, SessionStatus, Agent } from '../types.js';
import { updateMcps, calculateContextIncrement, getCompactResetPercent, detectSkills } from './detector.js';
import { readNewTokens } from './transcript-reader.js';

export class SessionManager {
  private queries: Queries;

  constructor(queries: Queries) {
    this.queries = queries;
  }

  /**
   * Normaliza cwd: elimina trailing slash y convierte backslashes
   */
  private normalizePath(cwd: string): string {
    return cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  }

  private extractProjectName(cwd: string): string {
    const normalized = this.normalizePath(cwd);
    return normalized.split('/').pop() || normalized;
  }

  // ── Session Lifecycle ──

  handleSessionStart(payload: {
    session_id: string;
    cwd: string;
    model: string;
    source: string;
    transcript_path: string;
  }): Session {
    const projectPath = this.normalizePath(payload.cwd);
    const projectName = this.extractProjectName(payload.cwd);

    if (this.queries.sessionExists(payload.session_id)) {
      // Session resume (compact, clear, etc)
      const updates: Record<string, unknown> = {
        model: payload.model,
        status: 'active',
        last_event_at: new Date().toISOString(),
        transcript_path: payload.transcript_path,
      };

      if (payload.source === 'compact') {
        updates.context_percent = getCompactResetPercent();
        updates.context_units = (getCompactResetPercent() / 100) * 250;
      }

      this.queries.updateSession(payload.session_id, updates);
    } else {
      // New session
      this.queries.insertSession({
        id: payload.session_id,
        projectPath,
        projectName,
        model: payload.model,
        transcriptPath: payload.transcript_path,
      });

      // Detect skills from project
      const skills = detectSkills(payload.cwd);
      if (skills.length > 0) {
        this.queries.updateSession(payload.session_id, {
          skills: JSON.stringify(skills),
        });
      }
    }

    return this.queries.getSession(payload.session_id)!;
  }

  handleStop(payload: {
    session_id: string;
    last_assistant_message?: string;
  }): void {
    this.queries.updateSession(payload.session_id, {
      status: 'idle',
      last_message: payload.last_assistant_message ?? null,
      last_event_at: new Date().toISOString(),
    });
  }

  updateModel(sessionId: string, model: string): void {
    this.queries.updateSession(sessionId, { model });
  }

  updateTopic(sessionId: string, topic: string): void {
    this.queries.updateSession(sessionId, { topic });
  }

  handleSessionEnd(sessionId: string): void {
    this.queries.updateSession(sessionId, {
      status: 'stopped',
      last_event_at: new Date().toISOString(),
    });
  }

  // ── State Machine ──

  transitionTo(sessionId: string, newStatus: SessionStatus): void {
    this.queries.updateSession(sessionId, {
      status: newStatus,
      last_event_at: new Date().toISOString(),
    });
  }

  // ── Metadata Updates ──

  updateMcpsFromToolCall(sessionId: string, toolName: string, success: boolean): void {
    const session = this.queries.getSession(sessionId);
    if (!session) return;

    const updatedMcps = updateMcps(session.mcps, toolName, success);
    if (updatedMcps !== session.mcps) {
      this.queries.updateSession(sessionId, {
        mcps: JSON.stringify(updatedMcps),
      });
    }
  }

  updateContextEstimate(sessionId: string, toolName: string): void {
    const session = this.queries.getSession(sessionId);
    if (!session) return;

    const increment = calculateContextIncrement(toolName);
    const newPercent = Math.min(100, session.contextPercent + increment);

    this.queries.updateSession(sessionId, {
      context_percent: newPercent,
    });
  }

  /**
   * Actualiza el transcript_path si falta en la DB
   */
  fixTranscriptPath(sessionId: string, transcriptPath: string): void {
    const info = this.queries.getSessionTranscriptInfo(sessionId);
    if (!info && transcriptPath) {
      this.queries.updateSession(sessionId, { transcript_path: transcriptPath });
    }
  }

  updateTokens(sessionId: string): void {
    const info = this.queries.getSessionTranscriptInfo(sessionId);
    if (!info) return;

    const result = readNewTokens(info.transcriptPath, info.transcriptOffset);

    if (result.inputTokens > 0 || result.outputTokens > 0) {
      this.queries.updateSessionTokens(
        sessionId,
        info.inputTokens + result.inputTokens,
        info.outputTokens + result.outputTokens,
        result.newOffset,
      );
    }
  }

  // ── Agents ──

  addAgent(sessionId: string, agent: Agent): void {
    const session = this.queries.getSession(sessionId);
    if (!session) return;

    const agents = [...session.agents, agent];
    this.queries.updateSession(sessionId, {
      agents: JSON.stringify(agents),
    });
  }

  completeAgent(sessionId: string, agentId: string): Agent | null {
    const session = this.queries.getSession(sessionId);
    if (!session) return null;

    const agent = session.agents.find(a => a.id === agentId);
    if (!agent) return null;

    agent.status = 'completed';
    agent.duration = Date.now() - new Date(agent.startedAt).getTime();

    this.queries.updateSession(sessionId, {
      agents: JSON.stringify(session.agents),
    });

    return agent;
  }

  // ── Queries ──

  getSession(sessionId: string): Session | null {
    return this.queries.getSession(sessionId);
  }

  getProjectGroups(includeStopped = false) {
    return this.queries.getProjectGroups(includeStopped);
  }

  markStaleSessions(): string[] {
    return this.queries.markStaleSessions();
  }
}
