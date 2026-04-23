---
topic: expo-technical
description: Grass mobile app technical context extracted from grass-expo codebase
consumers: strategist, creator-evaluate, creator-integrate, creator-execute, derivatives
priority: 3
---

# Grass Mobile App — Technical Context

## Product Overview

Grass is an iOS-first mobile client for AI-powered coding agents. Users connect to a Grass server running on their Mac, then chat with AI coding assistants (Claude Code or OpenCode), review file diffs, and approve tool executions — all from their phone.

**Platform:** iOS primary, Android and web supported  
**Tech stack:** Expo 54 / React Native 0.81, TypeScript 5.9, Expo Router (file-based navigation)

---

## Core Features

### Server Connection
- **QR Code scan** — tap "Scan QR Code" on home screen; the camera scans a QR code emitted by the Grass server and saves the HTTP URL automatically
- **Multi-server** — save and manage multiple server connections; each shows a colored health dot (green = healthy, red = unreachable, grey = unknown)
- **Swipe-to-delete** — swipe left on a server item to reveal a delete button
- **Health polling** — every 10 seconds, the app hits `GET /health` on each saved server

### Agent Selection
Two agents are supported:
- **Claude Code** — Anthropic's AI coding agent
- **OpenCode** — open-source AI coding agent

On iPhone: agent picker appears as a bottom sheet modal after selecting a folder.  
On iPad: agent picker appears inside the Project view sidebar.

### Folder/Repo Management
- Browse server workspace folders and git repos
- **Clone repo** — paste a git URL; server clones it into the workspace
- **New folder** — enter a folder name; server creates an empty directory
- Pull-to-refresh to reload folder list

### Chat
- Send messages to the AI agent; responses stream in real time
- Full markdown rendering with syntax highlighting (TSX, TypeScript, JavaScript, JSX, Bash, JSON, Python)
- **Abort** — red stop button (■) during streaming to cancel the current run
- Session ID shown in header (first 8 chars)
- History loaded automatically when opening an existing session
- "Diffs" button in header navigates to the diff viewer

### Session History
- Lists past sessions for a repo+agent combo, sorted newest-first
- Search bar to filter by session label/preview or ID
- Tap a session to resume it; tap "New" to start fresh

### Diff Viewer
- Displays `git diff HEAD` output parsed into per-file views
- Color coding: additions in teal (`#2dd4a8`), deletions in red (`#ff5f57`)
- File status badges: `M` (modified), `N` (new), `D` (deleted), `R` (renamed)
- Line numbers shown for both old and new sides

### Permission Requests
- When the agent wants to run a tool (Bash command, file write, file edit), a modal appears
- Shows tool name badge + syntax-highlighted preview of what will be executed
- Two buttons: **Allow** (green) / **Deny**
- Haptic feedback on both actions

### File Explorer (iPad only)
- Left panel: file tree with directory navigation
- Right panel: syntax-highlighted file content viewer
- Supports image files (shows type + size placeholder)
- Supported languages: TSX, TypeScript, JavaScript, JSX, Bash, JSON, Python

### Theme
- Manual light/dark toggle (☾/☀ button in chat header)
- Persisted via AsyncStorage across sessions
- Accent color: `#5b4af7` (light) / `#7c6eff` (dark)

---

## Navigation Structure

```
/home          → server list + QR scanner
/folders       → workspace folder/repo browser (after selecting a server)
/agent-picker  → agent selection (standalone screen, used on iPad)
/project       → iPad project view with sidebar (explorer, diffs, agent)
/sessions      → session list for a repo+agent
/chat          → chat interface
/diffs         → diff viewer (modal)
```

---

## Server API

The Grass server runs on ports `32100–32199`. CORS is fully open.

### Workspace Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Server health; returns `{ cwd }` |
| `GET` | `/agents` | Available agents: `["claude-code", "opencode"]` |
| `GET` | `/repos` | List workspace repos: `[{ name, path, isGit }]` |
| `POST` | `/repos/clone` | Clone a git repo; body: `{ url }` |
| `POST` | `/folders` | Create a new folder; body: `{ name }` |
| `GET` | `/dir?repoPath=&path=` | List directory entries |
| `GET` | `/file?repoPath=&path=` | Read file content |
| `GET` | `/diffs?repoPath=` | `git diff HEAD` output |

