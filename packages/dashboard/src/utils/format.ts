/**
 * claude-opus-4-6 → "Opus 4.6"
 * claude-sonnet-4-6 → "Sonnet 4.6"
 * claude-haiku-4-5 → "Haiku 4.5"
 */
export function formatModel(model: string): string {
  if (!model) return 'Unknown';
  const lower = model.toLowerCase();

  if (lower.includes('opus')) {
    const ver = extractVersion(lower);
    return `Opus ${ver}`;
  }
  if (lower.includes('sonnet')) {
    const ver = extractVersion(lower);
    return `Sonnet ${ver}`;
  }
  if (lower.includes('haiku')) {
    const ver = extractVersion(lower);
    return `Haiku ${ver}`;
  }

  return model;
}

function extractVersion(model: string): string {
  // claude-opus-4-6 → 4.6
  const match = model.match(/(\d+)-(\d+)/);
  if (match) return `${match[1]}.${match[2]}`;
  return '';
}

/**
 * Model color for badges
 */
export function getModelColor(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return 'var(--color-purple)';
  if (lower.includes('sonnet')) return 'var(--color-cyan)';
  if (lower.includes('haiku')) return 'var(--color-green)';
  return 'var(--color-muted)';
}

/**
 * Milliseconds → "2m 15s", "45s", "1h 3m"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

/**
 * ISO timestamp → "14:23:07"
 */
export function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

/**
 * 12400 → "12.4K", 1200000 → "1.2M", 890 → "890"
 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * Truncate a string with ellipsis
 */
export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '\u2026';
}

/**
 * Relative time: "hace 2m", "hace 1h", "ahora"
 */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 30) return 'ahora';
  if (secs < 60) return `hace ${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  return `hace ${hours}h`;
}
