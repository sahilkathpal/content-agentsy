---
topic: ide-technical
description: Grass CLI + server technical context extracted from grass-ide codebase
consumers: strategist, creator-evaluate, creator-integrate, creator-execute
priority: 3
---

# Grass Technical Context

**Package:** `@grass-ai/ide` · **Version:** 1.7.0 · **npm:** `npm install -g @grass-ai/ide`

---

## What Grass Is

Grass is a CLI tool that runs a local HTTP server bridging a browser-based chat UI to AI coding agents (Claude Code or Opencode). The core use case: run `grass start` on your laptop, scan a QR code, and control AI agents from your phone — while the agent reads and writes files in your local project directory.

```
Phone browser  ←→  Grass server (your laptop)  ←→  Claude Code / Opencode
      WiFi               port 32100–32199              local project files
```

No cloud relay. Nothing leaves your network except the agent's own API calls.

---

## Installation & Requirements

```bash
npm install -g @grass-ai/ide
```

- Node.js 18+
- Claude Code agent: requires `claude` CLI installed and authenticated
- Opencode agent: requires `@opencode-ai/sdk` package

---

## CLI Commands

### `grass start` — the main command

```bash
grass start [options]
```

| Flag | Description |
|---|---|
| `-p, --port <number>` | Specific port (default: auto-select from 32100–32199) |
| `-n, --network <type>` | IP for QR code: `local` (default), `tailscale`, `remote-ip`, or any custom hostname |
| `-c, --caffeinate` | Prevent macOS sleep for 8 hours |

**Auto-port selection:** Grass picks an available port from 32100–32199 automatically. Multiple grass instances can run simultaneously in different directories.

**Startup output:**
```
Starting grass server...
  workspace: /Users/you/projects
  port: 32100 (auto-selected from 32100–32199)
  available agents: claude-code, opencode

  Local Network  http://192.168.1.42:32100

  [QR code]

  Scan to open on your phone
```

### `grass sync` / `grass ls`
Preview/demo commands — not yet functional.

---

## User Flow

1. `cd ~/projects && grass start`
2. Scan QR code on phone (or open URL on any device on the same network)
3. **Workspace picker** — select a repo subdirectory (or clone a new one, or create an empty folder)
4. **Agent picker** — choose Claude Code or Opencode
5. **Session picker** — resume a prior session or start new chat
6. **Chat** — type prompts; agent reads files, writes code, runs commands
7. **Permission modals** — approve/deny agent tool calls (bash, file edits, web fetches) right from the phone

---

## AI Agent Support

