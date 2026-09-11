# Multiagents Portability & Host Integration Guide

## 1. Fresh Installation vs. Session Migration

### Fresh Install
When onboarding onto a new machine:
1. **Runtime Requirement**: Bun (`>= 1.1`) is the required runtime. Bun must be installed and accessible in the user or system `PATH`.
2. **Dependency Resolution**: Execute `bun install` to resolve dependencies cleanly against the repository lockfile (`bun.lock` / `bun.lockb`).
3. **Execution Commands**: Run CLI commands and servers using Bun directly:
   - Dashboard: `bun run dashboard` or `start-dashboard.bat` (on Windows).
   - Setup: `bun run cli/setup-copilot.ts` or `setup-copilot.bat` (on Windows). Note: `setup-copilot.bat` configures VS Code MCP integration; it does not automatically launch the web dashboard.
4. **Environment & Host Discovery**: Discover locally supported providers from `.multiagents/chatLanguageModels.json` or explicitly specified paths using `listModels` and `ProviderSettingsManager.discoverFromCatalog()`.
5. **Credential Setup**: API keys are entered manually via the host password UI or local web settings; credentials are never committed, scraped, or pre-seeded into project files.

### Session Migration
Migrating existing sessions across machines requires careful separation of state:
- **Session Databases**: SQLite databases (e.g. `peers.db`, `state.db`) with active WAL files (`-wal`, `-shm`) and machine-specific file locks must not be copied between live machines. Moving them across hosts invalidates directory paths, PIDs, and workspace bindings. Fresh sessions continue normal local SQLite persistence; databases are neither deleted nor redesigned.
- **Absolute Paths**: Avoid embedding machine-dependent paths (such as `C:\Users\...` or `/home/...`) in saved configuration. All tool registrations, workspace configurations, and template references must use workspace-relative paths or `${workspaceFolder}` interpolation tokens.
- **Security Exclusions**: Files containing runtime state or sensitive variables (`.env`, `*.db*`, `.multiagents/inbox/`, `.multiagents/threads/`) must remain excluded in `.gitignore`.

---

## 2. Windows vs. Linux Cross-Platform Considerations

| Dimension | Windows | Linux / macOS |
| :--- | :--- | :--- |
| **Startup Commands** | Batch wrappers (`setup-copilot.bat`, `start-dashboard.bat`) or direct `bun run` | Direct `bun run` commands via POSIX shell |
| **Path Separators** | Backslashes (`\`) accepted natively, but JSON configs and URIs require forward slashes (`/`). | Forward slashes (`/`) standard. |
| **Process Spawning** | Shell spawning requires `.cmd` / `.bat` extension resolution or direct binary execution. | Direct execution via PATH lookup without extension. |

---

## 3. Credential Security & Ephemeral In-Memory Storage

To guarantee safe operation across disparate machines without leaking secrets:
- **No Disk or Host Key Persistence**: API keys entered via host prompts or local UI are stored exclusively in ephemeral memory via `ProviderCredentialStore`. Keys are NOT saved to host keystores, disk files, or browser localStorage, and are automatically discarded upon process termination.
- **Process Lifetime**: Ephemeral credentials exist only for the lifespan of the running broker/dashboard process and are lost on restart.
- **Non-Secret Environment References**: Catalogs and templates only store environment variable identifiers (e.g., `envKeyRef: "OPENAI_API_KEY"`). The real secret is fetched from `process.env` at execution time.
- **Reserved Environment Isolation**: `validateSafeEnvironmentKey` blocks binding against reserved OS and system environment variables (`PATH`, `HOME`, `USERPROFILE`, etc.), preventing arbitrary environment leakage.
- **Export Sanitization**: `ProviderSettingsManager.exportCatalog()` guarantees that no plaintext credentials, credentials in URLs (queries, fragments, or userinfo), internal runtime discovery flags (`isDiscovered`), or local absolute paths are exported.
- **Explicit Verification**: Verification states (`unconfigured`, `credential-present`, `connection-verified`) are tracked independently. Automated or unprompted paid network calls to remote models are strictly prohibited.
- **UI Integration Status**: In-memory credential entry and status management are implemented in the provider module contracts; web UI dashboard wiring to the backend `/api/studio` routes remains in active development.

---

## 4. Privacy, Memory Isolation & Offline Guarantees

### No-Memory Transfer Even Offline
Exporting and importing team templates or provider catalogs transfers strictly declarative configuration metadata (provider endpoint, model ID, protocol, capabilities, and nonsecret environment variable references). Under no circumstances are conversation histories, agent memory, scratchpads, context windows, plans, or session execution transcripts included in export packages. This guarantee holds uniformly across all deployment contexts, including air-gapped and offline machines.

### Local Session Persistence
During active usage on a single machine, session state and worker coordination data are persisted locally in standard machine-bound directories:
- SQLite databases (e.g., `.multiagents/state.db`, `peers.db`)
- Private agent thread logs (`.multiagents/threads/`, `.multiagents/codex-workers/`)
- Inter-agent message queues (`.multiagents/inbox/`)

This private runtime state is bounded to the machine running the session, remains outside the project version control via `.gitignore`, and is never bundled into portable export packages.

### Free-Text User Content & No Automated Secret Scanning
**Important Security Clarification**: The system does NOT promise or perform automated secret detection or redaction on free-text inputs. While structured catalog exports strictly sanitize URLs and strip sensitive properties, free-text fields (such as system prompts, agent role descriptions, custom instructions, or model display names) are preserved verbatim. If a user manually embeds secrets, tokens, or personal credentials into free-text fields, those strings will persist in the exported configuration. Users must audit exported templates prior to sharing across repositories or organizations.

### Studio Wiring Status
The core provider settings manager (`shared/provider-settings.ts`) and ephemeral credential manager (`shared/provider-credentials.ts`) are fully implemented, validated against prototype poisoning and unknown schema fields, and verified with unit tests. Full end-to-end Studio dashboard UI and server route integration (`/api/studio`) remains an active, ongoing integration track.

---

## 5. Codex Host vs. Worker Sandboxing Dimensions

### Codex Host Integration
- Codex CLI functions as an MCP host, launching and orchestrating MCP servers via stdio.
- Configuration is resolved through host config files (e.g., `~/.codex/config.toml` or CLI args).
- Requires `bun` binary discoverable in PATH.

### Sandbox Policy vs. Approval Policy Dimensions
- **Sandbox Profile**: Controls filesystem access (`restricted` vs `unrestricted`) and whether sub-processes can execute outside isolation boundaries.
- **Approval Policy**: Independent dimension (`never`, `untrusted`, `on-request`) determining interactive human confirmation prompts for tool actions. Setting `approval_policy: Never` disables interactive confirmation prompts, but does NOT by itself grant or revoke sandbox filesystem permissions.
- Workers communicate with the team exclusively via MCP endpoints or the local broker HTTP interface (`127.0.0.1:7899`).

---

## 6. Reusable Team Template Portability & Remapping

When importing a team template (e.g., `team-1`, `team-2`) created on another machine:
1. **Model & Provider Resolution**: The host runs `ProviderSettingsManager.checkTemplateCompatibility()` against the local catalog.
2. **Missing Provider / Model Detection**: If a template references a provider not configured locally, it is flagged as `provider_missing` or `model_missing`.
3. **Explicit User Remapping**: The user must explicitly select an available local provider/model before the team can execute.
4. **No Silent Fallback**: The orchestrator will never silently downgrade, swap models without confirmation, or invoke unconfigured endpoints.
