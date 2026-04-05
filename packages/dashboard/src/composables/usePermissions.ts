import { reactive, computed } from 'vue';
import type { PendingPermission } from '../types';
import { useAuth } from './useAuth';

const pending = reactive(new Map<number, PendingPermission>());

const count = computed(() => pending.size);

function addPending(permission: PendingPermission): void {
  pending.set(permission.id, permission);

  // Browser notification
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('xray: Permiso pendiente', {
      body: `${permission.toolName} en ${permission.sessionId.slice(0, 8)}`,
      icon: '/favicon.svg',
      tag: `permission-${permission.id}`,
    });
  }
}

function removePending(id: number): void {
  pending.delete(id);
}

/**
 * Resolve permission via REST (reliable) + WebSocket broadcast handles the rest.
 * REST ensures the server gets the decision. The server broadcasts permission:resolved
 * via WebSocket, which other connected browsers also receive.
 */
async function resolve(id: number, decision: 'approve' | 'deny'): Promise<void> {
  const { getAuthHeaders } = useAuth();

  // Optimistic UI: remove immediately
  removePending(id);

  try {
    const res = await fetch(`/api/permissions/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ decision }),
    });

    if (!res.ok) {
      console.warn(`Permission resolve failed: ${res.status}`);
    }
  } catch (e) {
    console.warn('Permission resolve error:', e);
  }
}

function getBySession(sessionId: string): PendingPermission | undefined {
  for (const perm of pending.values()) {
    if (perm.sessionId === sessionId) return perm;
  }
  return undefined;
}

export function usePermissions() {
  return {
    pending,
    count,
    addPending,
    removePending,
    resolve,
    getBySession,
  };
}
