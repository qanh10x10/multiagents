import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("fresh MCP discovers saved named templates and preflights without creating a session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-mcp-"));
  const requests: string[] = [];
  const broker = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    requests.push(path);
    return path === "/health" ? Response.json({ status: "ok" }) : new Response("No mutation permitted", { status: 500 });
  } });
  const client = new Client({ name: "studio-template-test", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL("../orchestrator/orchestrator-server.ts", import.meta.url))], cwd: directory,
    env: { PATH: "", HOME: directory, USERPROFILE: directory, APPDATA: directory, LOCALAPPDATA: directory,
      TEMP: directory, TMP: directory, SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
      MULTIAGENTS_PORT: String(broker.port), MULTIAGENTS_DB: join(directory, "never-created.db"),
      SYNTHETIC_PROVIDER_KEY: "SYNTHETIC_NOT_REAL", MULTIAGENTS_NO_OPEN: "1" }, stderr: "ignore",
  });
  try {
    const settings = join(directory, ".multiagents");
    await mkdir(settings);
    await Bun.write(join(settings, "team-library.json"), JSON.stringify({ version: 1,
      agents: [{ id: "reviewer", displayName: "Named Reviewer", role: "Code Reviewer", description: "Review only",
        runtime: "codex", modelRef: { providerId: "synthetic", modelId: "vendor/model" } }],
      teams: [{ id: "team-2", name: "Review Team", managerId: "lead", members: [{ id: "lead", agentId: "reviewer", task: "Review the diff" }] }],
    }));
    await Bun.write(join(settings, "provider-settings.json"), JSON.stringify({ version: "1.0", exportedAt: new Date().toISOString(), providers: [{
      id: "synthetic", name: "Synthetic provider", protocol: "responses", baseUrl: "https://example.invalid/v1", envKeyRef: "SYNTHETIC_PROVIDER_KEY",
      models: [{ id: "vendor/model", name: "Declared model", capabilities: { toolCalling: true } }],
    }] }));
    await client.connect(transport, { timeout: 10000 });
    const names = (await client.listTools({}, { timeout: 5000 })).tools.map(tool => tool.name);
    for (const name of ["list_team_templates", "get_team_template", "preflight_team_template", "run_team_template", "create_team", "get_chat_observation"]) expect(names).toContain(name);
    const listed = await client.callTool({ name: "list_team_templates", arguments: {} });
    expect(listed.isError).not.toBe(true);
    expect(JSON.stringify(listed)).toContain("Named Reviewer");
    const args = { templateId: "team-2", projectDir: directory, task: "Review synthetic diff", requestId: "preview-only" };
    const preview = await client.callTool({ name: "preflight_team_template", arguments: args });
    expect(preview.isError).not.toBe(true);
    expect(JSON.stringify(preview)).toContain("Named Reviewer");
    expect(JSON.stringify(preview)).not.toContain("SYNTHETIC_NOT_REAL");
    const rejected = await client.callTool({ name: "run_team_template", arguments: { ...args,
      approvedCost: false, approvedTarget: true, approvedTask: true, approvedRoster: true } });
    expect(rejected.isError).toBe(true);
    expect(requests).toEqual(["/health"]);
    expect(await Bun.file(join(directory, "never-created.db")).exists()).toBe(false);
    expect(await Bun.file(join(settings, "runtime-catalog.json")).exists()).toBe(false);
  } finally {
    await client.close();
    await transport.close();
    broker.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);
