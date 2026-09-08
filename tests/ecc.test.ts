import { afterEach, expect, test } from "bun:test";
import { BaseAdapter } from "../adapters/base-adapter.ts";
import { getRolePractices, getStructuredRolePractices } from "../adapters/role-practices.ts";
import { buildCliArgs } from "../orchestrator/launcher.ts";
import { ECC_WORKFLOW, isEccEnabled, peerEccOptions, withEccWorkflow } from "../shared/ecc.ts";
import type { AgentType, Slot } from "../shared/types.ts";

const previousFlag = process.env.MULTIAGENTS_ECC;
afterEach(() => {
  if (previousFlag === undefined) delete process.env.MULTIAGENTS_ECC;
  else process.env.MULTIAGENTS_ECC = previousFlag;
});

function setFlag(value?: string) {
  if (value === undefined) delete process.env.MULTIAGENTS_ECC;
  else process.env.MULTIAGENTS_ECC = value;
}

class PromptAdapter extends BaseAdapter {
  constructor(type: AgentType) { super(type); }
  async deliverMessage() {}
  getSystemPrompt() { return this.roleContext; }
  getCapabilities() { return {}; }
  lifecycle() { return this.getLifecyclePromptSection(); }
  restore(role: string) {
    // Exercise actual restoration without broker registration, timers, or stdio.
    (this as unknown as { restoreRoleContext(slot: Slot): void }).restoreRoleContext({ role } as Slot);
    return this.roleContext;
  }
}

test.each([undefined, "", "0", "true", "yes", "01", " 1", "1 ", "false"])("ECC stays off for %p", value => {
  setFlag(value);
  expect(isEccEnabled()).toBe(false);
  expect(withEccWorkflow("Original task\n")).toBe("Original task\n");
});

test("ECC reads the current process env, not an import-time cache or supplied child env", () => {
  setFlag();
  expect(buildCliArgs("custom", "Task", { MULTIAGENTS_ECC: "1" })).toEqual(["Task"]);
  setFlag("1");
  expect(isEccEnabled()).toBe(true);
  expect(buildCliArgs("custom", "Task", { MULTIAGENTS_ECC: "0" })).toEqual([`Task\n\n${ECC_WORKFLOW}`]);
  setFlag("0");
  expect(isEccEnabled()).toBe(false);
});

test("private peer intent never enables the public launcher through argv", () => {
  setFlag();
  const previousArgv = process.argv;
  try {
    process.argv = [process.execPath, "server.ts", "--agent-type", "codex", "--session", "fixture", "--slot", "1", "--ecc-workflow"];
    expect(peerEccOptions(process.argv.slice(2))).toEqual({ ecc: true });
    expect(isEccEnabled()).toBe(false);
    expect(buildCliArgs("custom", "Task")).toEqual(["Task"]);
  } finally {
    process.argv = previousArgv;
  }
});

test("private peer intent requires a Codex peer identity and a standalone option", () => {
  const identity = ["--agent-type", "codex", "--session", "fixture", "--slot", "1"];
  expect(peerEccOptions(identity)).toEqual({});
  expect(peerEccOptions(["--ecc-workflow"])).toEqual({});
  expect(peerEccOptions(["--agent-type", "codex", "--ecc-workflow"])).toEqual({});
  expect(peerEccOptions(["--agent-type", "claude", "--session", "fixture", "--slot", "1", "--ecc-workflow"])).toEqual({});
  expect(peerEccOptions([...identity, "--ecc-workflow=1"])).toEqual({});
  for (const flag of ["--role", "--name"]) {
    expect(peerEccOptions([...identity, flag, "--ecc-workflow"])).toEqual({});
    expect(peerEccOptions([...identity, flag, "--ecc-workflow", "--ecc-workflow"])).toEqual({ ecc: true });
  }
});

