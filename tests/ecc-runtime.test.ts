import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAdapter } from "../adapters/codex-adapter.ts";
import { CodexDriver } from "../orchestrator/codex-driver.ts";
import { launchAgent, mcpServerCommand, relaunchIntoSlot } from "../orchestrator/launcher.ts";
import { ECC_WORKFLOW, isEccEnabled, peerEccOptions } from "../shared/ecc.ts";
import type { BrokerClient } from "../shared/broker-client.ts";
import type { AgentLaunchConfig, Slot } from "../shared/types.ts";

class PeerPromptAdapter extends CodexAdapter {
  lifecycle() { return this.getLifecyclePromptSection(); }
  restore(slot: Slot) {
    (this as unknown as { restoreRoleContext(slot: Slot): void }).restoreRoleContext(slot);
    return this.getSystemPrompt();
  }
}

let root: string;
let project: string;
let previous: Record<string, string | undefined>;
let spawn: ReturnType<typeof spyOn>;
let spawnSync: ReturnType<typeof spyOn>;
let driverSpawn: ReturnType<typeof spyOn>;
const fixtureProcess = { pid: 987654 } as import("bun").Subprocess;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "multiagents-ecc-"));
  project = join(root, "project");
  mkdirSync(project);
  const env = {
    HOME: join(root, "home"), USERPROFILE: join(root, "home"),
    MULTIAGENTS_ECC: "1", ECC_TEST_API_KEY: "offline-fixture",
    CODEX_HOME: join(root, "ambient-codex"), NODE_OPTIONS: "ambient-only",
  };
  previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  spawn = spyOn(Bun, "spawn").mockImplementation(() => { throw new Error("Unexpected subprocess"); });
  // Exercise config isolation without running ACL utilities or any real agent.
  spawnSync = spyOn(Bun, "spawnSync").mockImplementation(((args: string[]) => {
    if (!["whoami.exe", "icacls.exe"].includes(args[0]!)) throw new Error("Unexpected sync subprocess");
    return { exitCode: 0, stdout: Buffer.from("S-1-5-21-123"), stderr: Buffer.alloc(0) };
  }) as typeof Bun.spawnSync);
  driverSpawn = spyOn(CodexDriver, "spawn").mockImplementation(() => { throw new Error("Unexpected driver"); });
});