### Session Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/sessions?repoPath=&agent=` | List past sessions |
| `GET` | `/sessions/:id/history?agent=&repoPath=` | Load session message history |
| `GET` | `/sessions/:id/status` | Whether session is streaming |
| `POST` | `/chat` | Start or continue a session |
| `GET` | `/events?sessionId=` | SSE stream for a session |
| `POST` | `/sessions/:id/abort` | Abort a running session |
| `POST` | `/sessions/:id/permission` | Respond to a permission request |

### Chat Flow

```
POST /chat { repoPath, agent, prompt, sessionId? }
  → { sessionId }

GET /events?sessionId=<id>   (SSE stream)
  → streams events until done/error/aborted
```

Follow-up messages use the same `sessionId` in subsequent `POST /chat` calls.

### SSE Event Types

| Event | Meaning |
|-------|---------|
| `user_prompt` | Prompt echoed back |
| `system` | SDK init (claude-code only) |
| `status` | Agent state: `thinking`, `tool`, `tool_summary` |
| `tool_use` | Tool invoked with `tool_name` + `tool_input` |
| `assistant` | Text response chunk; for opencode, each event replaces previous |
| `result` | Final result with `cost` (USD), `duration_ms`, `num_turns` (claude-code only) |
| `permission_request` | Tool needs approval; contains `toolUseID`, `toolName`, `input` |
| `done` | Session completed; stream closes |
| `error` | Session failed; stream closes |
| `aborted` | User aborted; stream closes |

SSE frames support `Last-Event-ID` for resuming streams after reconnection.

### Permission Request Body
```json
POST /sessions/:id/permission
{ "toolUseID": "tool_abc123", "approved": true }
```

---

## Client Architecture

### State Management
All server state lives in a singleton `connection-store.ts` (no Redux/Zustand). Each server URL maps to a `ConnectionEntry` containing:
- `streaming`, `messages`, `activity`, `permissionQueue`, `sessionId`
- `sessionsList`, `repos`, `diffs`, `dirListing`, `fileContent`
- `currentRepoPath`, `currentAgent`, `currentSessionId`

Components subscribe via `subscribeToConnection(url, fn)` and force re-render on changes.

### SSE Handling
- Custom SSE parser built on `fetch` with `reactNativeFetchMode: 'stream'`
- Streams close on `done`, `error`, or `aborted` events (no auto-reconnect)
- SSE streams are closed when app goes to background (`AppState` listener)
- `Last-Event-ID` header sent on reconnect to resume from last received event

### WebSocket → REST Migration
The app previously used WebSocket (`ws://`); it now uses HTTP REST + SSE. A backwards-compat `use-websocket.ts` shim re-exports from `use-server.ts`. Saved `ws://` URLs are auto-migrated to `http://` on first load.

### iPad vs iPhone Differences
- **iPad:** `app/project.tsx` — sidebar with 4 icons (explorer, agent picker, diffs, terminal[disabled]), split-pane layout
- **iPhone:** agent picker appears as a bottom sheet modal in `app/folders.tsx`
- Detection: `Platform.OS === 'ios' && Platform.isPad`

---

## Installation

### Development
```bash
npm install
npm run ios   # or android, web
```

### Device install (no TestFlight)
```bash
npx expo prebuild --platform ios
open ios/*.xcworkspace
# Configure signing in Xcode, select device, hit Run
```

Free Apple Developer accounts: certs expire every 7 days, max 3 apps on device.

### EAS Build profiles
- `development` — internal distribution, dev client
- `preview` — internal distribution
- `production` — auto-increment build number, App Store

Bundle ID: `com.grass-ide.ios`  
EAS project: `5f83639c-9362-4793-86cd-31ab41f09788`

---

## Known Issues / Roadmap

- **Connection health indicators** — temporarily removed (grey dot always shown); planned to restore with proper `connected`/`reconnecting` states
- **Terminal panel** — sidebar icon exists on iPad but disabled ("Coming soon" toast)
- **SSE rapid reconnect** — potential duplicate messages on quick app state changes (background → foreground)
- **Agent session affinity** — sessions from different agents not filtered separately in session list

