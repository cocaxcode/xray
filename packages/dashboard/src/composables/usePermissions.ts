import { ref, computed } from 'vue';
import type { PendingPermission } from '../types';
import { useAuth } from './useAuth';

// Usar ref con Map — crear nuevo Map en cada mutacion para garantizar reactividad
const pending = ref<Map<number, PendingPermission>>(new Map());

const count = computed(() => pending.value.size);

function addPending(permission: PendingPermission): void {
  const next = new Map(pending.value);
  next.set(permission.id, permission);
  pending.value = next;

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
  if (!pending.value.has(id)) return;
  const next = new Map(pending.value);
  next.delete(id);
  pending.value = next;
}

/**
 * Resolve permission via REST. Remove from UI immediately.
 */
async function resolve(id: number, decision: 'approve' | 'deny'): Promise<void> {
  const { getAuthHeaders } = useAuth();

  // Remove from UI immediately
  removePending(id);

  try {
    await fetch(`/api/permissions/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ decision }),
    });
  } catch (e) {
    console.warn('Permission resolve error:', e);
  }
}

function getBySession(sessionId: string): PendingPermission | undefined {
  for (const perm of pending.value.values()) {
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
