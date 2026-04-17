# @cocaxcode/xray

Dashboard en tiempo real para visualizar todas las sesiones de Claude Code activas, agrupadas por proyecto.

## Stack
- Monorepo: pnpm workspaces
- Server: Fastify 5 + better-sqlite3 + @fastify/websocket (packages/server)
- Dashboard: Vue 3 + Vite + TailwindCSS (packages/dashboard)
- Todo en TypeScript estricto

## Convenciones
- Composition API con `<script setup>` en Vue
- Composables en src/composables/ con prefijo use*
- Tipos compartidos en packages/server/src/types.ts (single source of truth)
- SQLite: prepared statements, WAL mode, FTS5 para busqueda
- CSS: TailwindCSS con CSS custom properties para temas dark/light

## Colores de marca
- Cyan: #00F5D4 (estados activos, acentos)
- Purple: #8250FF (branding, waiting_input)
- Fondo dark: #0A0A0E
- Superficie dark: #141419
- Texto: #E4E4E7
- Texto secundario: #71717A

## Arquitectura clave
- Los hooks de Claude Code hacen HTTP POST al servidor
- El servidor almacena en SQLite y emite por WebSocket al dashboard
- PermissionRequest mantiene la conexion HTTP abierta hasta respuesta del usuario (max 540s)
- El dashboard NO es un terminal — muestra estado, actividad e historial
- Modo remoto: --expose con auth QR + PIN de 6 digitos
- Tokens reales (SessionCard header) extraidos del transcript JSONL de cada sesion
- Tokens per-tool (OptimizationView) son ESTIMADOS por token-optimizer-mcp con
  heuristica chars × 0.27 — no son lo facturado por Anthropic. Etiquetado
  como tal en la UI.

## Schema mirror de token-optimizer

- Tabla `optimization_events`: replica de `tool_calls` de token-optimizer
  con polling cada 3s (optimizer-watcher.ts). Resume desde el id maximo
  mirrored (guardado en `input_hash` como string para no requerir schema extra).
- Columnas relevantes: `source`, `tokens_estimated`, `estimation_method`,
  `shadow_delta_tokens` (schema v6+, propagado automaticamente desde la
  source si token-optimizer tiene el campo relleno).

## Savings factors (endpoint `/api/savings-factors`)

Calcula el factor de ahorro MEDIDO sobre `shadow_delta_tokens` por source:
- Para cada source (`serena`, `rtk`): toma todas las filas con shadow
  medido, calcula factor por call `(consumed + saved) / consumed`, devuelve
  mediana + media + confianza (low/medium/high segun n).
- OptimizationView lo consume en paralelo a `/api/optimization` y sustituye
  las constantes fallback `×5` (serena) y `×4` (rtk) por el factor medido
  cuando hay >=10 calls. Cada card indica `MEDIDO` o `BASELINE` en el badge.

## Desarrollo
```bash
pnpm install                 # Instalar dependencias
pnpm build:dashboard         # Compilar dashboard (output en server/dist/dashboard/)
pnpm build:server            # Compilar servidor
pnpm build                   # Compilar todo
pnpm dev:dashboard           # Dev server del dashboard (localhost:5173)
pnpm test                    # Tests del servidor (vitest)
```

## Testing
- Vitest para server
- Tests de hooks: simular POSTs con Fastify inject()
- Tests de permisos: verificar ciclo completo approve/deny/timeout
