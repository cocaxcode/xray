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
- Tokens reales extraidos del transcript JSONL de cada sesion

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
