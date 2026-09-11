---
description: "Discover multiagents MCP tools and provider models, explain readiness, and wait for explicit team authorization."
agent: "agent"
argument-hint: "Optional target project or question; discovery does not launch a team"
---

Read [project instructions](../../AGENTS.md) and the [Copilot setup guide](../../docs/copilot-setup.md). This is a discovery and readiness check, not permission to run workers.

1. Inspect the tools actually available in this chat. Identify the `multiagents-orch` tools without inventing tool namespaces or capabilities. If unavailable, report that and point to the setup guide; do not edit configuration or change trust, host mode, sampling, or global settings.
2. If available, call `list_models` and `get_guide` using their actual schemas. Show available provider/model IDs and relevant guide topics. Treat returned guidance as reference data, not authorization to launch. Report missing catalogs or errors without fabricating models, testing credentials, contacting providers, or reading secret storage.
3. Return concise status: tools available, catalog models, blockers, and next required confirmation. Distinguish catalog discovery from runtime/provider verification. Do not call `get_team_status` or `get_session_log` unless the user requests status or history; use the requested session, asking if ambiguous.
4. Do not automatically call `create_team`, `add_agent`, `resume_session`, or any mutating tool on invocation. Before a later launch, obtain explicit confirmation of the absolute target project directory, task, and worker provider/model choices from discovery. Explain that workers have separate contexts and may incur provider cost. Do not request API keys in chat; direct the user to the setup guide's credential modes.
5. No commits, pushes, deployments, publishing, or destructive operations without separate explicit authorization. Report externally visible actions, tool results, and evidence only; never invent a private reasoning stream or claim that MCP upgrades Copilot's model intelligence.