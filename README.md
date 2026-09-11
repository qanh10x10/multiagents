# multiagents

[![npm version](https://img.shields.io/npm/v/multiagents.svg)](https://www.npmjs.com/package/multiagents)
[![npm downloads](https://img.shields.io/npm/dm/multiagents.svg)](https://www.npmjs.com/package/multiagents)

Multi-agent orchestration platform for **Claude Code**, **Codex CLI**, and **Gemini CLI**. Enables AI agents to discover each other, communicate in real-time, coordinate file edits, and work as a team on shared codebases.

Built on [MCP (Model Context Protocol)](https://modelcontextprotocol.io/).

## What It Does

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Claude Code  │     │  Codex CLI  │     │ Gemini CLI  │
│ (Engineer)   │     │ (Reviewer)  │     │ (Designer)  │
└──────┬───────┘     └──────┬──────┘     └──────┬──────┘
       │   MCP (stdio)      │  CodexDriver       │
       └────────────┬───────┴────────────────────┘
                    │
            ┌───────▼────────┐
            │  Broker Daemon  │  SQLite + HTTP on localhost:7899
            │  (singleton)    │
            └───────┬────────┘
                    │
            ┌───────▼────────┐
            │  Orchestrator   │  MCP server for Claude Desktop
            │  (team manager) │  Spawns agents, forwards messages,
            └────────────────┘  monitors progress, auto-restarts
```

- **Peer discovery**: agents find each other via `list_peers`
- **Real-time messaging**: instant for Claude (channel push), <3s for Codex (mid-turn steer), 1-3s for Gemini (piggyback)
- **Role assignment**: `assign_role`, `rename_peer` at runtime
- **File coordination**: exclusive locks + ownership zones prevent conflicts
- **Task lifecycle**: `idle → working → done_pending_review → addressing_feedback → approved → released`
- **Review loops**: `signal_done → submit_feedback → fix → re-review → approve`
- **Shared knowledge**: persistent key-value store for architectural decisions, discovered patterns, and project context — prevents context drift across agents
- **Persistent sessions**: survive agent restarts, full message history
- **TUI dashboard**: real-time monitoring with 5 tabs (agents, messages, stats, plan, files)
- **Auto-restart**: crashed agents respawn with handoff context
- **Graceful shutdown**: broker and orchestrator kill all managed processes on exit

## Quick Start

### VS Code Copilot on Windows (This Checkout)

1. Run `setup-copilot.bat` from this checkout. It checks prerequisites and writes workspace `.vscode/mcp.json` for `multiagents-orch`, using absolute Bun and orchestrator paths. It discovers your local model catalog without copying keys.
2. In VS Code, open this checkout, review workspace/server trust, then use **MCP: List Servers** to start `multiagents-orch`. In extension-host mode, enter a provider key only in VS Code's masked input; leave unused providers blank. No manual environment setup is needed in this default mode.
3. Open Copilot **Agent**, enable the server's tools, and ask: "Call `list_models` only and show available provider/model IDs. Do not create a team." This reads the local catalog without provider requests or worker charges; a missing catalog does not block MCP tool discovery.

Interactive `${input:...}` servers are **not forwarded to Agent Host**. Use extension-host mode, or rerun `setup-copilot.bat --credentials env` and supply real credentials separately in the launching host's environment. Setup does not toggle global settings, trust, or sampling. See the [Copilot setup guide](docs/copilot-setup.md) for checks, host limitations, and the optional `/multiagents` prompt.

MCP adds tools, not a model-intelligence upgrade: normal Copilot Agent already has tools. Multiagents adds separate worker models/contexts, durable coordination (locks, knowledge, status, recovery), and observability. Teams add setup, latency, and provider cost; ordinary Copilot is simpler for small tasks. `start-dashboard.bat` remains monitoring-only, not MCP setup or a team launcher.

### CLI Setup

```bash
# Install globally
bun install -g multiagents

# Setup (detects CLIs, configures MCP servers, starts broker)
multiagents setup

# Restart your Claude Code / Codex / Gemini sessions to load MCP tools

# Monitor
multiagents dashboard
```

### From Claude Desktop (Orchestrator)

Ask Claude to create a team:

> "Create a team of 3 agents: a Claude engineer, a Codex reviewer, and a Gemini designer.
> Build a calculator web app in TypeScript."

The orchestrator handles everything: spawning agents, assigning roles, creating slots, launching the dashboard, and forwarding messages between agents.

## Agent Support

| Agent | Delivery Mechanism | Latency | Config |
|-------|-------------------|---------|--------|
| Claude Code | Channel push notifications | Instant | `~/.claude/settings.json` |
| Codex CLI | CodexDriver (`codex app-server`) | <3s mid-turn, 3-9s between turns | `~/.codex/config.toml` |
| Gemini CLI | Piggyback on MCP tool responses | 1-3s | `~/.gemini/settings.json` |

### Codex Integration (CodexDriver)

Codex CLI uses the **app-server protocol** — a JSON-RPC stdio interface with threads, turns, and rich notifications. The orchestrator uses a **CodexDriver** that:

1. Spawns a persistent `codex app-server` process with JSON-RPC handshake
2. Creates a thread (`thread/start`) and drives turns (`turn/start`) for task execution
3. Injects messages mid-turn via `turn/steer` — no waiting for the current turn to finish
4. Interrupts stuck turns via `turn/interrupt` when agents go idle for >60s
5. Auto-approves all server-initiated requests (command execution, file changes, MCP elicitations)
6. Tracks token usage from `turn/completed` notifications

The orchestrator **drives Codex turns**: the forwarding loop polls the broker every 3s. If Codex has an active turn, messages are steered in instantly. If idle, a new turn is started via `driver.reply()`.

### Provider Model Catalog

For VS Code on Windows, the [workspace setup](docs/copilot-setup.md) discovers your user `chatLanguageModels.json` and references it without copying it. For other launch paths, set `MULTIAGENTS_MODELS_FILE` to an external catalog path or provide a credential-free catalog at `.multiagents/chatLanguageModels.json`. Do not copy credentials into the project or commit secrets. Catalog lookup uses an explicit path first, then the environment variable, then the project default; relative paths resolve against the project directory (CLI: current directory).

List a file locally without starting the broker, contacting providers, or requiring credentials:

```bash
bun cli.ts models --file .multiagents/chatLanguageModels.json
bun cli.ts models --file .multiagents/chatLanguageModels.json --json
bun cli.ts models --help
```

On this Windows setup, optional direct inspection uses `bun cli.ts models --file "C:\Users\PC\AppData\Roaming\Code\User\chatLanguageModels.json" --json`. This reads only the specified catalog, not VS Code settings or secret storage. The CLI requires `--file`; JSON contains allowlisted metadata and environment variable names, never credential values. Missing files, invalid catalogs, and invalid arguments fail with sanitized errors and a nonzero exit code.

- **Credentials**: VS Code `${input:chat.lm.secret...}` references cannot be resolved outside VS Code. Provider names derive environment keys: `Hollow` uses `HOLLOW_API_KEY`, `ADNX` uses `ADNX_API_KEY`. Alternatively, set the catalog's `apiKey` to a reference such as `${env:PROVIDER_API_KEY}`. Literal API keys are rejected. Default Copilot setup creates new masked VS Code inputs and maps them to safe credential environment keys; it does not read existing secret storage. For other launch paths or `--credentials env`, supply credentials in the orchestrator's environment before launching or resuming workers.
- **Compatibility**: Only `customendpoint` providers with `apiType: "responses"` are supported. Launch requires the selected model to declare `toolCalling: true` and its credential environment variable to be present. Listing does not require credentials or tool calling. Vision, token limits, and zero-data-retention fields are unverified catalog claims, not tested capabilities or privacy guarantees.
- **MCP discovery**: Call orchestrator `list_models` with optional `catalog_path` and `project_dir`. Use the returned `provider` and `model` exactly in `create_team.agents[].model_selection` or `add_agent.model_selection`: `{ "provider": "Hollow", "model": "<catalog model ID>", "catalog_path": ".multiagents/chatLanguageModels.json" }`. `catalog_path` is optional; `agent_type` must be `"codex"`.
- **Runtime**: Selected models always run through Codex app-server, regardless of model ID prefixes such as `ag/`; a prefix does not select Claude or Gemini. Configuration is per worker, without changing global Codex configuration. Provider/model selection and the absolute catalog path persist for recovery and MCP `resume_session`; the catalog and environment credential must remain available. Terminal `session resume` intentionally does not support selected models; use MCP `resume_session` instead.
- **Selected-worker isolation**: Selected workers use an owner-only, durable `CODEX_HOME` under `~/.multiagents/codex-workers/<project-session-slot hash>` (`USERPROFILE` on Windows). They do not inherit your global Codex settings, login/auth files, keyring credentials, or project `.codex/config.toml` settings. Project configuration layers are marked untrusted in the private config; task files and instructions remain available. Plugins, plugin recommendations, remote plugin synchronization, host skill discovery, and analytics are disabled. Only basic OS environment variables, worker identity/broker variables, and the selected credential variable are forwarded. Other provider credentials, inherited Codex state overrides, and Node/Bun startup injection variables are not forwarded. Use a dedicated provider credential variable, not an OS/Codex/multiagents control variable. Default, unselected agents are unchanged.
- **Private state lifecycle**: Generated config contains environment key names, never credential values. Thread history stays in the same private home across crashes and resumes; process exit does not delete it. Delete a worker home manually only after its session is no longer needed; deletion loses native thread history. Launch fails if private state would be inside the task repository or owner-only permissions cannot be established. Unix uses directory/file modes `0700`/`0600`; Windows restricts the worker directory ACL to the current user. Machine-managed Codex policies still apply.
- **Offline native regression**: Set `MULTIAGENTS_TEST_CODEX_EXECUTABLE` to an installed native `codex`/`codex.exe`, then run `bun test tests/selected-codex-native.test.ts`. Without that explicit opt-in the test skips. It uses synthetic user/project settings outside the repository and only `initialize`/`config/read`, never threads, turns, or provider requests. Native effective routing and MCP isolation were verified with Codex CLI 0.153.4.

## Task State Machine

Every agent slot has a `task_state` that governs the review/approval workflow:

```
                    ┌──────────── (reviewer/QA roles) ────────────┐
                    │                                              ▼
idle ──► working ──► done_pending_review ──► addressing_feedback  approved ──► released
                         │                         │                ▲
                         │                         └────────────────┘
                         └──────────► approved ─────────────────────┘
```

- **idle → working**: Auto-transitions when agent calls `set_summary` or produces first output
- **working → done_pending_review**: Agent calls `signal_done`
- **working → approved**: Reviewer/QA agents auto-approve on `signal_done` (they don't need external review)
- **done_pending_review → addressing_feedback**: Reviewer calls `submit_feedback(actionable=true)`
- **addressing_feedback → done_pending_review**: Agent fixes issues and calls `signal_done` again
- **done_pending_review → approved**: Reviewer calls `approve`
- **approved → released**: Orchestrator calls `release_agent`

Agents **cannot disconnect** until explicitly released. This ensures the review loop completes.

## MCP Tools (Available to All Agents)

| Tool | Description |
|------|-------------|
| `list_peers` | Discover agents (filter by scope, type) |
| `send_message` | Send text message to a peer |
| `check_messages` | Poll for new messages |
| `set_summary` | Update your status (visible to peers and dashboard) |
| `check_team_status` | See all agents: roles, states, summaries |
| `get_plan` / `update_plan` | Track team progress against the plan |
| `signal_done` | Signal task completion (triggers review) |
| `submit_feedback` | Send review feedback (actionable or informational) |
| `approve` | Approve a teammate's work |
| `assign_role` / `rename_peer` | Assign roles and names |
| `acquire_file` / `release_file` | File lock management |
| `view_file_locks` | See active locks and ownership zones |
| `get_history` | Query session message history |
| `store_knowledge` | Store shared knowledge (decisions, patterns, conventions) |
| `query_knowledge` | Query knowledge entries by key or category |
| `remove_knowledge` | Remove outdated knowledge entries |

## Orchestrator Tools (Claude Desktop / VS Code Copilot)

| Tool | Description |
|------|-------------|
| `list_models` | List safe provider/model metadata from a local catalog (optional catalog_path, project_dir) |
| `create_team` | Spawn a team with roles, file ownership, and a plan |
| `get_team_status` | Live status of all agents with completion tracking |
| `broadcast_to_team` | Message all agents at once |
| `direct_agent` | Message a specific agent by name/role |
| `add_agent` / `remove_agent` | Add or remove agents mid-session |
| `control_session` | Pause/resume all or individual agents |
| `adjust_guardrail` | View or change session limits |
| `release_agent` / `release_all` | Release agents to disconnect |
| `get_session_log` | Full message history |
| `list_sessions` / `resume_session` | List and resume previous sessions |
| `end_session` / `delete_session` | Archive or permanently delete |
| `cleanup_dead_slots` | Remove stale disconnected slots |
| `get_guide` | Built-in documentation and tutorials |

## Sessions

Sessions persist across agent restarts:

```bash
multiagents session create "Auth Feature"    # Create session
multiagents session list                     # List all sessions
multiagents session resume auth-feature      # Resume (respawns agents)
multiagents session pause                    # Pause all agents
multiagents session delete auth-feature      # Permanently delete
```

## File Coordination

**Ownership Zones** (static, zero overhead):
```
create_team assigns: Engineer owns src/**, Reviewer owns tests/**
```

**File Locks** (dynamic, for shared files):
```
Engineer: acquire_file("package.json", "adding dependency")
→ Lock acquired, auto-expires in 5 minutes
```

## Shared Knowledge Store

Agents share a persistent key-value store to prevent context drift — the #1 failure mode in multi-agent systems.

```
Engineer:  store_knowledge("auth-pattern", "JWT with refresh rotation", category="decision")
Designer:  query_knowledge()  →  sees the decision before designing auth UI
Reviewer:  query_knowledge(category="decision")  →  reviews against team decisions
```

**Categories**: `decision`, `convention`, `discovery`, `blocker`, `context`

Knowledge persists across agent restarts and is scoped to the session. Agents are instructed to query knowledge on startup and store decisions as they work.

## Guardrails

Session monitoring stats and enforced limits:

| Guardrail | Default | Scope | Action |
|-----------|---------|-------|--------|
| Restart Limit | 5 | Per agent | Stop (prevents flapping) |
| Session Duration | Monitor | Session | Observe |
| Total Messages | Monitor | Session | Observe |
| Active Agents | Monitor | Session | Observe |
| Longest Idle | Monitor | Per agent | Observe |

Adjustable from the TUI dashboard (+/- keys) or via `adjust_guardrail` tool.

## Web Dashboard

```bash
multiagents web [session-id]
```

Real-time web dashboard on `localhost:7900` with live WebSocket updates. Auto-opens in browser when a team is created via the orchestrator. 6-tab interface:

- **Agents**: agent cards with connection status, task state, role, summaries, token usage
- **Messages**: live message feed with type badges and sender names
- **Plan**: task progress with completion bar and assignee labels
- **Knowledge**: shared knowledge entries with categories and provenance
- **Files**: file locks and ownership zones
- **Stats**: session metrics (connected agents, working, tokens) and guardrail bars

Dark theme, responsive layout, keyboard shortcuts (`1-6` to switch tabs).

## TUI Dashboard

```bash
multiagents dashboard [session-id]
```

5-tab terminal interface (same data, ANSI rendering):
- **[1] Agents**: connection status, task state, summaries
- **[2] Messages**: auto-scrolling message log with filtering
- **[3] Stats**: guardrail monitoring and adjustment
- **[4] Plan**: progress tracking with completion percentage
- **[5] Files**: file locks and ownership zones

Keys: `1-5` switch tabs, `j/k` scroll, `p` pause all, `r` resume all, `+/-` adjust guardrails, `q` quit.

## CLI Commands

```
multiagents setup                     Interactive setup wizard
multiagents web [session-id]         Web dashboard (localhost:7900)
multiagents dashboard [session-id]    TUI dashboard
multiagents session <sub>             Session management (create/list/resume/pause/delete)
multiagents send <target> <msg>       Send message to agent
multiagents peers                     List connected agents
multiagents status                    Broker health + peers
multiagents broker start|stop|status  Manage broker daemon
multiagents install-mcp               Configure MCP servers
multiagents help [command]            Detailed help
```

## Architecture

```
multiagents/
├── broker.ts               SQLite broker daemon (sessions, slots, locks, messages, knowledge, guardrails)
├── server.ts               MCP server entry point (dispatches to adapter by --agent-type)
├── cli.ts                  CLI entry point
├── shared/
│   ├── types.ts            Type definitions (Peer, Slot, Session, Message, TaskState...)
│   ├── broker-client.ts    HTTP client for broker API
│   ├── constants.ts        Ports, intervals, thresholds
│   ├── summarize.ts        Auto-summary generation
│   └── utils.ts            Shared utilities
├── adapters/
│   ├── base-adapter.ts     Abstract MCP adapter (tools, registration, polling)
│   ├── claude-adapter.ts   Claude Code adapter (channel push delivery)
│   ├── codex-adapter.ts    Codex adapter (piggyback + file inbox delivery)
│   ├── gemini-adapter.ts   Gemini adapter (piggyback + file inbox delivery)
│   └── role-practices.ts   Role-specific best practices injection
├── orchestrator/
│   ├── orchestrator-server.ts  Orchestrator MCP server (team management)
│   ├── codex-driver.ts     CodexDriver: persistent codex app-server via JSON-RPC (steer/interrupt)
│   ├── launcher.ts         Agent spawning (CLI args, MCP configs, CodexDriver)
│   ├── monitor.ts          Process monitoring (stdout parsing, token tracking)
│   ├── recovery.ts         Crash recovery (flap detection, respawn with context)
│   ├── progress.ts         Team status aggregation
│   ├── session-control.ts  Pause/resume/broadcast
│   ├── guardrails.ts       Guardrail enforcement
│   └── guide.ts            Built-in documentation
└── cli/
    ├── commands.ts         CLI command router
    ├── models.ts           Broker-free provider model listing
    ├── dashboard.ts        TUI dashboard (ANSI, no dependencies)
    ├── session.ts          Session management commands
    ├── setup.ts            Interactive setup wizard
    └── install-mcp.ts      MCP server configuration
```

## Process Lifecycle

### Graceful Shutdown
- **Broker** (`SIGINT`/`SIGTERM`): kills all registered peer processes, closes SQLite cleanly
- **Orchestrator** (`SIGINT`/`SIGTERM`): kills all managed agent processes and CodexDriver instances
- **Adapters** (`SIGINT`/`SIGTERM`): unregister from broker, release file locks

### Orphan Prevention
- Broker's `cleanStalePeers` runs every 30s: removes dead peer records, kills orphan processes without sessions
- CodexDriver uses `.multiagents/.driver-mode` sentinel file to prevent internal MCP adapters from creating ghost slots
- Session delete/end handlers kill both regular processes and CodexDriver instances
- Flap detection stops auto-restart after 3 crashes in 5 minutes

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MULTIAGENTS_PORT` | `7899` | Broker HTTP port |
| `MULTIAGENTS_MODELS_FILE` | `.multiagents/chatLanguageModels.json` | External provider catalog path; explicit catalog paths take precedence |
| `MULTIAGENTS_DB` | `~/.multiagents/peers.db` | SQLite database path |
| `MULTIAGENTS_SESSION` | - | Session ID (set by orchestrator) |
| `MULTIAGENTS_SLOT` | - | Slot ID (set by orchestrator) |
| `MULTIAGENTS_ROLE` | - | Agent role (set by orchestrator) |
| `MULTIAGENTS_NAME` | - | Agent display name (set by orchestrator) |
| `MULTIAGENTS_DRIVER_MODE` | - | Skip adapter registration (set by CodexDriver) |

## Requirements

- [Bun](https://bun.sh/) runtime (v1.1+)
- At least one of: Claude Code, Codex CLI, or Gemini CLI

## License

MIT