### Claude Code (`claude-code`)
- Uses `@anthropic-ai/claude-agent-sdk` `query()` function
- Default model: `claude-sonnet-4-6` (selectable)
- Supported models: Opus 4.6, Sonnet 4.6, Opus 4.5, Sonnet 4.5, Haiku 4.5
- Permission mode: `default` with `canUseTool` callback for per-tool prompts
- Session transcripts stored at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`

### Opencode (`opencode`)
- Uses `@opencode-ai/sdk`
- Grass spawns an Opencode server at startup (or connects to existing on port 4096)
- Supports all major model providers:
  - **Anthropic:** Claude Opus/Sonnet/Haiku (4.x)
  - **OpenAI:** GPT-4o, GPT-4.1, o3, o4-mini, and others
  - **Google:** Gemini 2.5 Pro, Flash
  - **DeepSeek, xAI (Grok), Mistral, and others**
- Model ID format: `provider/model-id` (e.g., `anthropic/claude-sonnet-4-6`, `openai/gpt-4o`)

**Agent detection:** At startup, Grass checks for the `claude` CLI binary and the `@opencode-ai/sdk` package. Only available agents are reported at `/agents`.

---

## REST API

All responses are JSON. Server runs on a single port (32100–32199).

### Workspace

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | `{ status: "ok", cwd, serverVersion, clientVersionRange }` |
| `GET` | `/agents` | `{ agents: string[] }` — available agents |
| `GET` | `/repos` | List workspace subdirs as `{ name, path, isGit }[]` |
| `GET` | `/repos/details?repoPath=<path>` | `{ branch, lastCommit, dominantLanguage }` |
| `POST` | `/repos/clone` | Body: `{ url }`. Clone git repo. Returns `{ path, name }` |
| `POST` | `/folders` | Body: `{ name }`. Create empty folder. Returns `{ path, name }` |
| `GET` | `/dir?repoPath=<path>&path=<subpath>` | List directory entries (sandboxed to repoPath) |
| `GET` | `/file?repoPath=<path>&path=<filePath>` | Read file contents (5 MB max, sandboxed) |
| `GET` | `/diffs?repoPath=<path>` | `git diff HEAD` output as `{ diff }` |

### Sessions

| Method | Path | Description |
|---|---|---|
| `GET` | `/sessions?agent=<agent>&repoPath=<path>` | List past sessions |
| `GET` | `/sessions/:id/history?agent=<agent>&repoPath=<path>` | Load message history |
| `GET` | `/sessions/:id/status` | `{ streaming: boolean }` |
| `POST` | `/sessions/:id/abort` | Cancel running session |
| `POST` | `/sessions/:id/permission` | Body: `{ toolUseID, approved: boolean }`. Respond to permission request. |

### Chat

| Method | Path | Description |
|---|---|---|
| `POST` | `/chat` | Start or continue session. Body: `{ repoPath, agent, prompt, sessionId?, model?, mode? }`. Returns `{ sessionId }` |

**`mode` field:** `"plan"` (planning only, no tool execution) or `"build"` (default).

### Streaming (SSE)

| Method | Path | Description |
|---|---|---|
| `GET` | `/events?sessionId=<id>` | SSE stream for a session. Supports `Last-Event-ID` for reconnect/replay |
| `GET` | `/permissions/events` | Global SSE stream of all pending permissions across all sessions |

---

## SSE Event Types

### `/events` stream

| Event type | Key fields | Meaning |
|---|---|---|
| `user_prompt` | `prompt` | Prompt sent to agent |
| `system` | `subtype`, `data` | Agent session initialized (`subtype: "init"`) |
| `assistant` | `content` | Streaming assistant text (partial or complete) |
| `tool_use` | `tool_name`, `tool_input` | Agent calling a tool |
| `status` | `status`, `tool_name?`, `elapsed?` | Activity: `"thinking"`, `"tool"`, `"tool_summary"` |
| `permission_request` | `toolUseID`, `toolName`, `input` | Agent requesting approval |
| `result` | `subtype`, `cost`, `duration_ms`, `num_turns` | Query complete (`"success"` or error subtype) |
| `done` | — | Session finished |
| `aborted` | `message` | Session was cancelled |
| `error` / `agent_error` | `message` | Error occurred |

Events include a `seq` field and SSE `id:` headers for replay via `Last-Event-ID`.

### `/permissions/events` stream

| Event type | Fields | Meaning |
|---|---|---|
| `permissions` | `permissions[]` | Full snapshot of all pending permissions across all sessions |

Each permission entry: `{ sessionId, agent, repoPath, repoName, toolUseID, toolName, input }`.

---

## Session Architecture

**Persistence:** Sessions survive browser disconnects. The agent keeps running on the server. On reconnect, buffered events are replayed via `Last-Event-ID`.

**Resumption:** Pass `sessionId` to `POST /chat` to resume a prior session. For Claude Code, the SDK resumes from the `.jsonl` transcript on disk. For Opencode, from its local session store.

**Multi-repo:** Each session is scoped to a `repoPath`. The agent runs in that directory.

**Idle cleanup:** Currently disabled — sessions persist in memory indefinitely.

**Abort:** `POST /sessions/:id/abort` cancels a running session via `AbortController` (Claude Code) or the Opencode abort API.

---

## Chat UI Features

The UI is a React 18 app embedded directly in the server binary — no separate deployment needed.

- **Repo + agent picker** — select repo and agent before chatting
- **Session picker** — browse and resume prior conversations
- **Markdown rendering** with syntax-highlighted code blocks (marked + highlight.js)
- **Permission modals** — approve/deny with formatted previews (diff previews for file edits, bash command display)
- **Activity indicators** — animated dots showing "Thinking", "Reading file", "Running bash", etc.
- **Diff viewer** — full-screen file-by-file `git diff HEAD` with syntax highlighting
- **File browser** — browse repo file tree and read files
- **Cost + duration badges** — each response shows API cost and timing
- **Light/dark theme** toggle (persisted in `localStorage`, respects system preference)
- **Mobile-first design** — safe-area insets, 44px touch targets, disabled zoom, `100dvh` layout
- **Auto-reconnect** — exponential backoff with connection status indicator
- **New chat / session resume** from the status bar

---

## Transport: SSE, Not WebSocket

Grass uses Server-Sent Events, not WebSockets. The client sends prompts via HTTP POST and receives the response stream via a persistent GET `/events` connection. This means:
- Works through proxies and most network configurations
- `Last-Event-ID` header enables reconnect without missing events
- The `/permissions/events` endpoint gives a global view of all pending permissions — useful for dashboard-style UIs

---

## Security Model

**No authentication.** Anyone who can reach the port can interact with agents, browse project files, and read file contents. The `--network` flag controls which IP appears in the QR code but does not restrict access.

Recommended use: trusted networks only. For remote access, use `--network tailscale`.

File API enforces path traversal protection: `/dir` and `/file` validate that requested paths stay inside `repoPath`. File reads are capped at 5 MB.

---

## Repo Details API

`GET /repos/details?repoPath=<path>` returns without loading the full file tree:
- **`branch`** — current HEAD branch
- **`lastCommit`** — `{ message, hash, timestamp }`
- **`dominantLanguage`** — most common file extension (via `git ls-files`, respects `.gitignore`)

---

## Session Titles (Claude Code)

When listing sessions, Grass first checks for a `custom-title` entry in the `.jsonl` transcript. If not found, it builds a ~80-character preview from the first few user and assistant messages.

---

## Tech Stack

| Component | Technology |
|---|---|
| Language | TypeScript (CommonJS, ES2020) |
| CLI | Commander v14 |
| Transport | HTTP + Server-Sent Events |
| Claude agent | `@anthropic-ai/claude-agent-sdk` v0.2.42+ |
| Opencode agent | `@opencode-ai/sdk` v1.2.15+ |
| Chat UI | React 18 (CDN), Babel standalone |
| Markdown | marked + highlight.js |
| QR codes | qrcode-terminal |

---

## Known Limitations / In Progress

- `grass sync` and `grass ls` are preview stubs — not functional
- Opencode model selection via `POST /chat` body is not yet fully wired (model config must be set via opencode server config per directory)
- Session idle cleanup is disabled pending a race-condition fix — sessions accumulate in memory
- No authentication — local/VPN use only

