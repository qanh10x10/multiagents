import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { getChatObservation } from "../orchestrator/chat-observation.ts";
const require = createRequire(import.meta.url);
const { parseRequest, toolFamily, exactAgent, decodeObservation, safeText, watch, cancellableDelay, chatContext, followups, conversationIntent, resumeRoster, stateKey } = require("../extensions/multiagents-chat/core.cjs");

const snapshot = () => ({ session: { id: "team", status: "active" }, agents: [{ id: 1, name: "Worker", connection: "connected", task: "working", paused: false }], plan: null, messages: [] as any[] });
const token = () => ({ isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) });

describe("chat watch core", () => {
  test("conversation recognizes bounded accented intents, never mixed or negated controls", () => {
    expect(conversationIntent("")).toEqual({ command: "status", welcome: true });
    expect(conversationIntent("b\u1eadt l\u1ea1i t\u1ea5t c\u1ea3 c\u00e1c worker")).toMatchObject({ command: "resume", all: true });
    expect(conversationIntent("ti\u1ebfp t\u1ee5c x\u1eed l\u00fd task \u0111ang t\u1ed3n \u0111\u1ecdng")).toMatchObject({ command: "resume", continueWork: true });
    expect(conversationIntent("xem ti\u1ebfn \u0111\u1ed9").command).toBe("status");
    expect(conversationIntent("doi session").command).toBe("session");
    for (const text of ["khong bat lai all worker", "don't resume all", "resume all then stop", "neu loi thi stop", "all", "please rewrite files"]) {
      expect(conversationIntent(text).command).toBe("clarify");
    }
  });
  test("resume roster excludes released and already-running workers", () => {
    const data = snapshot();
    data.agents.push({ id: 2, name: "Offline", connection: "disconnected", task: "approved", paused: false });
    data.agents.push({ id: 3, name: "Released", connection: "disconnected", task: "released", paused: false });
    data.agents.push({ id: 4, name: "Paused", connection: "connected", task: "working", paused: true });
    expect(resumeRoster(data).restart.map((a: any) => a.id)).toEqual([2]);
    expect(resumeRoster(data).unpause.map((a: any) => a.id)).toEqual([4]);
    expect(stateKey(data)).toBe(stateKey({ ...data, agents: [...data.agents].reverse() }));
  });
  test("history is scoped to participant and selected server; followups include exact session", () => {
    const history = [{ participant: "multiagents.chat", result: { metadata: { tool: "owner", session: "team" } } }];
    expect(chatContext(history, "owner").session).toBe("team");
    expect(chatContext(history, "another")).toEqual({});
    expect(chatContext([{ ...history[0], participant: "other" }], "owner")).toEqual({});
    expect(followups(history[0]!.result).find((f: any) => f.command === "resume").prompt).toBe("team | @all");
    expect(followups({})).toEqual([]);
  });
  test("exact syntax preserves conditions and rejects missing targets", () => {
    expect(parseRequest("direct", "team | Worker | keep A | B").message).toBe("keep A | B");
    expect(() => parseRequest("stop", "team")).toThrow();
    expect(() => parseRequest("watch", "team | extra")).toThrow();
    expect(() => parseRequest("delete", "team")).toThrow();
    expect(exactAgent(snapshot(), "1").name).toBe("Worker");
    expect(() => exactAgent(snapshot(), "Work")).toThrow();
    expect(() => decodeObservation(JSON.stringify(snapshot()), "other")).toThrow();
  });
  test("controls stay on the explicitly selected MCP tool family", () => {
    const tools = [{ name: "a_get_chat_observation" }, { name: "b_remove_agent" }];
    const find = toolFamily(tools, "a_get_chat_observation");
    expect(() => find("remove_agent")).toThrow();
    expect(() => toolFamily(tools, "missing")).toThrow();
  });
  test("unchanged snapshots do not duplicate status/reports; watch never invokes control", async () => {
    const t = token(); const emitted: string[] = []; let reads = 0;
    const data = snapshot(); data.messages = [{ id: 1, time: "now", from: "A", to: "B", type: "chat", text: "Step one" }];
    await watch({ token: t, fetchSnapshot: async () => { reads++; return data; }, emit: (s: string) => emitted.push(s),
      delay: async () => { if (reads === 2) t.isCancellationRequested = true; } });
    expect(reads).toBe(2);
    expect(emitted.filter(s => s.includes("Step one"))).toHaveLength(1);
    expect(emitted.filter(s => s.includes("Phiên: team"))).toHaveLength(1);
  });
  test("cancel during fetch prevents subsequent writes", async () => {
    const t = token(); const emitted: string[] = [];
    await watch({ token: t, fetchSnapshot: async () => { t.isCancellationRequested = true; return snapshot(); }, emit: (s: string) => emitted.push(s) });
    expect(emitted).toEqual([]);
  });
  test("disconnect stops watch without declaring success", async () => {
    const data = snapshot(); data.agents[0]!.connection = "disconnected";
    const emitted: string[] = [];
    await watch({ token: token(), fetchSnapshot: async () => data, emit: (s: string) => emitted.push(s) });
    expect(emitted.at(-1)).toContain("không chứng minh hoàn thành");
  });
  test("delay cancels and disposes listener", async () => {
    let cancel = () => {}; let disposed = false;
    const pending = cancellableDelay(10000, { isCancellationRequested: false, onCancellationRequested: (cb: () => void) => {
      cancel = cb; return { dispose() { disposed = true; } };
    } });
    cancel(); await pending; expect(disposed).toBe(true);
  });
  test("common credential patterns are redacted, not a free-text guarantee", () => {
    expect(safeText("Bearer sensitive123 api_key=secret123")).toBe("Bearer [redacted] api_key=[redacted]");
  });
});

test("chat observation projects only operational data", async () => {
  const broker: any = {
    getSession: async () => ({ id: "team", status: "active", config: "SECRET" }),
    listSlots: async () => [{ id: 1, display_name: "Worker", status: "connected", task_state: "working", context_snapshot: "PRIVATE THREAD", model_selection: { apiKey: "SECRET" } }],
    getPlan: async () => null,
    getMessageLog: async () => [{ id: 1, msg_type: "system", text: "internal" }, { id: 2, msg_type: "chat", from_slot_id: 1, to_slot_id: null, text: "Files checked", sent_at: "now" }],
  };
  const result = await getChatObservation(broker, "team");
  expect(JSON.stringify(result)).not.toContain("SECRET");
  expect(JSON.stringify(result)).not.toContain("PRIVATE THREAD");
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]!.from).toBe("Worker");
});