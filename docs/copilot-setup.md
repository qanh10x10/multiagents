# Worker activity and new assignments

Silence is not completion. The orchestrator reports a worker needing inspection
without interrupting its turn or asking it to declare the task complete. Missing
reviewers leave work awaiting review; they do not cause automatic approval.

Use `direct_agent` with `new_task: true` for a new assignment. This clears the
previous task approval and stores the assignment before delivery. A disconnected
slot retains the assignment until `resume_session`. Ordinary messages do not
reset review state. Resuming a disconnected worker also clears old approval.

The dashboard separates connection, workflow and recorded review state. Messages
shows the latest 200 loaded messages with agent/search filters, optional system
messages, full expandable reports and a live-update toggle. These are operational
reports, not private reasoning or independently verified test results. Missing
test evidence and blocker reports remain explicitly unknown.

Code changes require restarting the broker/dashboard and the VS Code MCP server
through their normal lifecycle. A browser refresh alone does not reload server
logic. MCP status/log results can be relayed during a chat turn; this does not
provide automatic background pushes into Copilot Chat. The optional local
[Multiagents Chat extension](../extensions/multiagents-chat/README.md) adds
`@multiagents /watch` for a bounded live chat response and confirmed single-worker
controls. Stopping a watch never stops workers. `control_session` now accepts
`interrupt_agent` for an exact Codex worker name/slot owned by that server; it
holds new work without claiming an in-flight tool has stopped or rolled back.

# Copilot MCP Setup on Windows

Connect Copilot Agent to this checkout's orchestrator without editing global settings or copying API keys. This guide describes the workspace setup, not the global CLI installer.

## Three Steps

1. **Run `setup-copilot.bat`** from the checkout. Have Bun and the checkout's dependencies installed; follow the prerequisite diagnostics if anything is missing. Setup writes `.vscode/mcp.json` with the `multiagents-orch` stdio server, absolute Bun/orchestrator paths, and a reference to your discovered user model catalog. Review the generated configuration.
2. **Trust and start in VS Code.** Open this checkout as a workspace. Review workspace trust and MCP server trust yourself. Use **MCP: List Servers**, select `multiagents-orch`, and start it. In extension-host mode, VS Code asks for provider keys using masked inputs. Enter only keys for providers you intend to use; leave unused providers blank. No manual environment variables are needed in this default mode.
3. **Run a discovery smoke check.** Open Copilot Chat in **Agent** mode, enable the server's tools, and ask: "Call `list_models` only. Show available provider/model IDs; do not create a team." A successful result lists catalog metadata. If no catalog exists, MCP tools can still be discovered, but model listing may report that the catalog is unavailable.

`list_models` reads a local file: it does not contact a provider, validate a key, launch workers, or incur worker-provider charges. Copilot Chat's own usage remains subject to its plan. Starting the MCP server can start its local broker; this is not a paid worker run. `create_team`, adding workers, or resuming workers is different: it can execute tasks and incur provider charges.

## What Setup Changes

- Writes the workspace `.vscode/mcp.json`, preserving unrelated servers and inputs. Conflicting entries or unsupported JSONC cause a safe refusal, not an overwrite. Review diagnostics and resolve conflicts deliberately; do not delete unrelated configuration to make setup pass.
- Finds the user model catalog and references its path. A missing catalog permits MCP discovery only; it does not supply models or credentials. The catalog is not copied into the repository.
- In default mode, maps supported, safe credential `envKey` names to new VS Code `promptString` inputs with `password: true` and no defaults. No literal keys are written or copied. Blank keys are acceptable for unused providers, but the selected provider needs a real key before a worker can launch.
- Does not read VS Code secret storage, inherit Copilot credentials as provider credentials, change the selected Copilot model, enable sampling, grant trust, or toggle global settings. Enter secrets only in VS Code's password input, never in chat, source, or a shared log.

## Checks and Automation

- `setup-copilot.bat --check`: nonmutating setup inspection; no configuration writes. This is not an MCP connection or provider authentication test.
- `setup-copilot.bat --no-pause`: perform setup without the final BAT pause, for automation.
- `setup-copilot.bat --check --no-pause`: inspect without writes or a final pause.
- `setup-copilot.bat --credentials env`: use environment references instead of interactive inputs. This does **not** set the actual environment variables or retrieve any secrets.

## Agent Host Limitation

The [official VS Code MCP reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) says that VS Code forwards configured servers to Agent Host **except those requiring interactive input**, including `${input:...}`. Agent Host does not read `.vscode/mcp.json` directly.

Use extension-host mode for the default masked-input setup. If you need Agent Host, rerun `setup-copilot.bat --credentials env`, then separately supply the required real provider variables in the environment of the process launching the host/server. Restart that process as needed; setting a variable in an unrelated terminal does not update an already-running VS Code or MCP server. Verify server discovery in the actual host. Environment mode removes interactive inputs from the server's credential references; it is not a guarantee of host compatibility or valid credentials.

No global setting is changed automatically. Standalone Agent Host use requires its supported native configuration; this helper only writes the VS Code workspace configuration.

## Optional `/multiagents` Prompt

Select `/multiagents` from the chat slash menu or **Chat: Run Prompt...**, if workspace prompt files are enabled. The [local prompt](../.github/prompts/multiagents.prompt.md) checks available tools, calls `list_models` and `get_guide` when available, and reports a concise readiness status. It does not create a team merely because it was invoked.

