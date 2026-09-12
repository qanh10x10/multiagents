import { expect, test } from "bun:test";
import { spawnAgentDriver } from "../orchestrator/launcher.ts";
import { driverUsageUpdate } from "../orchestrator/monitor.ts";
import { resumeDriverOrStart } from "../orchestrator/recovery.ts";

test("driver factory rejects Gemini without a verified native profile", async () => {
  await expect(spawnAgentDriver("gemini", process.cwd())).rejects.toThrow("verified runtime profile");
});

test("generic monitor usage accepts normalized native counters", () => {
  expect(driverUsageUpdate({ method: "turn/completed", params: { usage: { input_tokens: 3, output_tokens: 5, cached_input_tokens: 2 } } })).toEqual({ input: 3, output: 5, cacheRead: 2 });
});

test("recovery never resumes a thread across engines", async () => {
  let resumed = false;
  let started = false;
  const driver = {
    kind: "claude" as const, threadId: null, activeTurnId: null, alive: true, pid: 1, lastActivity: 0, lastNotificationActivity: 0,
    resumeThread: async () => { resumed = true; }, reply: async () => ({ threadId: "bad", content: "bad" }),
    startSession: async () => { started = true; return { threadId: "new", content: "fresh" }; }, steer: async () => {}, interrupt: async () => {}, onNotification: () => {}, onExit: () => {}, kill: async () => {},
  };
  const result = await resumeDriverOrStart(driver, "codex", "codex-thread", "handoff");
  expect(result.threadId).toBe("new");
  expect(started).toBe(true);
  expect(resumed).toBe(false);
});
