import { expect, test } from "bun:test";
import { applyUsageUpdate } from "../shared/agent-usage.ts";
import { codexUsageUpdate, monitorCodexDriver } from "../orchestrator/monitor.ts";

const tokens = (input = 100, cached = 20, output = 30, threadId = "thread-one") => ({
  method: "thread/tokenUsage/updated", params: { threadId, tokenUsage: { total: { inputTokens: input, cachedInputTokens: cached, outputTokens: output } } },
});
test("canonical cumulative usage survives replay, reconnect, out-of-order and new threads", () => {
  const first = applyUsageUpdate(null, codexUsageUpdate(tokens()), 1000);
  expect(first.delta).toEqual({ input: 100, cached: 20, output: 30 });
  const replay = applyUsageUpdate(JSON.stringify(first.state), codexUsageUpdate(tokens()), 2000);
  expect(replay.delta).toEqual({ input: 0, cached: 0, output: 0 });
  const older = applyUsageUpdate(JSON.stringify(replay.state), codexUsageUpdate(tokens(90, 10, 20)));
  const next = applyUsageUpdate(JSON.stringify(older.state), codexUsageUpdate(tokens(110, 25, 40)));
  expect(next.delta).toEqual({ input: 10, cached: 5, output: 10 });
  expect(applyUsageUpdate(JSON.stringify(next.state), codexUsageUpdate(tokens(50, 0, 10, "new-thread"))).delta.input).toBe(50);
  expect(JSON.stringify(next.state)).not.toContain("thread-one");
});
test("zero is observed, malformed/missing counters are not fabricated", () => {
  expect(applyUsageUpdate(null, codexUsageUpdate(tokens(0, 0, 0)), 1000).state.tokensObservedAt).toBe(1000);
  expect(codexUsageUpdate(tokens(-1))).toBeNull();
  expect(codexUsageUpdate(tokens(10, 20))).toBeNull();
  expect(codexUsageUpdate(tokens(NaN))).toBeNull();
  expect(codexUsageUpdate({ method: "thread/tokenUsage/updated", params: {} })).toBeNull();
});
test("quota sparse updates preserve timestamp of missing window and exclude account secrets", () => {
  const notify = (rateLimits: any) => codexUsageUpdate({ method: "account/rateLimits/updated", params: { rateLimits } });
  const first = applyUsageUpdate(null, notify({ limitId: "private-account-bucket", credits: { secret: "secret-value" },
    primary: { usedPercent: 50, windowDurationMins: 300, resetsAt: 2000 },
    secondary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: null },
  }), 1000);
  const second = applyUsageUpdate(JSON.stringify(first.state), notify({ limitId: "private-account-bucket",
    primary: { usedPercent: 60, windowDurationMins: 300, resetsAt: 3000 }, secondary: null,
  }), 1500);
  const quota = Object.values(second.state.quotas)[0]!;
  expect(quota.primary).toEqual({ usedPercent: 60, windowMinutes: 300, resetsAt: 3000000, observedAt: 1500 });
  expect(quota.secondary!.observedAt).toBe(1000);
  expect(JSON.stringify(second.state)).not.toContain("secret-value");
  expect(JSON.stringify(second.state)).not.toContain("private-account-bucket");
  expect(notify({ primary: { usedPercent: 50, windowDurationMins: null } })).toBeNull();
  expect(notify({ primary: { usedPercent: 150, windowDurationMins: 300 } })).toBeNull();
});
test("driver listener serializes usage and does not count completion twice", async () => {
  let notify: any;
  const updates: any[] = [];
  const broker: any = { updateSlot: async (update: any) => { updates.push(update); }, getSlot: async () => ({ task_state: "working" }) };
  monitorCodexDriver({ onNotification: (callback: any) => { notify = callback; } } as any, 1, "session", broker, () => {});
  notify(tokens()); notify(tokens(110, 25, 40));
  notify({ method: "turn/completed", params: { usage: { input_tokens: 110, output_tokens: 40 } } });
  // Flush the deterministic promise queue; no timers or live providers.
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(updates).toHaveLength(2);
  expect(updates[0].agent_usage.totals.input).toBe(100);
  expect(updates[1].agent_usage.totals.input).toBe(110);
});