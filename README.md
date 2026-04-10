# xray

**Real-time dashboard for all your Claude Code sessions.** Watch every agent working across every project from a single pane — or from a pixel-art battlefield where each session is a warrior fighting goblins.

<video src="https://github.com/cocaxcode/xray/raw/master/docs/xray-demo.webm" controls muted width="100%"></video>

> [Watch demo video](docs/xray-demo.webm)

## What is this?

xray is a local server that hooks into [Claude Code](https://claude.com/claude-code) and visualises every active session in real time. It shows you:

- Which projects have Claude running
- What each session is doing right now (tool calls, MCPs, sub-agents)
- Token usage, activity history, and the last message from the model
- Permission requests that need your approval — centralised in one place
- Questions the AI is waiting on (`waiting_input`) so you never miss one

Two visualisations out of the box:

- **Panel view** — classic card-based dashboard with session cards, activity feeds, and detail panels
- **Warriors view** — a pixel-art RPG map where each session is a warrior fighting a camp of goblins (goblin count scales with token usage). Companions are sub-agents, crystals are MCPs, equipment are skills.

## Install

```bash
npm install -g @cocaxcode/xray
```

Then inside any project:

```bash
cxc-xray setup          # Installs the hooks for this Claude Code project
cxc-xray                # Starts the dashboard on http://localhost:3333
```

The setup command registers Claude Code hooks that forward every tool call, permission request and session event to the xray server.

## Features

### Permission management
- Incoming permission requests show up in both views with **Aprobar** / **Denegar** buttons
- Requests follow the character on the map — no more clicking where the bubble used to be
- **Auto-approve mode** toggle in the top bar: all future permissions are accepted automatically
- Bubbles disappear automatically when the next event arrives

### AI waiting for input
When Claude asks you a question, the actual question appears as a purple bubble over the character and as a banner in the session card. As soon as the model continues thinking, the bubble disappears.

### Templates (Warriors and beyond)
The scene engine is 100% template-agnostic — every visual, animation, map, and gameplay constant is defined in a `template.json`. The only built-in template is **Warriors**, but you can drop a new folder into `~/.xray/templates/` and it appears in the view switcher without restarting the server.

A template defines:

- Maps (tile grids + walkability + zones for work/rest/spawn/exit)
- Sprites with per-animation sheets (Tiny Swords format supported)
- State-to-animation mappings, tool animations, agent types
- Enemy scaling thresholds, decorations, colors, background
- All gameplay mechanics: walk speed, combat distances, formation size, render scales

No code changes required for a new template — just JSON and PNGs.

### Remote access
```bash
cxc-xray --expose --domain https://xray.example.com
```
Exposes the dashboard with a QR code + 6-digit PIN for mobile access. Auth token persists across restarts.

### Real token usage
Tokens are read directly from Claude Code's JSONL transcripts — no approximations, no counting yourself.

## Stack

- **Monorepo**: pnpm workspaces
- **Server**: Fastify 5 + better-sqlite3 + @fastify/websocket
- **Dashboard**: Vue 3 + Vite + TailwindCSS 4
- **Scene engine**: Canvas 2D, A* pathfinding, per-animation sprite sheets, hue-shifted palette swaps
- **Language**: TypeScript strict mode everywhere

## Development

```bash
pnpm install                 # Install dependencies
pnpm build                   # Build dashboard + server
pnpm dev:dashboard           # Dev server (localhost:5173) with HMR
pnpm test                    # Run server tests (vitest)
```

Dashboard dev server proxies API + WebSocket to the backend on `localhost:3333`. Start the real xray server separately with `pnpm start` or `node packages/server/bin/cxc-xray.js`.

## Architecture

```
Claude Code hooks ──POST──▶ Fastify server ──WebSocket──▶ Vue dashboard
                                  │
                                  ├─▶ SQLite (sessions, events, permissions)
                                  └─▶ In-memory state (active tools, pending permissions)
```

The `PermissionRequest` hook blocks the HTTP connection until the user decides (or the 9-minute timeout fires). Every other hook is fire-and-forget.

## License

MIT © cocaxcode
