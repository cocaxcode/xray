// ── Hook Payloads (incoming from Claude Code) ──

export interface HookPayloadBase {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
  permission_mode?: string;
}

export interface SessionStartPayload extends HookPayloadBase {
  hook_event_name: 'SessionStart';
  source: 'startup' | 'resume' | 'clear' | 'compact';
  model: string;
  agent_type?: string;
}

export interface PreToolUsePayload extends HookPayloadBase {
  hook_event_name: 'PreToolUse';
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
}

export interface PostToolUsePayload extends HookPayloadBase {
  hook_event_name: 'PostToolUse';
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: Record<string, unknown>;
  tool_use_id: string;
}

export interface PostToolUseFailurePayload extends HookPayloadBase {
  hook_event_name: 'PostToolUseFailure';
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
  error: string;
  is_interrupt: boolean;
}

export interface PermissionRequestPayload extends HookPayloadBase {
  hook_event_name: 'PermissionRequest';
  tool_name: string;
  tool_input: Record<string, unknown>;
  permission_suggestions: unknown[];
}

export interface SubagentStartPayload extends HookPayloadBase {
  hook_event_name: 'SubagentStart';
  agent_id: string;
  agent_type: string;
}

export interface SubagentStopPayload extends HookPayloadBase {
  hook_event_name: 'SubagentStop';
  agent_id: string;
  agent_type: string;
  agent_transcript_path?: string;
  last_assistant_message?: string;
  stop_hook_active?: boolean;
}

export interface NotificationPayload extends HookPayloadBase {
  hook_event_name: 'Notification';
  message: string;
  title?: string;
  notification_type: 'permission_prompt' | 'idle_prompt' | 'auth_success' | 'elicitation_dialog';
}

export interface StopPayload extends HookPayloadBase {
  hook_event_name: 'Stop';
  stop_reason: string;
  model: string;
  last_assistant_message?: string;
}

export interface SessionEndPayload extends HookPayloadBase {
  hook_event_name: 'SessionEnd';
}

export type HookPayload =
  | SessionStartPayload
  | PreToolUsePayload
  | PostToolUsePayload
  | PostToolUseFailurePayload
  | PermissionRequestPayload
  | SubagentStartPayload
  | SubagentStopPayload
  | NotificationPayload
  | StopPayload
  | SessionEndPayload;

// ── Hook Responses (outgoing to Claude Code) ──

export interface PermissionRule {
  type: 'addRules';
  rules: Array<{ toolName: string; ruleContent?: string }>;
  behavior: 'allow' | 'deny';
  destination: 'session' | 'localSettings' | 'projectSettings' | 'userSettings';
}

export interface PermissionResponse {
  hookSpecificOutput: {
    hookEventName: 'PermissionRequest';
    decision: {
      behavior: 'allow' | 'deny';
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: PermissionRule[];
      message?: string;
    };
  };
}

// ── Active Tool (in-memory only, not persisted to DB) ──

export interface ActiveToolInfo {
  toolName: string;
  toolUseId: string;
  agentId: string | null;
}

// ── Domain Models ──

export type SessionStatus =
  | 'active'
  | 'idle'
  | 'waiting_permission'
  | 'waiting_input'
  | 'error'
  | 'stopped';

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

// ── WebSocket Events ──

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
  | { type: 'config:updated'; data: Record<string, unknown> }
  | { type: 'config:auto-approve'; data: { enabled: boolean } }
  | { type: 'permission:auto-approved'; data: PendingPermission }
  | { type: 'optimization:event'; data: { sessionId: string; source: string; tokens: number; toolName: string } }
  | { type: 'optimization:summary'; data: { sessionId: string } };

export type ClientWSEvent =
  | { type: 'permission:resolve'; data: { id: number; decision: 'approve' | 'deny' } };

// ── REST API Responses ──

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

export interface TokenOptimizerEvent {
  session_id: string;
  tool_name: string;
  source: 'own' | 'builtin' | 'mcp' | 'serena' | 'rtk' | 'xray';
  tokens_estimated: number;
  output_bytes: number;
  duration_ms: number | null;
  estimation_method: string;
  input_hash: string;
  created_at: string;
}

export interface TokenOptimizerSummary {
  session_id: string;
  total_tokens: number;
  total_events: number;
  by_source: Array<{ source: string; count: number; tokens: number }>;
  by_tool: Array<{ tool_name: string; count: number; tokens: number }>;
  cost_haiku: number;
  cost_sonnet: number;
  cost_opus: number;
  probes: {
    serena: { present: boolean; confidence: number; signals: string[] };
    rtk: { present: boolean; confidence: number; signals: string[] };
    mcp_pruning: { present: boolean; confidence: number; signals: string[] };
    prompt_caching: { present: boolean; confidence: number };
  };
  coach_tips_surfaced: Array<{ rule_id: string; tip_ids: string[]; severity: string }>;
  schema_measurement: { tool_schema_tokens: number; mcp_servers: string[] };
  optimizer_version: string;
}

export interface OptimizationSourceBreakdown {
  source: string;
  count: number;
  tokens: number;
}

export interface OptimizationData {
  summary: TokenOptimizerSummary | null;
  realtimeBreakdown: OptimizationSourceBreakdown[];
  eventCount: number;
}

// ── Context Estimation ──

export const CONTEXT_WEIGHTS: Record<string, number> = {
  Read: 0.15,
  Grep: 0.08,
  Glob: 0.03,
  Edit: 0.1,
  Write: 0.2,
  Bash: 0.3,
  Agent: 1.5,
  WebFetch: 0.4,
  WebSearch: 0.3,
  TodoWrite: 0.02,
  default: 0.1,
};

export const CONTEXT_MAX_UNITS = 800;
export const CONTEXT_COMPACT_RESET = 20;

// ── CLI Config ──

export interface CliOptions {
  port: number;
  expose: boolean;
  authToken?: string;
  noOpen: boolean;
  domain?: string;
}

// ── Hooks Config (for settings.json) ──

export interface XrayHookEntry {
  type: 'http';
  url: string;
  timeout?: number;
}

export interface XrayHookConfig {
  matcher: string;
  hooks: XrayHookEntry[];
}

// ── Auth ──

export interface AuthState {
  token: string;
  pin: string | null;
  pinExpiresAt: number;
}
