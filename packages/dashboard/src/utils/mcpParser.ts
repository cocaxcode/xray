/**
 * mcp__memory__recall → { server: "memory", tool: "recall" }
 * Bash → null
 */
export function parseMcpName(toolName: string): { server: string; tool: string } | null {
  if (!toolName.startsWith('mcp__')) return null;
  const parts = toolName.split('__');
  if (parts.length < 3) return null;
  return { server: parts[1], tool: parts.slice(2).join('__') };
}

/**
 * Formats tool name + input for display in activity feed.
 * Edit: auth.vue (L45-67)
 * Bash: npm test
 * Read: src/utils.ts
 * mcp__memory__recall: "auth patterns"
 */
export function formatToolDisplay(toolName: string, toolInput: Record<string, unknown>): string {
  const mcp = parseMcpName(toolName);
  const displayName = mcp ? `${mcp.server}:${mcp.tool}` : toolName;

  let detail = '';

  switch (toolName) {
    case 'Edit':
    case 'Write':
    case 'Read':
      detail = shortPath(toolInput.file_path as string);
      break;
    case 'Bash': {
      const cmd = toolInput.command as string;
      detail = cmd ? truncateCmd(cmd, 40) : '';
      break;
    }
    case 'Grep': {
      detail = toolInput.pattern as string || '';
      break;
    }
    case 'Glob': {
      detail = toolInput.pattern as string || '';
      break;
    }
    case 'WebSearch': {
      detail = toolInput.query as string || '';
      break;
    }
    case 'Agent': {
      detail = toolInput.description as string || toolInput.prompt as string || '';
      break;
    }
    default: {
      if (mcp) {
        // For MCP tools, try to show first meaningful input value
        const values = Object.values(toolInput).filter(v => typeof v === 'string');
        detail = values[0] ? truncateCmd(values[0] as string, 30) : '';
      }
    }
  }

  return detail ? `${displayName}: ${detail}` : displayName;
}

function shortPath(fullPath: string | undefined): string {
  if (!fullPath) return '';
  // Take last 2 segments: "src/auth.vue"
  const parts = fullPath.replace(/\\/g, '/').split('/');
  return parts.slice(-2).join('/');
}

function truncateCmd(cmd: string, max: number): string {
  if (cmd.length <= max) return cmd;
  return cmd.slice(0, max - 1) + '\u2026';
}

/**
 * Icon for tool type
 */
export function getToolIcon(toolName: string, eventType: string): string {
  if (eventType === 'PostToolUseFailure') return '\u2718'; // ✘
  if (eventType === 'PreToolUse') return '\u25D0'; // ◐ (half circle = in progress)
  if (eventType === 'PostToolUse') return '\u2714'; // ✔

  switch (toolName) {
    case 'Bash': return '\u{1F527}'; // 🔧
    case 'Read': return '\u{1F4D6}'; // 📖
    case 'Edit':
    case 'Write': return '\u270F'; // ✏
    case 'Grep':
    case 'Glob': return '\u{1F50D}'; // 🔍
    case 'Agent': return '\u{1F916}'; // 🤖
    default: return '\u{1F527}'; // 🔧
  }
}
