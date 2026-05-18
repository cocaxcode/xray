import type { PermissionResponse, PendingPermission, ServerWSEvent } from '../types.js';
import type { Queries } from '../db/queries.js';

interface DeferredPermission {
  resolve: (response: PermissionResponse | Record<string, never>) => void;
  timer: NodeJS.Timeout;
  permissionId: number;
}

// Tools que representan preguntas explícitas al usuario sobre qué camino tomar.
// Nunca se auto-aprueban aunque el toggle esté activo: Xray se abstiene y deja
// que Claude Code los gestione de forma nativa.
const NEVER_AUTO_APPROVE = new Set<string>([
  'AskUserQuestion',
  'ExitPlanMode',
]);

export class PermissionHandler {
  private pending = new Map<number, DeferredPermission>();
  private queries: Queries;
  private broadcast: (event: ServerWSEvent) => void;
  private _autoApprove = false;

  constructor(
    queries: Queries,
    broadcast: (event: ServerWSEvent) => void,
    initialAutoApprove = false,
  ) {
    this.queries = queries;
    this.broadcast = broadcast;
    this._autoApprove = initialAutoApprove;
  }

  get autoApprove(): boolean { return this._autoApprove; }
  set autoApprove(val: boolean) {
    this._autoApprove = val;
    console.log(`[xray] Auto-approve set to: ${val}`);
  }

  /** True si una solicitud para `toolName` será auto-aprobada con el estado actual. */
  willAutoApprove(toolName: string): boolean {
    return this._autoApprove && !NEVER_AUTO_APPROVE.has(toolName);
  }

  /**
   * Maneja un PermissionRequest. Resuelve siempre de inmediato — Xray nunca
   * rechaza por su cuenta:
   *  - autoApprove ON  → aprueba (`behavior: 'allow'`).
   *  - autoApprove OFF → se abstiene (`{}`); Claude Code muestra su prompt
   *    nativo de permiso en la terminal.
   * Los tools de NEVER_AUTO_APPROVE siempre se abstienen aunque el toggle esté ON.
   */
  async handlePermissionRequest(
    sessionId: string,
    toolName: string,
    toolInput: Record<string, unknown>
  ): Promise<PermissionResponse | Record<string, never>> {
    console.log(`[xray] Permission request: tool=${toolName}, autoApprove=${this._autoApprove}`);

    if (!this.willAutoApprove(toolName)) {
      // Xray se abstiene: Claude Code pedirá el permiso de forma nativa.
      return {};
    }

    const permissionId = this.queries.insertPendingPermission(
      sessionId,
      toolName,
      JSON.stringify(toolInput)
    );
    this.queries.updatePermission(permissionId, 'approved');

    const permission: PendingPermission = {
      id: permissionId,
      sessionId,
      toolName,
      toolInput,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.broadcast({ type: 'permission:auto-approved', data: permission });
    console.log(`[xray] Auto-approving permission #${permissionId} for ${toolName}`);

    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'allow',
          updatedInput: toolInput,
        },
      },
    };
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
   * Limpia filas DB de permisos huérfanas de la sesion.
   *
   * Solo limpia entradas que NO tienen un deferred activo en memoria. Un
   * deferred activo es un long-poll legítimo esperando la decisión del usuario
   * en el dashboard; resolverlo equivale a auto-rechazar la petición (devolver
   * `{}` a Claude Code = "sin decisión", que en subagentes es un deny directo).
   * Con herramientas/subagentes en paralelo, un PreToolUse de otra herramienta
   * no implica que el permiso pendiente ya se resolvió, así que nunca tocamos
   * los long-polls vivos.
   */
  cleanupBySession(sessionId: string): void {
    const dbPending = this.queries.getPendingPermissionsBySession(sessionId);
    for (const perm of dbPending) {
      if (this.pending.has(perm.id)) continue; // long-poll activo: no tocar
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
