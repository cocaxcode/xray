import { reactive, computed } from 'vue';
import type { PendingPermission, ClientWSEvent } from '../types';
import { useWebSocket } from './useWebSocket';

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

function resolve(id: number, decision: 'approve' | 'deny'): void {
  const { send } = useWebSocket();
  const event: ClientWSEvent = {
    type: 'permission:resolve',
    data: { id, decision },
  };
  send(event);
  removePending(id);
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
