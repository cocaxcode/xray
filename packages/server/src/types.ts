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

export interface PermissionResponse {
  hookSpecificOutput: {
    hookEventName: 'PermissionRequest';
    decision: {
      behavior: 'allow' | 'deny';
    };
  };
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
  eventCount: number;
  inputTokens: number;
  outputTokens: number;
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
  | { type: 'config:updated'; data: Record<string, unknown> };

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

// ── Context Estimation ──

export const CONTEXT_WEIGHTS: Record<string, number> = {
  Read: 0.3,
  Grep: 0.2,
  Glob: 0.1,
  Edit: 0.5,
  Write: 0.8,
  Bash: 1.0,
  Agent: 2.0,
  WebFetch: 0.8,
  WebSearch: 0.5,
  default: 0.4,
};

export const CONTEXT_MAX_UNITS = 250;
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
