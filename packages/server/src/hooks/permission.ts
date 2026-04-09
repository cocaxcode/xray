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
  private _autoApprove = false;

  constructor(queries: Queries, broadcast: (event: ServerWSEvent) => void) {
    this.queries = queries;
    this.broadcast = broadcast;
  }

  get autoApprove(): boolean { return this._autoApprove; }
  set autoApprove(val: boolean) {
    this._autoApprove = val;
    console.log(`[xray] Auto-approve set to: ${val}`);
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

    // Auto-approve: resolve immediately without waiting
    console.log(`[xray] Permission request: tool=${toolName}, autoApprove=${this._autoApprove}`);
    if (this._autoApprove) {
      console.log(`[xray] Auto-approving permission #${permissionId} for ${toolName}`);
      this.queries.updatePermission(permissionId, 'approved');
      this.broadcast({ type: 'permission:auto-approved', data: permission });
      const response: PermissionResponse = {
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: {
            behavior: 'allow',
            updatedInput: toolInput,
          },
        },
      };
      console.log(`[xray] Returning auto-approve response:`, JSON.stringify(response));
      return response;
    }

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
  resolvePermission(
    permissionId: number,
    decision: 'approve' | 'deny' | 'allowAlways',
    toolName?: string,
    toolInput?: Record<string, unknown>,
  ): boolean {
    const deferred = this.pending.get(permissionId);
    if (!deferred) return false;

    clearTimeout(deferred.timer);
    this.pending.delete(permissionId);

    const status = decision === 'deny' ? 'denied' : 'approved';
    this.queries.updatePermission(permissionId, status);

    this.broadcast({
      type: 'permission:resolved',
      data: { id: permissionId, decision: status },
    });

    // Claude Code only accepts 'allow' or 'deny'. For allowAlways, use allow +
    // updatedPermissions to persist a rule for future calls.
    if (decision === 'deny') {
      deferred.resolve({
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: { behavior: 'deny' },
        },
      });
    } else if (decision === 'allowAlways' && toolName) {
      deferred.resolve({
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: {
            behavior: 'allow',
            updatedInput: toolInput || {},
            updatedPermissions: [{
              type: 'addRules',
              rules: [{ toolName }],
              behavior: 'allow',
              destination: 'session',
            }],
          },
        },
      });
    } else {
      deferred.resolve({
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: {
            behavior: 'allow',
            updatedInput: toolInput || {},
          },
        },
      });
    }

    return true;
  }

  /**
   * Devuelve los IDs de permisos que realmente están esperando respuesta
   */
  getActivePending(): number[] {
    return Array.from(this.pending.keys());
  }

  /** Returns full PendingPermission objects for all active (in-memory) pending permissions */
  getActivePendingFull(): PendingPermission[] {
    const result: PendingPermission[] = [];
    for (const id of this.pending.keys()) {
      const perm = this.queries.getPendingPermission(id);
      if (perm) result.push(perm);
    }
    return result;
  }

  /**
   * Limpia todos los permisos pendientes de una sesion.
   * Limpia TANTO el Map en memoria COMO la base de datos.
   */
  cleanupBySession(sessionId: string): void {
    // 1. Limpiar del Map en memoria (deferred promises)
    for (const [id, deferred] of this.pending) {
      const perm = this.queries.getPendingPermission(id);
      if (perm && perm.sessionId === sessionId) {
        clearTimeout(deferred.timer);
        this.pending.delete(id);
        deferred.resolve({});
      }
    }

    // 2. Limpiar de la DB — marcar como expired y notificar al dashboard
    const dbPending = this.queries.getPendingPermissionsBySession(sessionId);
    for (const perm of dbPending) {
      this.queries.updatePermission(perm.id, 'expired');
      this.broadcast({ type: 'permission:resolved', data: { id: perm.id, decision: 'expired' } });
    }
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
