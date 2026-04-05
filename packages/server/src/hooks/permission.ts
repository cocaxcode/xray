import type { PermissionResponse, PendingPermission, ServerWSEvent } from '../types.js';
import type { Queries } from '../db/queries.js';

interface DeferredPermission {
  resolve: (response: PermissionResponse | Record<string, never>) => void;
  timer: NodeJS.Timeout;
  permissionId: number;
}

const PERMISSION_TIMEOUT_MS = 540_000; // 9 minutos

export class PermissionHandler {
  private pending = new Map<number, DeferredPermission>();
  private queries: Queries;
  private broadcast: (event: ServerWSEvent) => void;

  constructor(queries: Queries, broadcast: (event: ServerWSEvent) => void) {
    this.queries = queries;
    this.broadcast = broadcast;
  }

  /**
   * Maneja un PermissionRequest. Devuelve una Promise que se resuelve
   * cuando el usuario responde o cuando expira el timeout.
   */
  async handlePermissionRequest(
    sessionId: string,
    toolName: string,
    toolInput: Record<string, unknown>
  ): Promise<PermissionResponse | Record<string, never>> {
    const permissionId = this.queries.insertPendingPermission(
      sessionId,
      toolName,
      JSON.stringify(toolInput)
    );

    const permission: PendingPermission = {
      id: permissionId,
      sessionId,
      toolName,
      toolInput,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    // Broadcast al dashboard
    this.broadcast({ type: 'permission:pending', data: permission });

    // Crear deferred promise
    return new Promise<PermissionResponse | Record<string, never>>((resolve) => {
      const timer = setTimeout(() => {
        // Timeout — limpiar y responder vacio
        this.pending.delete(permissionId);
        this.queries.updatePermission(permissionId, 'expired');
        this.broadcast({ type: 'permission:resolved', data: { id: permissionId, decision: 'expired' } });
        resolve({});
      }, PERMISSION_TIMEOUT_MS);

      this.pending.set(permissionId, { resolve, timer, permissionId });
    });
  }

  /**
   * Resuelve un permiso pendiente. First-wins: si ya fue resuelto, ignora.
   */
  resolvePermission(permissionId: number, decision: 'approve' | 'deny'): boolean {
    const deferred = this.pending.get(permissionId);
    if (!deferred) return false;

    clearTimeout(deferred.timer);
    this.pending.delete(permissionId);

    const status = decision === 'approve' ? 'approved' : 'denied';
    this.queries.updatePermission(permissionId, status);

    this.broadcast({
      type: 'permission:resolved',
      data: { id: permissionId, decision: status },
    });

    if (decision === 'approve') {
      deferred.resolve({
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: { behavior: 'allow' },
        },
      });
    } else {
      deferred.resolve({
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: { behavior: 'deny' },
        },
      });
    }

    return true;
  }

  /**
   * Limpia todos los permisos pendientes (cleanup al cerrar)
   */
  cleanup(): void {
    for (const [, deferred] of this.pending) {
      clearTimeout(deferred.timer);
      deferred.resolve({});
    }
    this.pending.clear();
  }
}
