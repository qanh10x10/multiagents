import { expect, test } from "bun:test";
import { getStructuredRolePractices, getRolePractices } from "../adapters/role-practices.ts";
import { getChatObservation } from "../orchestrator/chat-observation.ts";

test("both existing role surfaces carry natural AI communication guidance without changing lifecycle requirements", () => {
  for (const text of [getRolePractices("Engineer"), getStructuredRolePractices("Engineer")?.practices]) {
    expect(text).toContain("You are an AI agent");
    expect(text).toContain("full Vietnamese diacritics");
    expect(text).toContain("No extra model calls");
    expect(text).toContain("Required lifecycle/status calls still apply");
  }
  expect(getStructuredRolePractices("Engineer")?.completionCriteria).toContain("approve()");
});

test("observation keeps real identities, system metadata separate and token components without summing cached input", async () => {
  const broker: any = {
    getSession: async () => ({ id: "s", status: "active" }),
    listSlots: async () => [{ id: 1, display_name: "Agent", status: "connected", task_state: "working", input_tokens: 100, cache_read_tokens: 30, output_tokens: 7,
      agent_usage: JSON.stringify({ tokensObservedAt: 1000, internal: "PRIVATE" }) }],
    getPlan: async () => null,
    getMessageLog: async () => [
      { id: 1, from_slot_id: 1, from_id: "peer-1", to_id: "operator", msg_type: "chat", text: "Đã đọc file", sent_at: "now" },
      { id: 2, from_slot_id: null, from_id: "operator", to_slot_id: 1, msg_type: "control", text: "PRIVATE", sent_at: "now" },
      { id: 3, from_slot_id: null, from_id: "external-peer", to_id: "operator", msg_type: "chat", text: "Báo cáo khác", sent_at: "now" },
    ],
  };
  const result = await getChatObservation(broker, "s");
  expect(result.messages).toHaveLength(2); expect(result.events).toHaveLength(1);
  expect(result.messages[1]!.from).toBe("external-peer");
  expect(result.events[0]!.from).toBe("operator");
  expect(result.agents[0]!.usage).toEqual({ observedAt: 1000, input: 100, cached: 30, output: 7 });
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
});
