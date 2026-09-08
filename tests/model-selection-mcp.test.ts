import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("MCP discovery exposes selection; whole-team preflight prevents side effects and CLI resume rejects downgrade", async () => {
  const directory = mkdtempSync(join(tmpdir(), "multiagents-model-mcp-"));
  const requests: string[] = [];
  const selection = { provider: "Fixture", model: "one", catalog_path: join(directory, "catalog.json") };
  const broker = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    fetch(request) {
      const endpoint = new URL(request.url).pathname;
      requests.push(endpoint);
      if (endpoint === "/healthz") return Response.json({ ok: true });
      if (endpoint === "/slots/list") return Response.json([{ id: 1, agent_type: "codex", status: "disconnected", model_selection: selection }]);
      if (endpoint === "/sessions/get") return Response.json({ id: "fixture", project_dir: directory });
      return Response.json([]);
    },
  });
  const env = Object.fromEntries(Object.entries({ ...process.env, MULTIAGENTS_PORT: String(broker.port), RUNTIME_MCP_KEY: "fixture-secret" }).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../orchestrator/orchestrator-server.ts", import.meta.url))],
    env, stderr: "ignore",
  });
  const client = new Client({ name: "model-selection-test", version: "1" });
  try {
    await Bun.write(selection.catalog_path, JSON.stringify([{
      vendor: "customendpoint", name: "Fixture", apiType: "responses", apiKey: "${env:RUNTIME_MCP_KEY}",
      models: [{ id: "one", name: "One", toolCalling: true, url: "https://example.invalid/v1/responses" }],
    }]));
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map(tool => tool.name)).toContain("list_models");
    expect(JSON.stringify(tools.tools.find(tool => tool.name === "create_team")!.inputSchema)).toContain("model_selection");
    expect(JSON.stringify(tools.tools.find(tool => tool.name === "add_agent")!.inputSchema)).toContain("model_selection");
    const listed = await client.callTool({ name: "list_models", arguments: { catalog_path: "catalog.json", project_dir: directory } });
    expect(listed.isError).not.toBe(true);
    expect(JSON.stringify(listed)).toContain("RUNTIME_MCP_KEY");
    expect(JSON.stringify(listed)).not.toContain("fixture-secret");
    const project = join(directory, "must-not-create");
    const agent = { agent_type: "codex", name: "one", role: "Engineer", role_description: "Fixture", initial_task: "No launch", model_selection: selection };
    const rejected = await client.callTool({ name: "create_team", arguments: {
      project_dir: project, session_name: "Rejected", agents: [agent, { ...agent, name: "two", model_selection: { ...selection, model: "missing" } }],
    } });
    expect(rejected.isError).toBe(true);
    expect(requests).not.toContain("/sessions/create");
    expect(requests).not.toContain("/slots/create");
    expect(await Bun.file(join(project, ".git", "HEAD")).exists()).toBe(false);
    const add = await client.callTool({ name: "add_agent", arguments: { ...agent, session_id: "fixture", model_selection: { ...selection, apiKey: "must-not-leak" } } });
    expect(add.isError).toBe(true);
    expect(JSON.stringify(add)).not.toContain("must-not-leak");
    expect(requests).not.toContain("/slots/create");
    const cli = Bun.spawn([process.execPath, fileURLToPath(new URL("../cli.ts", import.meta.url)), "session", "resume", "fixture"], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const output = await new Response(cli.stderr).text();
    expect(await cli.exited).not.toBe(0);
    expect(output).toContain("resume_session");
    expect(requests).not.toContain("/sessions/update");
  } finally {
    await client.close();
    await transport.close();
    broker.stop(true);
    rmSync(directory, { recursive: true, force: true });
  }
}, 15000);