import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const checkout = fileURLToPath(new URL("..", import.meta.url));
function isolatedEnvironment(directory: string, port: number): Record<string, string> {
  return {
    PATH: "", HOME: directory, USERPROFILE: directory,
    APPDATA: join(directory, "AppData", "Roaming"), LOCALAPPDATA: join(directory, "AppData", "Local"),
    TEMP: directory, TMP: directory, SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
    MULTIAGENTS_PORT: String(port), MULTIAGENTS_DB: join(directory, "state", "peers.db").replaceAll("\\", "/"),
  };
}
function connection(directory: string, port: number, serverPath = join(checkout, "orchestrator", "orchestrator-server.ts")) {
  const client = new Client({ name: "copilot-setup-offline-test", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], cwd: directory, env: isolatedEnvironment(directory, port), stderr: "pipe" });
  return { client, transport };
}

test("SDK initialize and tools/list expose operator instructions without provider or user broker calls", async () => {
  const directory = mkdtempSync(join(tmpdir(), "multiagents copilot discovery "));
  const requests: string[] = [];
  const broker = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    requests.push(new URL(request.url).pathname);
    return new URL(request.url).pathname === "/health" ? Response.json({ status: "ok" }) : new Response("Unexpected endpoint", { status: 500 });
  } });
  const { client, transport } = connection(directory, broker.port!);
  try {
    await client.connect(transport, { timeout: 10000 });
    const names = (await client.listTools({}, { timeout: 5000 })).tools.map(tool => tool.name);
    for (const tool of ["list_models", "get_guide", "create_team", "get_team_status", "get_session_log"]) expect(names).toContain(tool);
    const instructions = client.getInstructions()!;
    for (const text of ["list_models", "get_guide", "confirm", "provider", "model", "fees", "one worker", "on request", "do not endlessly poll", "hidden thought stream"]) expect(instructions).toContain(text);
    expect(requests).toEqual(["/health"]);
    expect(existsSync(join(directory, "state"))).toBe(false);
  } finally {
    await client.close();
    await transport.close();
    broker.stop(true);
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 20000);

function coldFixture(directory: string): string {
  const project = join(directory, "checkout with spaces");
  mkdirSync(project, { recursive: true });
  for (const path of ["orchestrator", "shared", "adapters", "broker.ts"]) cpSync(join(checkout, path), join(project, path), { recursive: true });
  symlinkSync(join(checkout, "node_modules"), join(project, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  return join(project, "orchestrator", "orchestrator-server.ts");
}

test("cold MCP starts real broker with absolute Bun, URL-decoded space paths and isolated DB/home; owned processes cleaned", async () => {
  const directory = mkdtempSync(join(tmpdir(), "multiagents copilot cold "));
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("reserved") });
  const port = reservation.port!;
  const serverPath = coldFixture(directory);
  reservation.stop(true);
  const { client, transport } = connection(directory, port, serverPath);
  let logs = "";
  let brokerPid: number | undefined;
  transport.stderr!.on("data", chunk => {
    logs += chunk.toString();
    const match = /Broker daemon spawned \(PID (\d+)\)/.exec(logs);
    if (match) brokerPid = Number(match[1]);
  });
  try {
    expect(Bun.which("bun", { PATH: "" })).toBeNull();
    await client.connect(transport, { timeout: 12000 });
    expect((await client.listTools({}, { timeout: 5000 })).tools.length).toBeGreaterThan(0);
    expect(brokerPid).toBeNumber();
    expect(logs).toContain("Broker started");
    expect(existsSync(join(directory, "state", "peers.db"))).toBe(true);
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
    expect(await response.json()).toEqual({ status: "ok", peers: 0 });
  } finally {
    await client.close();
    await transport.close();
    if (brokerPid) {
      try { process.kill(brokerPid, "SIGTERM"); } catch { /* Child may already have exited. */ }
    }
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}, 25000);

test("broker early exit fails MCP initialization promptly rather than waiting indefinitely", async () => {
  const directory = mkdtempSync(join(tmpdir(), "multiagents copilot failed cold "));
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("reserved") });
  const port = reservation.port!;
  const serverPath = coldFixture(directory);
  writeFileSync(join(directory, "checkout with spaces", "broker.ts"), "process.exit(23);\n");
  reservation.stop(true);
  const { client, transport } = connection(directory, port, serverPath);
  let logs = "";
  transport.stderr!.on("data", chunk => { logs += chunk.toString(); });
  const started = Date.now();
  try {
    await expect(client.connect(transport, { timeout: 10000 })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(9000);
    expect(logs).toContain("Broker daemon exited before becoming ready");
    expect(existsSync(join(directory, "state"))).toBe(false);
  } finally {
    await client.close();
    await transport.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 15000);