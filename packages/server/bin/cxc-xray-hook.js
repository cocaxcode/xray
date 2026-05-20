#!/usr/bin/env node
// Wrapper tolerante para hooks de Claude Code.
// Reenvia el payload del stdin al servidor de xray en localhost:{port}/api/hook/{event}.
// Si el servidor no esta corriendo, falla en silencio con exit 0 (nunca ensucia la consola).
//
// Uso desde settings.json:
//   { "type": "command", "command": "cxc-xray-hook pre-tool-use 3333" }

const event = process.argv[2];
const port = process.argv[3] || '3333';

if (!event) {
  process.exit(0);
}

// PermissionRequest es long-polling: el servidor mantiene la conexion hasta 540s.
// Para el resto, 3s es mas que suficiente a localhost.
const timeoutMs = event === 'permission-request' ? 540_000 : 3_000;

// Safety net: si algo se cuelga inesperadamente, matamos el proceso despues
// del timeout + margen. Nunca dejar un wrapper vivo indefinidamente.
const safetyTimer = setTimeout(() => {
  process.exit(0);
}, timeoutMs + 1000);
safetyTimer.unref();

async function main() {
  let body = '';

  // Claude Code pasa el payload del hook por stdin.
  // Si no es TTY, leemos hasta EOF. Si es TTY (ejecucion manual), no bloqueamos.
  if (!process.stdin.isTTY) {
    try {
      for await (const chunk of process.stdin) {
        body += chunk;
      }
    } catch {
      // Error leyendo stdin: seguir con body vacio.
    }
  }

  try {
    const response = await fetch(`http://localhost:${port}/api/hook/${event}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body || '{}',
      signal: AbortSignal.timeout(timeoutMs),
    });

    // Para PermissionRequest, reenviar el body de la respuesta a stdout
    // para que Claude Code lo lea (decision allow/deny + updatedInput).
    if (event === 'permission-request' && response.ok) {
      const text = await response.text();
      if (text) {
        process.stdout.write(text);
      }
    }
  } catch (err) {
    // Servidor caido, timeout, o cualquier error de red.
    //
    // Crucial para `permission-request`: si fallamos en silencio, Claude Code
    // recibe stdout vacio y lo interpreta como "sin decision" -> cae al deny por
    // defecto en ediciones fuera del cwd (skills, agentes en ~/.claude/...).
    // Eso confunde porque el usuario cree que xray esta auto-aprobando.
    //
    // Aviso por stderr (Claude Code lo muestra como nota del hook) para que el
    // rechazo no sea misterioso. Seguimos saliendo con exit 0 para no romper la
    // ejecucion del agente.
    if (event === 'permission-request') {
      const code = err && (err.cause?.code || err.code);
      const reason =
        code === 'ECONNREFUSED' ? `servidor xray no esta corriendo en :${port}` :
        err?.name === 'TimeoutError' || code === 'UND_ERR_HEADERS_TIMEOUT' ? `timeout (${timeoutMs}ms) hablando con xray :${port}` :
        `error de red contactando xray :${port} (${err?.message || code || 'desconocido'})`;
      try {
        process.stderr.write(
          `[cxc-xray-hook] ${reason}. Sin respuesta del hook -> Claude Code aplicara su politica por defecto (puede rechazar edits fuera del cwd). Arranca xray con \`cxc-xray\`.\n`,
        );
      } catch {
        // si stderr falla, no hay nada mas que hacer.
      }
    }
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