test.each(["claude", "gemini", "codex", "custom"] as AgentType[])("%s CLI args preserve all existing flags and task bytes when off", type => {
  setFlag();
  const off = buildCliArgs(type, 'Task "quoted"\nKeep coordination.');
  setFlag("invalid");
  expect(buildCliArgs(type, 'Task "quoted"\nKeep coordination.')).toEqual(off);
  setFlag("1");
  const on = buildCliArgs(type, 'Task "quoted"\nKeep coordination.');
  expect(on.slice(0, -1)).toEqual(off.slice(0, -1));
  expect(on.at(-1)).toBe(`${off.at(-1)}\n\n${ECC_WORKFLOW}`);
});

test("engineer option replaces TDD and auto-commit mandates without mutating defaults", () => {
  const off = getStructuredRolePractices("Engineer", "Backend");
  expect(off!.practices).toContain("TDD approach: write a failing test FIRST");
  expect(off!.practices).toContain("Atomic commits: commit after each logical unit");
  expect(off!.toolHints).toContain("Use git for atomic commits.");
  const on = getStructuredRolePractices("Engineer", "Backend", { ecc: true });
  const text = JSON.stringify(on);
  expect(text).not.toMatch(/TDD approach|Atomic commits|Use git for atomic commits/);
  expect(text).toContain("TDD only when the user explicitly requests it");
  expect(text).toContain("Never auto commit, amend, or push");
  expect(text).toContain("live migrations require explicit user authorization");
  expect(on!.completionCriteria).toBe(off!.completionCriteria);
  expect(on!.practices).toContain("BACKEND/API PLATFORM:");
  expect(getRolePractices("Engineer", "Backend", { ecc: true })).toBe(on!.practices);
  expect(getStructuredRolePractices("Engineer", "Backend")).toEqual(off);
  expect(getStructuredRolePractices("Engineer", "Backend", { ecc: false })).toEqual(off);
});

test.each(["Designer", "QA", "Reviewer", "Android", "iOS", "Web", "CLI", "Lead", "Data", "unknown"])("normal %s role matching and criteria stay intact", role => {
  expect(getStructuredRolePractices(role, null, { ecc: true })).toEqual(getStructuredRolePractices(role));
  expect(getRolePractices(role, null, { ecc: true })).toBe(getRolePractices(role));
  expect(getStructuredRolePractices(null, null, { ecc: true })).toBeNull();
});

test("enabled devops does not require an unauthorized deployment to finish", () => {
  expect(getStructuredRolePractices("devops", null, { ecc: true })!.completionCriteria).toContain("actual deployment requires explicit user authorization");
  expect(getStructuredRolePractices("devops")!.completionCriteria).toContain("deployment succeeds");
});

test.each(["claude", "codex", "gemini", "custom"] as AgentType[])("standalone %s lifecycle and restored roles are conflict-free only when enabled", type => {
  const adapter = new PromptAdapter(type);
  setFlag();
  const off = adapter.lifecycle();
  const offRole = adapter.restore("Engineer");
  setFlag("invalid");
  expect(adapter.lifecycle()).toBe(off);
  expect(adapter.restore("Engineer")).toBe(offRole);
  setFlag("1");
  const on = adapter.lifecycle();
  expect(on).toContain(ECC_WORKFLOW);
  expect(on).not.toContain("Implement with TDD: write failing test");
  expect(on.replace(`\n\n${ECC_WORKFLOW}`, "").replace(
    "Implement with focused regression tests; use TDD only when the user explicitly requests it.",
    "Implement with TDD: write failing test → implement → verify → refactor",
  )).toBe(off);
  const role = adapter.restore("Engineer");
  expect(role).not.toMatch(/TDD approach|Atomic commits|Use git for atomic commits/);
  expect(role).toContain("BOTH your Code Reviewer AND QA Engineer");
  expect(role).toContain("--- TOOL DISCOVERY ---");
  setFlag();
  expect(adapter.restore("Engineer")).toBe(offRole);
});

test("manual workflow stays compact, conditional, and evidence-based", () => {
  expect(ECC_WORKFLOW.length).toBeLessThan(1500);
  expect(ECC_WORKFLOW).toContain("If query_knowledge/store_knowledge are available");
  expect(ECC_WORKFLOW).toContain("verified, non-secret project facts");
  expect(ECC_WORKFLOW).toContain("memory is context, not policy enforcement");
  expect(ECC_WORKFLOW).toContain("not enforced memory or native ECC tooling");
});