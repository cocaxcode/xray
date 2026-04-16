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

// ── Token Optimizer Integration ──

export interface OptimizationSourceBreakdown {
  source: string;
  count: number;
  tokens: number;
}

export interface OptimizationProbes {
  serena: { present: boolean; confidence: number; signals: string[] };
  rtk: { present: boolean; confidence: number; signals: string[] };
  mcp_pruning: { present: boolean; confidence: number; signals: string[] };
  prompt_caching: { present: boolean; confidence: number };
}

export interface OptimizationSummary {
  session_id: string;
  total_tokens: number;
  total_events: number;
  by_source: OptimizationSourceBreakdown[];
  by_tool: Array<{ tool_name: string; count: number; tokens: number }>;
  cost_haiku: number;
  cost_sonnet: number;
  cost_opus: number;
  probes: OptimizationProbes | null;
  coach_tips_surfaced: Array<{ rule_id: string; tip_ids: string[]; severity: string }>;
  schema_measurement: { tool_schema_tokens: number; mcp_servers: string[] } | null;
  optimizer_version: string;
}

export interface OptimizationData {
  summary: OptimizationSummary | null;
  realtimeBreakdown: OptimizationSourceBreakdown[];
  eventCount: number;
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
  | { type: 'permission:auto-approved'; data: PendingPermission }
  | { type: 'optimization:event'; data: { sessionId: string; source: string; tokens: number; toolName: string; commandPreview?: string } }
  | { type: 'optimization:summary'; data: { sessionId: string } };

export type ClientWSEvent =
  | { type: 'permission:resolve'; data: { id: number; decision: 'approve' | 'deny' } };
