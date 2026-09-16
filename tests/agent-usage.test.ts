import { expect, test } from "bun:test";
import { applyUsageUpdate } from "../shared/agent-usage.ts";
import { codexUsageUpdate, monitorCodexDriver, parseEngineUsage } from "../orchestrator/monitor.ts";

test("parseEngineUsage parses Claude, Codex, Gemini CLI, and Grok/OpenAI usage correctly", () => {
  // Claude
  const claudeResult = {
    type: "result",
    result: { usage: { input_tokens: 150, output_tokens: 45, cache_read_input_tokens: 30 } },
  };
  expect(parseEngineUsage(claudeResult)).toEqual({ input: 150, output: 45, cacheRead: 30 });

  // Gemini CLI stream-json / json format
  const geminiResult = {
    type: "result",
    status: "success",
    stats: { total_tokens: 500, input_tokens: 350, output_tokens: 150, cached: 80 },
  };
  expect(parseEngineUsage(geminiResult)).toEqual({ input: 350, output: 150, cacheRead: 80 });

  // Codex token_count format
  const codexTokenCount = {
    msg: {
      type: "token_count",
      info: { total_token_usage: { input_tokens: 200, output_tokens: 50, cached_input_tokens: 10 } },
    },
  };
  expect(parseEngineUsage(codexTokenCount)).toEqual({ input: 200, output: 50, cacheRead: 10 });

  // Grok (xAI) / OpenAI standard usage format
  const grokUsage = {
    usage: {
      prompt_tokens: 400,
      completion_tokens: 120,
      total_tokens: 520,
      prompt_tokens_details: { cached_tokens: 100 },
    },
  };
  expect(parseEngineUsage(grokUsage)).toEqual({ input: 400, output: 120, cacheRead: 100 });

  // Fallback / null
  expect(parseEngineUsage({})).toBeNull();
  expect(parseEngineUsage(null)).toBeNull();
});

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