afterEach(() => {
  spawn.mockRestore();
  spawnSync.mockRestore();
  driverSpawn.mockRestore();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const slot = { id: 1, agent_type: "codex", role: "Engineer", role_description: "Implement", display_name: "Worker", context_snapshot: null } as Slot;
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const client = {
    createSlot: async (value: Partial<Slot>) => Object.assign(slot, value),
    updateSlot: async (value: Partial<Slot>) => {
      Object.assign(slot, value);
      if (value.context_snapshot && JSON.parse(value.context_snapshot).last_summary === "fixture-complete") finish();
      return slot;
    },
  } as unknown as BrokerClient;
  const config: AgentLaunchConfig = {
    agent_type: "codex", name: "Worker", role: "Engineer", role_description: "Implement", initial_task: "Bounded fixture task",
  };
  return { slot, client, config, finished };
}

test.each(["claude", "gemini"] as const)("launched and relaunched %s gets workflow without changing coordination", async type => {
  spawn.mockReturnValue(fixtureProcess);
  const { slot, client, config } = fixture();
  await launchAgent("test-session", project, { ...config, agent_type: type }, client);
  const args = spawn.mock.calls[0]![0] as string[];
  expect(args.at(-1)).toContain(ECC_WORKFLOW);
  expect(args.at(-1)).toContain("STEP 1");
  expect(args.at(-1)).toContain("Bounded fixture task");
  expect(args.at(-1)).toContain("signal_done");
  await relaunchIntoSlot("test-session", project, slot, "Recovery task", client);
  expect((spawn.mock.calls[1]![0] as string[]).at(-1)).toContain(ECC_WORKFLOW);
  expect((spawn.mock.calls[1]![0] as string[]).at(-1)).toContain("Recovery task");
}, 10000);

test("custom launch remains explicitly unsupported rather than inventing a command", async () => {
  const { client, config } = fixture();
  const error = await launchAgent("test-session", project, { ...config, agent_type: "custom" }, client).catch(error => error);
  expect(error.message).toContain("No CLI command configured for agent type: custom");
  expect(spawn).not.toHaveBeenCalled();
}, 10000);

for (const selected of [false, true]) {
  for (const resumed of [false, true]) {
    test.each([undefined, "", "0", "true", "01", "invalid", "1"])(`Codex selected=${selected} resumed=${resumed} flag=%p reaches real task without weakening isolation`, async flag => {
      if (flag === undefined) delete process.env.MULTIAGENTS_ECC;
      else process.env.MULTIAGENTS_ECC = flag;
      const { slot, client, config, finished } = fixture();
      if (resumed) slot.context_snapshot = JSON.stringify({ codex_thread_id: "old-thread" });
      if (selected) {
        const catalog = join(project, "catalog.json");
        writeFileSync(catalog, JSON.stringify([{
          vendor: "customendpoint", name: "Fixture", apiType: "responses", apiKey: "${env:ECC_TEST_API_KEY}",
          models: [{ id: "offline", name: "Offline", url: "https://example.invalid/v1/responses", toolCalling: true }],
        }]));
        config.model_selection = { provider: "Fixture", model: "offline", catalog_path: catalog };
        slot.model_selection = config.model_selection;
      }
      const starts: Array<{ developerInstructions?: string }> = [];
      const replies: string[] = [];
      const driver = {
        pid: fixtureProcess.pid, process: fixtureProcess, threadId: "", alive: true,
        resumeThread: async (id: string) => { driver.threadId = id; },
        startSession: async (options: { developerInstructions?: string }) => {
          starts.push(options);
          driver.threadId = "new-thread";
          return { threadId: driver.threadId, content: "Ready." };
        },
        reply: async (id: string, prompt: string) => {
          replies.push(prompt);
          return { threadId: id, content: "fixture-complete" };
        },
        kill: async () => { driver.alive = false; },
      };
      driverSpawn.mockResolvedValue(driver as unknown as CodexDriver);
      await launchAgent("test-session", project, config, client, resumed ? slot : undefined);
      await finished;
      expect(starts).toHaveLength(resumed ? 0 : 1);
      expect(replies).toHaveLength(1);
      const prompt = replies[0]!;
      expect(prompt.includes(ECC_WORKFLOW)).toBe(flag === "1");
      expect(prompt).toContain(config.initial_task);
      expect(prompt).toContain("signal_done");
      if (!resumed) expect(starts[0]!.developerInstructions!.includes(ECC_WORKFLOW)).toBe(flag === "1");
      const childEnv = driverSpawn.mock.calls[0]![1]!;
      if (selected) {
        expect(childEnv.MULTIAGENTS_ECC).toBeUndefined();
        expect(childEnv.NODE_OPTIONS).toBeUndefined();
        expect(childEnv.CODEX_HOME).not.toBe(process.env.CODEX_HOME);
        expect(childEnv.MULTIAGENTS_SESSION).toBe("test-session");
        const text = readFileSync(join(childEnv.CODEX_HOME!, "config.toml"), "utf8");
        expect(text).toContain("features.plugins=false");
        expect(text).toContain("features.remote_plugin=false");
        expect(text).toContain("features.recommended_plugins=false");
        expect(text).toContain("features.skip_host_skill_discovery=true");
        expect(text).toContain('trust_level="untrusted"');
        expect(text).not.toContain("MULTIAGENTS_ECC");
        expect(text).not.toContain(ECC_WORKFLOW);
        expect(text).not.toContain("offline-fixture");
        const parsed = Bun.TOML.parse(text) as { mcp_servers: { "multiagents-peer": { args: string[] } } };
        const peerArgs = parsed.mcp_servers["multiagents-peer"].args;
        const offArgs = [
          ...mcpServerCommand("codex").args,
          "--session", "test-session", "--slot", "1", "--role", "Engineer", "--name", "Worker",
        ];
        expect(peerArgs).toEqual(flag === "1" ? [...offArgs, "--ecc-workflow"] : offArgs);
        // Render the actual Codex adapter like server.ts, with the filtered child env.
        delete process.env.MULTIAGENTS_ECC;
        try {
          const off = new PeerPromptAdapter();
          const adapter = new PeerPromptAdapter(peerEccOptions(peerArgs.slice(1)));
          const lifecycle = adapter.lifecycle();
          const role = adapter.restore(slot);
          expect(isEccEnabled()).toBe(false);
          expect(process.env.MULTIAGENTS_ECC).toBeUndefined();
          expect(lifecycle.includes(ECC_WORKFLOW)).toBe(flag === "1");
          if (flag === "1") {
            expect(lifecycle).not.toContain("Implement with TDD: write failing test");
            expect(lifecycle.replace(`\n\n${ECC_WORKFLOW}`, "").replace(
              "Implement with focused regression tests; use TDD only when the user explicitly requests it.",
              "Implement with TDD: write failing test → implement → verify → refactor",
            )).toBe(off.lifecycle());
            expect(role).not.toMatch(/TDD approach|Atomic commits|Use git for atomic commits/);
            expect(role).toContain("TDD only when the user explicitly requests it");
          } else {
            expect(lifecycle).toBe(off.lifecycle());
            expect(lifecycle).toContain("Implement with TDD: write failing test");
            expect(role).toBe(off.restore(slot));
          }
        } finally {
          if (flag !== undefined) process.env.MULTIAGENTS_ECC = flag;
        }
      } else expect(childEnv.MULTIAGENTS_ECC).toBe(flag);
      expect(spawn).not.toHaveBeenCalled();
    }, 10000);
  }
}