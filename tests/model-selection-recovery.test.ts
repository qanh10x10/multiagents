import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FLAP_THRESHOLD } from "../shared/constants.ts";

async function until(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 6000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error("Recovery fixture timed out");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

for (const mode of ["removal", "failure", "resume", "idle"] as const) test(`actual MCP selected worker ${mode}`, async () => {
  const failure = mode === "failure";
  const root = mkdtempSync(join(tmpdir(), "multiagents-recovery-"));
  const directory = join(root, "project");
  mkdirSync(directory);
  const selection = { provider: "Fixture", model: "one", catalog_path: join(directory, "catalog.json") };
  const launchesPath = join(directory, "launches.jsonl");
  const slots: any[] = [];
  const broker = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(request) {
      const endpoint = new URL(request.url).pathname;
      const body = request.method === "POST" ? await request.json() as any : {};
      if (endpoint === "/healthz") return Response.json({ ok: true });
      if (endpoint === "/sessions/get") return Response.json({ id: "fixture", status: "active", project_dir: directory });
      if (endpoint === "/slots/create") {
        const slot = { ...body, id: slots.length + 1, status: "disconnected", task_state: "idle", context_snapshot: null };
        slots.push(slot);
        return Response.json(slot);
      }
      if (endpoint === "/slots/get") return Response.json(slots.find(slot => slot.id === body.id) ?? null);
      if (endpoint === "/slots/update") return Response.json(Object.assign(slots.find(slot => slot.id === body.id), body));
      if (endpoint === "/slots/list") return Response.json(slots);
      if (endpoint === "/plan/get") return Response.json(null);
      if (endpoint.includes("peek-undelivered")) return Response.json({ count: mode === "resume" || mode === "idle" ? 0 : 1, msg_types: mode === "resume" || mode === "idle" ? [] : ["feedback"], oldest_at: Date.now() - 60000 });
      return Response.json([]);
    },
  });
  const fake = join(directory, "fake.ts");
  const wrapper = join(directory, "orchestrator.ts");
  await Bun.write(fake, `
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
const send = message => console.log(JSON.stringify({ jsonrpc: "2.0", ...message }));
let turn = 0;
createInterface({ input: process.stdin }).on("line", line => {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return;
  appendFileSync(${JSON.stringify(launchesPath)}, JSON.stringify({ event: method, pid: process.pid }) + "\\n");
  if (method === "initialize") return send({ id, result: { userAgent: "offline-fixture" } });
  if (method === "thread/start" || method === "thread/resume") return send({ id, result: { thread: { id: "fixture-thread" } } });
  if (method === "turn/start") {
    const turnId = "turn-" + ++turn;
    send({ id, result: { turn: { id: turnId, status: "inProgress" } } });
    if (${JSON.stringify(mode === "idle")} && turn > 1) return;
    setTimeout(() => send({ method: "turn/completed", params: { turn: { id: turnId, status: ${JSON.stringify(failure ? "failed" : "completed")}, error: { message: "provider secret offline-fixture" } } } }), 10);
    return;
  }
  send({ id, result: {} });
});
`);
  await Bun.write(wrapper, `
import { appendFileSync } from "node:fs";
const spawn = Bun.spawn.bind(Bun);
const spawnSync = Bun.spawnSync.bind(Bun);
const interval = globalThis.setInterval;
const clock = Date.now;
globalThis.setInterval = (callback, delay, ...args) => interval(async () => {
  if (${JSON.stringify(mode === "idle")} && delay === 3000) Date.now = () => clock() + 120000;
  try { await callback(...args); } finally { Date.now = clock; }
  if (delay === 10000) appendFileSync(${JSON.stringify(launchesPath)}, JSON.stringify({ event: "sweep", pid: 0 }) + "\\n");
}, delay === 10000 || (${JSON.stringify(mode === "idle")} && delay === 3000) ? 50 : delay);
Bun.which = () => process.execPath;
Bun.spawnSync = (args, options) => /whoami|icacls/.test(args[0]) ? spawnSync(args, options) : ({ exitCode: 0, stdout: Buffer.from("fixture"), stderr: Buffer.alloc(0) });
Bun.spawn = (args, options) => {
  if (args[1] !== "app-server") throw new Error("Unexpected subprocess blocked by offline test");
  const proc = spawn([process.execPath, ${JSON.stringify(fake)}], options);
  appendFileSync(${JSON.stringify(launchesPath)}, JSON.stringify({ event: "spawn", pid: proc.pid }) + "\\n");
  proc.exited.then(() => appendFileSync(${JSON.stringify(launchesPath)}, JSON.stringify({ event: "exit", pid: proc.pid }) + "\\n"));
  return proc;
};
await import(${JSON.stringify(new URL("../orchestrator/orchestrator-server.ts", import.meta.url).href)});
`);
  await Bun.write(selection.catalog_path, JSON.stringify([{
    vendor: "customendpoint", name: "Fixture", apiType: "responses", apiKey: "${env:RECOVERY_FIXTURE_KEY}",
    models: [{ id: "one", name: "One", toolCalling: true, url: "https://example.invalid/v1/responses" }],
  }]));
  const env = Object.fromEntries(Object.entries({ ...process.env, HOME: join(root, "home"), USERPROFILE: join(root, "home"), MULTIAGENTS_PORT: String(broker.port), RECOVERY_FIXTURE_KEY: "offline-fixture" })
    .filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const transport = new StdioClientTransport({ command: process.execPath, args: [wrapper], env, stderr: "ignore" });
  const client = new Client({ name: "recovery-test", version: "1" });
  function events(): Array<{ event: string; pid: number }> {
    try { return readFileSync(launchesPath, "utf8").trim().split("\n").map(line => JSON.parse(line)); }
    catch { return []; }
  }
  try {
    await client.connect(transport);
    const added = await client.callTool({ name: "add_agent", arguments: {
      session_id: "fixture", agent_type: "codex", name: "Worker", role: "Engineer", role_description: "Offline", initial_task: "Fixture", model_selection: selection,
    } });
    expect(added.isError).not.toBe(true);
    if (mode === "idle") {
      await until(() => !!slots[0]?.context_snapshot && !!JSON.parse(slots[0].context_snapshot).attention);
      expect(JSON.parse(slots[0].context_snapshot).attention.reason).toContain("not confirmed complete");
      expect(events().filter(event => event.event === "turn/interrupt")).toHaveLength(0);
      expect(events().filter(event => event.event === "turn/start")).toHaveLength(2);
      expect(slots[0].task_state).not.toBe("approved");
      expect(JSON.parse(slots[0].context_snapshot).codex_thread_id).toBe("fixture-thread");
      const interrupted = await client.callTool({ name: "control_session", arguments: {
        session_id: "fixture", action: "interrupt_agent", target: "Worker",
      } });
      expect(interrupted.isError).not.toBe(true);
      expect(events().filter(event => event.event === "turn/interrupt")).toHaveLength(1);
      expect(slots[0].paused).toBe(true);
      const observation = await client.callTool({ name: "get_chat_observation", arguments: { session_id: "fixture" } });
      expect(observation.isError).not.toBe(true);
      expect(JSON.stringify(observation)).not.toContain("fixture-thread");
    } else if (failure) {
      await until(() => events().filter(event => event.event === "exit").length === FLAP_THRESHOLD);
      await until(async () => JSON.stringify(await client.callTool({ name: "get_team_status", arguments: { session_id: "fixture" } })).includes("flapping"));
      expect(events().filter(event => event.event === "spawn")).toHaveLength(FLAP_THRESHOLD);
      expect(slots[0].status).toBe("disconnected");
      expect(JSON.parse(slots[0].context_snapshot).last_status).toBe("error");
    } else {
      await until(() => !!slots[0]?.context_snapshot && JSON.parse(slots[0].context_snapshot).codex_thread_id === "fixture-thread");
      const removed = await client.callTool({ name: "remove_agent", arguments: { session_id: "fixture", target: "Worker" } });
      expect(removed.isError).not.toBe(true);
      await until(() => events().some(event => event.event === "exit"));
      const sweeps = events().filter(event => event.event === "sweep").length;
      await until(() => events().filter(event => event.event === "sweep").length >= sweeps + 3);
      // Exercise status after exit callbacks and their async recovery work have settled.
      for (let i = 0; i < 10; i++) await client.callTool({ name: "get_team_status", arguments: { session_id: "fixture" } });
      expect(events().filter(event => event.event === "spawn")).toHaveLength(1);
      expect(slots[0].status).toBe("disconnected");
      expect(slots[0].peer_id).toBeNull();
      if (mode === "resume") {
        slots[0].task_state = "approved";
        slots[0].paused = true;
        slots[0].paused_at = Date.now();
        const skipped = { ...slots[0], id: 2, display_name: "Skipped", task_state: "approved" };
        slots.push(skipped);
        const assigned = await client.callTool({ name: "direct_agent", arguments: {
          session_id: "fixture", target: "Worker", message: "Implement the new scoped assignment", new_task: true,
        } });
        expect(assigned.isError).not.toBe(true);
        expect(slots[0].task_state).toBe("working");
        expect(JSON.parse(slots[0].context_snapshot).current_task).toBe("Implement the new scoped assignment");
        expect(skipped.task_state).toBe("approved");
        const resumed = await client.callTool({ name: "resume_session", arguments: {
          session_id: "fixture", agents_to_skip: ["Skipped"],
        } });
        expect(resumed.isError).not.toBe(true);
        expect(JSON.stringify(resumed)).toContain("Respawned 1 agent");
        expect(slots[0].task_state).toBe("working");
        expect(slots[0].paused).toBe(false);
        expect(slots[0].paused_at).toBeNull();
        expect(skipped.task_state).toBe("approved");
        expect(skipped.paused).toBe(true);
        expect(JSON.parse(slots[0].context_snapshot).codex_thread_id).toBe("fixture-thread");
        expect(events().filter(event => event.event === "spawn")).toHaveLength(2);
        slots.pop();
      }
    }
    expect(slots).toHaveLength(1);
  } finally {
    await client.close();
    await transport.close();
    // Only terminate fixture PIDs recorded by this test's isolated launcher.
    for (const event of events().filter(event => event.event === "spawn")) {
      if (!events().some(exit => exit.event === "exit" && exit.pid === event.pid)) {
        try { process.kill(event.pid); } catch { /* already exited */ }
      }
    }
    broker.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);