Before a paid run, explicitly confirm the absolute target project directory, task, and worker provider/model choices from discovery. The target is not necessarily this multiagents checkout. Selected catalog models run through Codex app-server and require Codex plus the selected provider's credential; Copilot authentication does not replace that credential. Creating a team can create the target directory and initialize Git, so authorize the correct path. Commits, pushes, deployments, and destructive operations require separate explicit authorization.

Request `get_team_status` or `get_session_log` when you want progress or history. Reports should describe observable tool actions, messages, and results, not invented private reasoning streams. `start-dashboard.bat` remains unchanged: use it to monitor, not to install MCP or start a team.

## Named Teams In Studio

The Studio tab stores reusable named agent definitions and team templates separately
from live sessions. The library is stored at `~/.multiagents/team-library.json`;
provider metadata is stored beside it in `provider-settings.json`. A template's
member IDs and reporting links describe a roster, not existing worker or session
IDs. Keep the monitoring tabs for observing actual runs.

Select agents by display name, assign the manager and reporting links, and save
the template. Configure a provider/model explicitly for each member. The current
selected-provider runtime supports Codex workers using the Responses protocol and
a model declaring tool calling. Those declarations do not prove model quality,
connection success, or capability. Other selections can remain drafts but cannot
silently fall back to a different model at launch.

Studio credentials are manually entered through its password input and kept in
the dashboard process's memory. Re-enter them after that process restarts. They
are not placed in exports or tool arguments. A separately launched MCP host must
receive its own credential through its password/environment configuration; it
does not obtain the dashboard's in-memory key automatically.

In a fresh Copilot or Codex chat, discover `list_team_templates`, inspect the
chosen template with `get_team_template`, and use `preflight_team_template` before
`run_team_template`. For example: "Use team-1 to implement login in project X" or
"Use team-2 to review the current diff." Resolve the actual project directory,
task and local model choices before running. The run request needs a unique
`requestId` and explicit `approvedTarget`, `approvedTask`, `approvedRoster` and
`approvedCost` confirmations. Merely listing templates or opening Studio does not
launch workers. Starting a template creates a new session through `create_team`;
resuming an existing session is a separate operation.

Studio export/import accepts configuration only. It excludes session IDs,
messages, knowledge, plans/history, snapshots, database/WAL/SHM contents, Codex
thread/private-home state, machine path bindings, and credential values. Import
previews must be reviewed before applying, and conflicting destination IDs are
rejected instead of overwriting existing configuration. Old memory is not moved,
even when both machines are offline; new sessions still persist normally in the
destination's local database. This does not encrypt or delete either database.
Review user-authored names/descriptions/tasks before sharing: schema validation
cannot determine whether arbitrary text contains sensitive information. The
legacy `session export` command produces a transcript and is not a portable
configuration bundle; do not transfer it as part of this workflow.

## When a Team Helps

Normal Copilot Agent already uses tools. MCP does not make its underlying model smarter or change your subscription into free worker access. Multiagents provides separate worker models and contexts, file locks, durable shared knowledge, status/recovery, and team observability. Use it for work that benefits from independent ownership or review. For small edits, ordinary Copilot usually has less setup, latency, and cost.

## Troubleshooting

### Opt-In Unattended Codex Workers

Only after the operator authorizes full execution, set `MULTIAGENTS_CODEX_ALLOW_ALL`
to the exact string `1` in the workspace MCP server's `env`. Setup preserves this
explicit setting but does not enable it by default. Remove it to disable it.
Restart the MCP server and relaunch/resume workers after either change; unpausing
an existing process does not reload code or launch settings.

This opts Codex workers launched by that server into `danger-full-access` on new,
resumed, and follow-up turns, with no interactive approval prompts. Commands can
read/write outside the workspace and access the network with the OS user's rights.
The built-in `multiagents-peer` MCP server receives
`default_tools_approval_mode="approve"` (Codex 0.153.4); other MCP servers are not
automatically approved. Organization-managed requirements still apply. This does
not change global Codex/Copilot settings or authorize publishing, commits, pushes,
or destructive tasks outside the agreed scope.

`approvalPolicy="never"` alone means **never ask**, not **approve everything**.
Without the explicit MCP policy, Codex can reject a tool with
`MCP tool call requires approval, but approval policy is never`.

### Startup Checks

Resuming a disconnected worker resets its previous approval to `working` (or
preserves `addressing_feedback`), clears its pause flag, and clears the old
session-completion countdown. Skipped/released workers are unchanged. A
disconnected worker with unfinished work no longer counts as successfully done
for automatic session archival. Restart the orchestrator after updating this
code; existing processes do not hot-reload it.

- **No MCP tools:** confirm the workspace configuration, server trust/start state, enabled tools, host mode, and any organization MCP policy. Inspect the server output; do not bypass trust automatically.
- **No catalog/models:** setup can still expose MCP tools. Configure a supported catalog before selecting provider models; see [Provider Model Catalog](../README.md#provider-model-catalog). Listing metadata alone does not prove runtime compatibility.
- **Missing credential:** enter the selected provider key in the VS Code prompt, or supply it separately to the launching environment in environment mode. Restart the server after changing its launch environment. Never paste a key into chat.
- **Bun/dependencies missing or broker fails to start:** follow setup diagnostics and inspect MCP server output. Do not treat a running dashboard as proof of an MCP connection. If the checkout or Bun installation moved, rerun setup and review its absolute paths.

Setup checks, host connection, and a paid worker run are separate validation gates. A passing setup check or this guide alone does not prove the remaining gates.
