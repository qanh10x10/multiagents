import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BaseAdapter } from "../adapters/base-adapter.ts";

class ResolutionAdapter extends BaseAdapter {
  constructor() { super("codex"); }
  async deliverMessage() {}
  getSystemPrompt() { return ""; }
  getCapabilities() { return {}; }
  resolve() {
    this.resolveSession();
    return { sessionId: this.sessionId, sessionFile: this.sessionFile };
  }
}

test("actual adapter resolution prefers explicit session/slot over stale shared files", () => {
  const directory = mkdtempSync(join(tmpdir(), "multiagents-adapter-session-"));
  const cwd = process.cwd();
  const previous = { session: process.env.MULTIAGENTS_SESSION, slot: process.env.MULTIAGENTS_SLOT };
  try {
    mkdirSync(join(directory, ".multiagents"));
    writeFileSync(join(directory, ".multiagents", "session.json"), JSON.stringify({ session_id: "stale-A", last_slot_id: 99 }));
    process.chdir(directory);
    process.env.MULTIAGENTS_SESSION = "selected-B";
    process.env.MULTIAGENTS_SLOT = "2";
    const adapter = new ResolutionAdapter();
    expect(adapter.resolve()).toEqual({ sessionId: "selected-B", sessionFile: null });
    delete process.env.MULTIAGENTS_SESSION;
    expect(adapter.resolve()).toEqual({ sessionId: null, sessionFile: null });
    delete process.env.MULTIAGENTS_SLOT;
    expect(adapter.resolve().sessionId).toBe("stale-A");
    process.env.MULTIAGENTS_SESSION = "explicit-without-slot";
    expect(adapter.resolve()).toEqual({ sessionId: "explicit-without-slot", sessionFile: null });
  } finally {
    process.chdir(cwd);
    for (const [key, value] of [["MULTIAGENTS_SESSION", previous.session], ["MULTIAGENTS_SLOT", previous.slot]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});