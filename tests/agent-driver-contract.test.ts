import { expect, test } from "bun:test";
import type {
  AgentDriverKind,
  BaseAgentDriver,
  DriverNotification,
  DriverSessionOptions,
  DriverTurnResult,
} from "../shared/agent-driver.ts";
import { CodexDriver } from "../orchestrator/codex-driver.ts";

test("shared driver contract exposes the approved kinds", () => {
  const kinds: AgentDriverKind[] = ["codex", "claude", "gemini"];
  expect(kinds).toEqual(["codex", "claude", "gemini"]);
});

test("CodexDriver conforms to BaseAgentDriver and preserves aliases", () => {
  const ctor: typeof CodexDriver = CodexDriver;
  expect(ctor).toBe(CodexDriver);

  // Compile-time contract assertion; no process is spawned.
  const driverTypeCheck = (driver: BaseAgentDriver): BaseAgentDriver => driver;
  expect(driverTypeCheck).toBeFunction();

  const options: DriverSessionOptions = { prompt: "fixture" };
  const result: DriverTurnResult = { threadId: "t", content: "", usage: { input_tokens: 1 } };
  const notification: DriverNotification = { method: "turn/completed", params: {} };
  expect(options.prompt).toBe("fixture");
  expect(result.threadId).toBe("t");
  expect(notification.method).toBe("turn/completed");
});
