// Numeric operational telemetry only; never persist raw runtime payloads or credentials.
export interface TokenCounters { input: number; cached: number; output: number }
export interface QuotaWindow { usedPercent: number; windowMinutes: number; resetsAt: number | null; observedAt: number }
export interface AgentUsage {
  version: 1;
  tokensObservedAt?: number;
  streams: Record<string, TokenCounters>;
  quotas: Record<string, { primary?: QuotaWindow; secondary?: QuotaWindow }>;
}
export type AgentUsageUpdate =
  | { kind: "tokens"; stream: string; totals: TokenCounters }
  | { kind: "quota"; bucket: string; primary?: Omit<QuotaWindow, "observedAt">; secondary?: Omit<QuotaWindow, "observedAt"> };

function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid usage object");
  return value as Record<string, any>;
}
function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("Invalid token count");
  return value as number;
}
function windowValue(value: unknown): Omit<QuotaWindow, "observedAt"> {
  const v = record(value);
  if (typeof v.usedPercent !== "number" || !Number.isFinite(v.usedPercent) || v.usedPercent < 0 || v.usedPercent > 100) throw new Error("Invalid quota percentage");
  const minutes = count(v.windowMinutes);
  if (!minutes || minutes > 525600) throw new Error("Invalid quota window");
  return { usedPercent: v.usedPercent, windowMinutes: minutes, resetsAt: v.resetsAt == null ? null : count(v.resetsAt) };
}
export function validateUsageUpdate(value: unknown): AgentUsageUpdate {
  const v = record(value);
  if (v.kind === "tokens") {
    if (typeof v.stream !== "string" || !/^[a-f0-9]{64}$/.test(v.stream)) throw new Error("Invalid usage stream");
    const t = record(v.totals);
    const totals = { input: count(t.input), cached: count(t.cached), output: count(t.output) };
    if (totals.cached > totals.input) throw new Error("Cached tokens exceed input tokens");
    return { kind: "tokens", stream: v.stream, totals };
  }
  if (v.kind === "quota") {
    if (typeof v.bucket !== "string" || !/^[a-f0-9]{64}$/.test(v.bucket)) throw new Error("Invalid quota bucket");
    const update: AgentUsageUpdate = { kind: "quota", bucket: v.bucket };
    if (v.primary != null) update.primary = windowValue(v.primary);
    if (v.secondary != null) update.secondary = windowValue(v.secondary);
    if (!update.primary && !update.secondary) throw new Error("No usable quota windows");
    return update;
  }
  throw new Error("Invalid usage kind");
}

/** Persisted high-water marks make replayed cumulative thread notifications idempotent. */
export function applyUsageUpdate(raw: string | null | undefined, input: unknown, now = Date.now()) {
  const update = validateUsageUpdate(input);
  const state: AgentUsage = raw ? JSON.parse(raw) : { version: 1, streams: {}, quotas: {} };
  const delta: TokenCounters = { input: 0, cached: 0, output: 0 };
  if (update.kind === "tokens") {
    if (!state.streams[update.stream] && Object.keys(state.streams).length >= 128) throw new Error("Usage stream capacity reached");
    const previous = state.streams[update.stream] ?? { input: 0, cached: 0, output: 0 };
    const next = { ...previous };
    for (const key of ["input", "cached", "output"] as const) {
      delta[key] = Math.max(0, update.totals[key] - previous[key]);
      next[key] = Math.max(previous[key], update.totals[key]);
    }
    state.streams[update.stream] = next;
    state.tokensObservedAt = now;
  } else {
    if (!state.quotas[update.bucket] && Object.keys(state.quotas).length >= 16) throw new Error("Quota bucket capacity reached");
    const bucket = state.quotas[update.bucket] ?? {};
    for (const key of ["primary", "secondary"] as const) {
      if (update[key]) bucket[key] = { ...update[key], observedAt: now };
    }
    state.quotas[update.bucket] = bucket;
  }
  return { state, delta };
}