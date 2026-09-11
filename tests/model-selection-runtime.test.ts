import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexDriver } from "../orchestrator/codex-driver.ts";
import { launchAgent, relaunchIntoSlot, validateAgentModel } from "../orchestrator/launcher.ts";
import { respawnAgent } from "../orchestrator/recovery.ts";
import type { Slot } from "../shared/types.ts";

let directory: string;
let fixtureRoot: string;
let previousHome: Record<string, string | undefined>;
let catalog: string;
let spawnSpy: ReturnType<typeof spyOn>;
let whichSpy: ReturnType<typeof spyOn>;
let launches: Array<{ args: string[]; env: Record<string, string | undefined> }>;
let processes: Array<import("bun").Subprocess>;
const originalSpawn = Bun.spawn.bind(Bun);
const originalWhich = Bun.which.bind(Bun);
let oldKey: string | undefined;
let oldAllowAll: string | undefined;
let failThreadStart = false;
let turnStatus = "completed";

async function until(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 5000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error("Fake app-server condition timed out");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

beforeEach(async () => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "multiagents-selected-runtime-"));
  directory = join(fixtureRoot, "project");
  mkdirSync(directory);
  previousHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = process.env.USERPROFILE = join(fixtureRoot, "home");
  catalog = join(directory, "catalog.json");
  oldKey = process.env.RUNTIME_TEST_API_KEY;
  oldAllowAll = process.env.MULTIAGENTS_CODEX_ALLOW_ALL;
  delete process.env.MULTIAGENTS_CODEX_ALLOW_ALL;
  process.env.RUNTIME_TEST_API_KEY = "runtime-test-secret";
  await Bun.write(catalog, JSON.stringify([{
    vendor: "customendpoint", name: "Fixture", apiType: "responses", apiKey: "${env:RUNTIME_TEST_API_KEY}",
    models: ["one", "two"].map(id => ({ id, name: id, url: "https://example.invalid/v1/responses", toolCalling: true })),
  }]));
  const fake = join(directory, "fake-app-server.ts");
  await Bun.write(fake, `
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
let turn = 0;
const send = (message) => console.log(JSON.stringify({ jsonrpc: "2.0", ...message }));
createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  appendFileSync(process.env.FAKE_LOG, JSON.stringify(message) + "\\n");
  if (message.id === undefined) return;
  const { id, method, params } = message;
  if (method === "initialize") return send({ id, result: { userAgent: "fixture" } });
  if (method === "thread/start" && process.env.FAIL_THREAD_START) return send({ id, error: { message: "provider unavailable" } });
  if (method === "thread/resume" && params.threadId === "missing") return send({ id, error: { message: "missing thread" } });
  if (method === "thread/start" || method === "thread/resume") return send({ id, result: { thread: { id: params.threadId ?? "fixture-thread" } } });
  if (method === "turn/start") {
    const turnId = "turn-" + ++turn;
    send({ id, result: { turn: { id: turnId, status: "inProgress" } } });
    setTimeout(() => {
      send({ method: "item/completed", params: { turnId, item: { type: "agentMessage", text: "Ready." } } });
      send({ method: "turn/completed", params: { turn: { id: turnId, status: process.env.TURN_STATUS, error: { message: "provider leaked runtime-test-secret" } } } });
    }, 30);
    return;
  }
  send({ id, result: {} });
});
`);
  launches = [];
  processes = [];
  failThreadStart = false;
  turnStatus = "completed";
  whichSpy = spyOn(Bun, "which").mockImplementation(((name: string, options: any) => name === "codex" ? process.execPath : originalWhich(name, options)) as any);
  spawnSpy = spyOn(Bun, "spawn").mockImplementation(((args: string[], options: any) => {
    if (args[1] !== "app-server") throw new Error("Unexpected process launch in runtime test");
    launches.push({ args, env: options.env });
    const proc = originalSpawn([process.execPath, fake], {
      ...options, env: { ...options.env, TURN_STATUS: turnStatus, FAIL_THREAD_START: failThreadStart ? "1" : "", FAKE_LOG: join(directory, `rpc-${launches.length}.jsonl`) },
    });
    processes.push(proc);
    return proc;
  }) as any);
});

