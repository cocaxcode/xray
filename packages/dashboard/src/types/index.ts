// Re-export types from server (single source of truth)
// In dev, these are duplicated. In build, they come from the same source.

export type SessionStatus = 'active' | 'idle' | 'waiting_permission' | 'waiting_input' | 'error' | 'stopped';

export interface ActiveToolInfo {
  toolName: string;
  toolUseId: string;
  agentId: string | null;
}

export interface TemplateMeta {
  name: string;
  author: string;
  version: string;
  description: string;
  tileSize: number;
  preview: string;
}

export interface McpServer {
  name: string;
  status: 'connected' | 'error';
  toolsUsed: string[];
}

export interface Agent {
  id: string;
  type: string;
  model?: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  duration?: number;
}

export interface Session {
  id: string;
  projectPath: string;
  projectName: string;
  model: string;
  status: SessionStatus;
  contextPercent: number;
  startedAt: string;
  lastEventAt: string;
  skills: string[];
  mcps: McpServer[];
  agents: Agent[];
  lastMessage: string | null;
  topic: string | null;
  eventCount: number;
  inputTokens: number;
  outputTokens: number;
  inputTokensAtStop: number;
  outputTokensAtStop: number;
  activeTool: ActiveToolInfo | null;
}

export interface PendingPermission {
  id: number;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  createdAt: string;
}

export interface ProjectGroup {
  name: string;
  path: string;
  sessions: Session[];
  pendingPermissions: number;
}

export interface ToolEvent {
  id: number;
  sessionId: string;
  eventType: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResponse?: Record<string, unknown>;
  agentId?: string;
  agentType?: string;
  success: boolean;
  durationMs?: number;
  createdAt: string;
}

export interface SessionSummary {
  duration: number;
  filesTouched: Array<{ path: string; editCount: number }>;
  toolBreakdown: Array<{ tool: string; count: number }>;
  errorCount: number;
  mcpsUsed: Array<{ name: string; callCount: number }>;
  agentsSpawned: Array<{ type: string; count: number; totalDuration: number }>;
  totalInputTokens: number;
  totalOutputTokens: number;
  tokensByAgent: Array<{ agentId: string; type: string; input: number; output: number }>;
}

export interface ProjectsResponse {
  projects: ProjectGroup[];
  totals: {
    projects: number;
    activeSessions: number;
    idleSessions: number;
    pendingPermissions: number;
  };
}

export interface SessionEventsResponse {
  events: ToolEvent[];
  total: number;
  page: number;
  pageSize: number;
}

export type ServerWSEvent =
  | { type: 'session:start'; data: Session }
  | { type: 'session:update'; data: { id: string } & Partial<Session> }
  | { type: 'session:end'; data: { id: string } }
  | { type: 'tool:activity'; data: ToolEvent }
  | { type: 'permission:pending'; data: PendingPermission }
  | { type: 'permission:resolved'; data: { id: number; decision: string } }
  | { type: 'agent:start'; data: { sessionId: string; agent: Agent } }
  | { type: 'agent:stop'; data: { sessionId: string; agentId: string } }
  | { type: 'notification'; data: { sessionId: string; type: string; message: string } }
  | { type: 'config:auto-approve'; data: { enabled: boolean } }
  | { type: 'permission:auto-approved'; data: PendingPermission };

export type ClientWSEvent =
  | { type: 'permission:resolve'; data: { id: number; decision: 'approve' | 'deny' } };