afterEach(async () => {
  spawnSpy?.mockRestore();
  whichSpy?.mockRestore();
  for (const proc of processes ?? []) { proc.kill(); await proc.exited; }
  if (oldKey === undefined) delete process.env.RUNTIME_TEST_API_KEY;
  else process.env.RUNTIME_TEST_API_KEY = oldKey;
  if (oldAllowAll === undefined) delete process.env.MULTIAGENTS_CODEX_ALLOW_ALL;
  else process.env.MULTIAGENTS_CODEX_ALLOW_ALL = oldAllowAll;
  for (const [key, value] of Object.entries(previousHome)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function messages(index: number): any[] {
  try { return readFileSync(join(directory, `rpc-${index}.jsonl`), "utf8").trim().split("\n").map(line => JSON.parse(line)); }
  catch { return []; }
}

function brokerFixture() {
  const slots: Slot[] = [];
  const client = {
    createSlot: async (value: any) => {
      const slot = { ...value, id: slots.length + 1, status: "disconnected", context_snapshot: null } as Slot;
      slots.push(slot);
      return slot;
    },
    updateSlot: async (value: any) => Object.assign(slots.find(slot => slot.id === value.id)!, value),
    getSlot: async (id: number) => slots.find(slot => slot.id === id)!,
    listSlots: async () => slots,
    getMessageLog: async () => [],
  };
  return { slots, client: client as any };
}

describe("selected Codex worker real subprocess lifecycle", () => {
  test.each([undefined, "0", "true", "1"])("allow-all requires exact opt-in %s and survives resume/reply", async value => {
    if (value !== undefined) process.env.MULTIAGENTS_CODEX_ALLOW_ALL = value;
    const enabled = value === "1";
    const { slots, client } = brokerFixture();
    const result = await launchAgent("approval-fixture", directory, {
      agent_type: "codex", name: "Worker", role: "Engineer", role_description: "Test", initial_task: "Fixture only",
      model_selection: { provider: "Fixture", model: "one", catalog_path: catalog },
    }, client);
    const driver = result.codexDriver!;
    await until(() => messages(1).filter(message => message.method === "turn/start").length === 2 && !driver.activeTurnId);
    await driver.reply(driver.threadId!, "Follow-up");
    const config = readFileSync(join(launches[0]!.env.CODEX_HOME!, "config.toml"), "utf8");
    expect(config.includes('default_tools_approval_mode = "approve"')).toBe(enabled);
    expect(launches[0]!.env.MULTIAGENTS_CODEX_ALLOW_ALL).toBeUndefined();
    const start = messages(1).find(message => message.method === "thread/start");
    expect(start.params.sandbox).toBe(enabled ? "danger-full-access" : undefined);
    for (const turn of messages(1).filter(message => message.method === "turn/start")) {
      expect(turn.params.approvalPolicy).toBe("never");
      if (enabled) expect(turn.params.sandboxPolicy).toEqual({ type: "dangerFullAccess" });
      else expect(turn.params.sandboxPolicy?.type).not.toBe("dangerFullAccess");
    }
    await driver.kill();
    const recovered = await relaunchIntoSlot("approval-fixture", directory, slots[0]!, "Resume", client);
    await until(() => messages(2).some(message => message.method === "turn/start") && !recovered.codexDriver!.activeTurnId);
    const resume = messages(2).find(message => message.method === "thread/resume");
    expect(resume.params.sandbox).toBe(enabled ? "danger-full-access" : "workspace-write");
    expect(messages(2).find(message => message.method === "turn/start").params.sandboxPolicy?.type).toBe(enabled ? "dangerFullAccess" : undefined);
    await recovered.codexDriver!.kill();
  }, 15000);

  test("default driver accepts explicit host allow-all without changing other MCP servers", async () => {
    const driver = await CodexDriver.spawn(directory, { ...process.env, MULTIAGENTS_CODEX_ALLOW_ALL: "1" });
    try {
      await driver.startSession({ prompt: "Fixture", cwd: directory, sandbox: "workspace-write" });
      expect(launches[0]!.args.slice(2)).toEqual(["-c", 'mcp_servers.multiagents-peer.default_tools_approval_mode="approve"']);
      expect(messages(1).find(message => message.method === "turn/start").params.sandboxPolicy).toEqual({ type: "dangerFullAccess" });
    } finally { await driver.kill(); }
  });

  test("failed turn after thread creation disconnects and kills without leaking provider error", async () => {
    turnStatus = "failed";
    const { slots, client } = brokerFixture();
    const result = await launchAgent("failed-turn", directory, {
      agent_type: "codex", name: "Failure", role: "Engineer", role_description: "Test", initial_task: "No task",
      model_selection: { provider: "Fixture", model: "one", catalog_path: catalog },
    }, client);
    await until(() => !result.codexDriver!.alive);
    expect(result.codexDriver!.threadId).toBe("fixture-thread");
    expect(slots[0]!.status).toBe("disconnected");
    expect(slots[0]!.peer_id).toBeNull();
    expect(JSON.parse(slots[0]!.context_snapshot!).last_status).toBe("error");
    expect(slots[0]!.context_snapshot).not.toContain("runtime-test-secret");
    expect(messages(1).filter(message => message.method === "turn/start")).toHaveLength(1);
    expect(await Bun.file(join(launches[0]!.env.CODEX_HOME!, "config.toml")).exists()).toBe(true);
  }, 10000);

  test.each(["failed", "interrupted", "completed"])("driver handles %s completion directly", async status => {
    turnStatus = status;
    const driver = await CodexDriver.spawn(directory, process.env, 1000);
    try {
      const turn = driver.startSession({ prompt: "Offline fixture" });
      if (status === "failed") {
        const error = await turn.then(() => null, error => error);
        expect(error?.message).toBe("Codex turn failed; check provider configuration and availability.");
      }
      else expect((await turn).content).toBe("Ready.");
      expect(driver.activeTurnId).toBeNull();
    } finally { await driver.kill(); }
  });

  test("thread/start failure disconnects the worker and exits the initialized subprocess", async () => {
    failThreadStart = true;
    const { slots, client } = brokerFixture();
    const result = await launchAgent("failure", directory, {
      agent_type: "codex", name: "Failure", role: "Engineer", role_description: "Test", initial_task: "No turn",
      model_selection: { provider: "Fixture", model: "one", catalog_path: catalog },
    }, client);
    let exits = 0;
    result.codexDriver!.onExit(() => { exits++; });
    await until(() => !result.codexDriver!.alive && exits === 1);
    expect(slots[0]!.status).toBe("disconnected");
    expect(slots[0]!.peer_id).toBeNull();
    expect(JSON.parse(slots[0]!.context_snapshot!).last_status).toBe("error");
    expect(messages(1).some(message => message.method === "initialized")).toBe(true);
    expect(messages(1).some(message => message.method === "turn/start")).toBe(false);
    expect(launches).toHaveLength(1);
  }, 10000);

  test("selected launch preserves existing project and isolated global configuration bytes", async () => {
    const home = join(fixtureRoot, "isolated-home");
    const paths = [join(home, ".codex", "config.toml"), join(home, ".claude.json"),
      join(home, ".gemini", "settings.json"), join(directory, ".mcp.json"),
      join(directory, ".multiagents", "session.json"), join(directory, ".multiagents", ".driver-mode")];
    const { dirname } = await import("node:path");
    const originals = new Map<string, string>();
    for (const path of paths) {
      mkdirSync(dirname(path), { recursive: true });
      const content = path.endsWith(".toml") ? 'model = "stale"\n' : '{"session_id":"stale-A","untouched":true}\n';
      await Bun.write(path, content);
      originals.set(path, content);
    }
    const overrides = { HOME: home, USERPROFILE: home, CODEX_HOME: join(home, ".codex") };
    const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
    try {
      Object.assign(process.env, overrides);
      const { client } = brokerFixture();
      const result = await launchAgent("selected-B", directory, {
        agent_type: "codex", name: "Worker", role: "Engineer", role_description: "Test", initial_task: "Task",
        model_selection: { provider: "Fixture", model: "one", catalog_path: catalog },
      }, client);
      await until(() => messages(1).filter(message => message.method === "turn/start").length === 2 && !result.codexDriver!.activeTurnId);
      await result.codexDriver!.kill();
      for (const [path, content] of originals) expect(readFileSync(path, "utf8")).toBe(content);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  }, 10000);

  test("launch, task, reply, steer, crash recovery and fallback retain process selection and slot identity", async () => {
    const { slots, client } = brokerFixture();
    const config = { agent_type: "codex" as const, name: "Worker", role: "Engineer", role_description: "Implement", initial_task: "Fixture task",
      model_selection: { provider: "Fixture", model: "one", catalog_path: "catalog.json" } };
    const result = await launchAgent("fixture-session", directory, config, client);
    const driver = result.codexDriver!;
    await until(() => messages(1).filter(message => message.method === "turn/start").length === 2 && !driver.activeTurnId);
    expect(slots[0]!.model_selection!.catalog_path).toBe(catalog);
    const privateConfig = readFileSync(join(launches[0]!.env.CODEX_HOME!, "config.toml"), "utf8");
    expect(privateConfig).toContain('model_provider="multiagents_custom"');
    expect(privateConfig).toContain('wire_api = "responses"');
    expect(privateConfig).not.toContain("runtime-test-secret");
    expect(launches[0]!.args.join(" ")).not.toContain("runtime-test-secret");
    expect(privateConfig).toContain('"--slot","1"');
    expect(privateConfig).toContain('"--session","fixture-session"');
    expect(privateConfig).toContain('"--name","Worker"');
    expect(privateConfig).toContain('"--role","Engineer"');
    const reply = driver.reply(driver.threadId!, "Follow-up");
    await until(() => !!driver.activeTurnId);
    await driver.steer(driver.threadId!, "Message mid-turn");
    await reply;
    expect(messages(1).filter(message => message.method === "turn/start").every(message => message.params.model === "one")).toBe(true);
    await driver.kill();
    const recovered = await respawnAgent("fixture-session", 1, client, directory);
    await until(() => messages(2).some(message => message.method === "turn/start") && !recovered.codexDriver!.activeTurnId);
    expect(messages(2).some(message => message.method === "thread/resume")).toBe(true);
    expect(slots).toHaveLength(1);
    expect(launches[1]!.args).toEqual(launches[0]!.args);
    expect(launches[1]!.env.CODEX_HOME).toBe(launches[0]!.env.CODEX_HOME);
    await recovered.codexDriver!.kill();
    slots[0]!.context_snapshot = JSON.stringify({ codex_thread_id: "missing" });
    const fallback = await relaunchIntoSlot("fixture-session", directory, slots[0]!, "Resume task", client);
    await until(() => messages(3).filter(message => message.method === "turn/start").length === 2 && !fallback.codexDriver!.activeTurnId);
    expect(messages(3).some(message => message.method === "thread/start")).toBe(true);
    expect(launches[2]!.args).toEqual(launches[0]!.args);
    expect(slots).toHaveLength(1);
    await fallback.codexDriver!.kill();
    expect(await Bun.file(join(directory, ".mcp.json")).exists()).toBe(false);
    expect(await Bun.file(join(directory, ".multiagents", "session.json")).exists()).toBe(false);
  }, 10000);

  test("two simultaneous workers have independent model overrides; default spawn stays unchanged", async () => {
    const { client } = brokerFixture();
    const results = await Promise.all(["one", "two"].map(model => launchAgent("team", directory, {
      agent_type: "codex", name: model, role: "Engineer", role_description: "Test", initial_task: "Task",
      model_selection: { provider: "Fixture", model, catalog_path: catalog },
    }, client)));
    await until(() => results.every(result => result.codexDriver!.threadId && !result.codexDriver!.activeTurnId)
      && [1, 2].every(index => messages(index).filter(m => m.method === "turn/start").length === 2));
    // Concurrent catalog reads may complete in either order; correlate by worker identity.
    for (const model of ["one", "two"]) {
      const launch = launches.find(entry => entry.env.MULTIAGENTS_NAME === model)!;
      expect(readFileSync(join(launch.env.CODEX_HOME!, "config.toml"), "utf8")).toContain(`model="${model}"`);
    }
    expect(launches[0]!.env.CODEX_HOME).not.toBe(launches[1]!.env.CODEX_HOME);
    for (const result of results) await result.codexDriver!.kill();
    const defaultDriver = await CodexDriver.spawn(directory, process.env, 1000);
    expect(launches[2]!.args).toEqual([process.execPath, "app-server"]);
    await defaultDriver.kill();
  }, 10000);

  test("invalid and missing credentials fail before slot or filesystem mutation", async () => {
    const { slots, client } = brokerFixture();
    const config = { agent_type: "codex" as const, name: "X", role: "Y", role_description: "Z", initial_task: "T",
      model_selection: { provider: "Fixture", model: "absent", catalog_path: catalog } };
    await expect(launchAgent("team", directory, config, client)).rejects.toThrow();
    await expect(validateAgentModel({ ...config, agent_type: "claude" }, directory)).rejects.toThrow("only for Codex");
    delete process.env.RUNTIME_TEST_API_KEY;
    await expect(launchAgent("team", directory, { ...config, model_selection: { ...config.model_selection, model: "one" } }, client)).rejects.toThrow("credential");
    expect(slots).toHaveLength(0);
    expect(launches).toHaveLength(0);
    expect(await Bun.file(join(directory, ".mcp.json")).exists()).toBe(false);
  }, 10000);
});