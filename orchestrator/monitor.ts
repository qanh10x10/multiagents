// ============================================================================
// multiagents — Process Monitor
// ============================================================================
// Monitors agent process lifecycle: stdout parsing, status updates, crash
// detection.
// ============================================================================

import type { Subprocess } from "bun";
import { createHash } from "node:crypto";
import type { AgentUsageUpdate } from "../shared/agent-usage.ts";
import { validateUsageUpdate } from "../shared/agent-usage.ts";
import type { BrokerClient } from "../shared/broker-client.ts";
import type { CodexDriver, CodexNotification } from "./codex-driver.ts";
import type { BaseAgentDriver, DriverNotification } from "../shared/agent-driver.ts";
import { log } from "../shared/utils.ts";

const LOG_PREFIX = "monitor";
type ProcessReadableStream = Exclude<Subprocess["stdout"], number | null | undefined>;

// Track last-seen cumulative tokens per slot (Codex sends cumulative totals)
const lastTokenTotals = new Map<number, { input: number; output: number; cacheRead: number }>();

/** Exported helper to parse token usage from varied engine outputs (Claude, Codex, Gemini CLI, Grok/OpenAI). */
export function parseEngineUsage(parsed: any): { input: number; output: number; cacheRead: number } | null {
  if (!parsed || typeof parsed !== "object") return null;

  // 1. Claude stream-json result
  if (parsed.type === "result" && parsed.result?.usage) {
    const usage = parsed.result.usage;
    return {
      input: Number(usage.input_tokens ?? 0),
      output: Number(usage.output_tokens ?? 0),
      cacheRead: Number(usage.cache_read_input_tokens ?? usage.cache_creation_input_tokens ?? 0),
    };
  }

  // 2. Gemini CLI stream-json / json format:
  // Can be { type: "result", stats: { input_tokens, output_tokens, cached } }
  // or { stats: { input_tokens, output_tokens, cached } }
  const stats = parsed.stats ?? (parsed.type === "result" ? parsed.stats : undefined);
  if (stats && (stats.input_tokens !== undefined || stats.output_tokens !== undefined || stats.total_tokens !== undefined)) {
    return {
      input: Number(stats.input_tokens ?? stats.inputTokens ?? 0),
      output: Number(stats.output_tokens ?? stats.outputTokens ?? 0),
      cacheRead: Number(stats.cached ?? stats.cached_tokens ?? 0),
    };
  }

  // 3. Codex token_count message
  if (parsed.msg?.type === "token_count" && parsed.msg?.info?.total_token_usage) {
    const tu = parsed.msg.info.total_token_usage;
    return {
      input: Number(tu.input_tokens ?? 0),
      output: Number(tu.output_tokens ?? 0),
      cacheRead: Number(tu.cached_input_tokens ?? 0),
    };
  }

  // 4. OpenAI / Grok (xAI) / custom gateway standard usage object:
  // e.g. { usage: { prompt_tokens, completion_tokens, total_tokens, prompt_tokens_details: { cached_tokens } } }
  // or { response: { usage: ... } }
  const genericUsage = parsed.usage ?? parsed.response?.usage;
  if (genericUsage && (genericUsage.prompt_tokens !== undefined || genericUsage.input_tokens !== undefined
    || genericUsage.completion_tokens !== undefined || genericUsage.output_tokens !== undefined)) {
    const input = Number(genericUsage.prompt_tokens ?? genericUsage.input_tokens ?? 0);
    const output = Number(genericUsage.completion_tokens ?? genericUsage.output_tokens ?? 0);
    const cached = Number(genericUsage.prompt_tokens_details?.cached_tokens
      ?? genericUsage.input_tokens_details?.cached_tokens
      ?? genericUsage.cached_tokens
      ?? genericUsage.cache_read_input_tokens
      ?? 0);
    if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return null;
    // ponytail: Grok/xAI sometimes reports cache outside prompt; clamp so validateUsageUpdate does not drop the row.
    return { input, output, cacheRead: Math.min(Number.isFinite(cached) && cached > 0 ? cached : 0, input) };
  }

  return null;
}

function isReadableStream(
  stream: Subprocess["stdout"] | Subprocess["stderr"],
): stream is ProcessReadableStream {
  return stream !== undefined && stream !== null && typeof stream !== "number";
}

/** Update token usage for a slot — handles both delta and cumulative formats. */
async function updateTokenUsage(
  slotId: number,
  tokens: { input: number; output: number; cacheRead: number },
  brokerClient: BrokerClient,
): Promise<void> {
  // Codex sends cumulative totals; Claude sends per-result totals.
  // For Codex, we compute the delta from the last seen value.
  // For Claude, each "result" contains the full session usage, so we also delta.
  const last = lastTokenTotals.get(slotId) ?? { input: 0, output: 0, cacheRead: 0 };
  const deltaInput = Math.max(0, tokens.input - last.input);
  const deltaOutput = Math.max(0, tokens.output - last.output);
  const deltaCacheRead = Math.max(0, tokens.cacheRead - last.cacheRead);

  lastTokenTotals.set(slotId, tokens);

  if (deltaInput === 0 && deltaOutput === 0 && deltaCacheRead === 0) return;

  try {
    await brokerClient.updateSlot({
      id: slotId,
      input_tokens: deltaInput,
      output_tokens: deltaOutput,
      cache_read_tokens: deltaCacheRead,
    });
  } catch {
    // Best-effort token tracking
  }
}

/** Event emitted by the process monitor. */
export interface AgentEvent {
  type: string;
  severity: "info" | "warning" | "critical";
  slotId: number;
  sessionId: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Monitor an agent subprocess: read stdout for progress signals,
 * update slot status in the broker, and fire events on exit.
 *
 * This function is non-blocking — it starts async readers and returns
 * immediately.
 */
export function monitorProcess(
  proc: Subprocess,
  slotId: number,
  sessionId: string,
  brokerClient: BrokerClient,
  onEvent: (event: AgentEvent) => void,
): void {
  // Read stdout for JSON progress lines
  if (isReadableStream(proc.stdout)) {
    readStream(proc.stdout, slotId, sessionId, brokerClient, onEvent);
  }

  // Read stderr for error output
  if (isReadableStream(proc.stderr)) {
    readStderr(proc.stderr, slotId, sessionId, onEvent);
  }

  // Monitor process exit
  proc.exited.then((exitCode) => {
    handleExit(exitCode, slotId, sessionId, brokerClient, onEvent);
  });
}

/** Read stdout stream, parse JSON lines for progress signals. */
async function readStream(
  stdout: ProcessReadableStream,
  slotId: number,
  sessionId: string,
  brokerClient: BrokerClient,
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    const reader = stdout.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        await processLine(trimmed, slotId, sessionId, brokerClient, onEvent);
      }
    }
  } catch (err) {
    log(LOG_PREFIX, `stdout reader error for slot ${slotId}: ${err}`);
  }
}

/** Process a single stdout line, attempting JSON parse for structured signals. */
/** Track which slots have already been transitioned to "working" (avoid repeated broker calls). */
const transitionedToWorking = new Set<number>();

/** Clear all tracking state for a slot (call on release/session end). */
export function clearSlotTracking(slotId: number): void {
  lastTokenTotals.delete(slotId);
  transitionedToWorking.delete(slotId);
}

/** Clear all tracking state (call on full session cleanup). */
export function clearAllTracking(): void {
  lastTokenTotals.clear();
  transitionedToWorking.clear();
}

/** Auto-transition task_state from "idle" to "working" on first detected activity. */
async function autoTransitionToWorking(slotId: number, brokerClient: BrokerClient): Promise<void> {
  if (transitionedToWorking.has(slotId)) return;
  transitionedToWorking.add(slotId);
  try {
    const slot = await brokerClient.getSlot(slotId);
    if (slot.task_state === "idle") {
      await brokerClient.updateSlot({ id: slotId, task_state: "working" });
      log(LOG_PREFIX, `Slot ${slotId} auto-transitioned to "working"`);
    }
  } catch { /* best effort */ }
}

async function processLine(
  line: string,
  slotId: number,
  sessionId: string,
  brokerClient: BrokerClient,
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  // Try parsing as JSON (Claude stream-json format)
  try {
    const parsed = JSON.parse(line);

    // Multi-engine token usage parsing (Claude, Codex, Gemini CLI, Grok/OpenAI)
    const tokenUsage = parseEngineUsage(parsed);
    if (tokenUsage) {
      await updateTokenUsage(slotId, tokenUsage, brokerClient);
    }

    // Claude stream-json result message
    if (parsed.type === "result" && parsed.result) {
      onEvent({
        type: "agent_output",
        severity: "info",
        slotId,
        sessionId,
        message: `Agent produced result`,
        data: { result: parsed.result },
      });
    }

    // Gemini CLI result event: { type: "result", status: "success"|"error", stats: { ... } }
    if (parsed.type === "result" && (parsed.stats || parsed.status)) {
      onEvent({
        type: "agent_output",
        severity: parsed.status === "error" ? "warning" : "info",
        slotId,
        sessionId,
        message: `Gemini CLI turn finished (${parsed.status ?? "success"})`,
        data: { stats: parsed.stats },
      });
    }

    // Gemini CLI activity events:
    // { type: "message", role: "assistant", content: "..." }
    // { type: "tool_use", tool_name: "...", parameters: { ... } }
    // { type: "tool_result", tool_name: "...", status: "success" }
    if (parsed.type === "message" && parsed.role === "assistant" && parsed.content) {
      await autoTransitionToWorking(slotId, brokerClient);
      const text = typeof parsed.content === "string" ? parsed.content : JSON.stringify(parsed.content);
      try {
        await brokerClient.updateSlot({
          id: slotId,
          context_snapshot: JSON.stringify({
            last_summary: text.slice(0, 200),
            last_status: "working",
            updated_at: Date.now(),
          }),
        });
      } catch { /* best effort */ }
    }

    if (parsed.type === "tool_use") {
      await autoTransitionToWorking(slotId, brokerClient);
      const toolName = parsed.tool_name ?? parsed.name ?? "unknown";
      try {
        await brokerClient.updateSlot({
          id: slotId,
          context_snapshot: JSON.stringify({
            last_summary: `Tool: ${toolName}`,
            last_status: "working",
            updated_at: Date.now(),
          }),
        });
      } catch { /* best effort */ }
      onEvent({
        type: "agent_progress",
        severity: "info",
        slotId,
        sessionId,
        message: `Gemini using tool: ${toolName}`,
        data: { tool: toolName },
      });
    }

    // Codex JSONL activity events — update context_snapshot so the
    // orchestrator knows the agent is active (prevents false "silent" nudges).
    // Codex `--json` emits JSONL with this structure:
    //   {type:"item.completed", item:{type:"agent_message", text:"..."}}
    //   {type:"item.completed", item:{type:"command_execution", command:"...", aggregated_output:"..."}}
    //   {type:"item.completed", item:{type:"mcp_tool_call", server:"...", tool:"...", result:{...}}}
    // Also handles legacy format: {msg:{type:"message"|"exec_command_output"|"mcp_tool_call",...}}
    const codexItem = parsed.item ?? parsed.msg;
    if (parsed.type === "item.completed" && codexItem) {
      // Auto-transition to "working" on first Codex activity
      await autoTransitionToWorking(slotId, brokerClient);
      const itemType = codexItem.type;

      if (itemType === "agent_message" && codexItem.text) {
        try {
          const summary = codexItem.text.slice(0, 200);
          await brokerClient.updateSlot({
            id: slotId,
            context_snapshot: JSON.stringify({
              last_summary: summary,
              last_status: "working",
              updated_at: Date.now(),
            }),
          });
        } catch {
          // Best-effort snapshot update
        }
      }

      if (itemType === "command_execution") {
        try {
          await brokerClient.updateSlot({
            id: slotId,
            context_snapshot: JSON.stringify({
              last_summary: `Running: ${(codexItem.command ?? "shell command").slice(0, 100)}`,
              last_status: "working",
              updated_at: Date.now(),
            }),
          });
        } catch { /* best-effort */ }
      }

      if (itemType === "mcp_tool_call") {
        try {
          await brokerClient.updateSlot({
            id: slotId,
            context_snapshot: JSON.stringify({
              last_summary: `MCP: ${codexItem.server ?? ""}/${codexItem.tool ?? "unknown"}`.slice(0, 100),
              last_status: "working",
              updated_at: Date.now(),
            }),
          });
        } catch { /* best-effort */ }
      }
    }

    // Legacy Codex format (older versions): {msg:{type:"message"|"exec_command_output",...}}
    if (parsed.msg?.type === "message" && parsed.msg?.role === "assistant") {
      try {
        const content = parsed.msg.content;
        const contentText = Array.isArray(content)
          ? content
              .filter((c: any) => c.type === "output_text")
              .map((c: any) => c.text)
              .join("")
          : typeof content === "string" ? content : "";
        if (contentText) {
          await brokerClient.updateSlot({
            id: slotId,
            context_snapshot: JSON.stringify({
              last_summary: contentText.slice(0, 200),
              last_status: "working",
              updated_at: Date.now(),
            }),
          });
        }
      } catch { /* best-effort */ }
    }
    if (parsed.msg?.type === "exec_command_output" || parsed.msg?.type === "mcp_tool_call") {
      try {
        await brokerClient.updateSlot({
          id: slotId,
          context_snapshot: JSON.stringify({
            last_summary: parsed.msg.type === "exec_command_output"
              ? `Running: ${(parsed.msg.info?.command ?? "shell command").slice(0, 100)}`
              : `MCP tool: ${(parsed.msg.info?.tool_name ?? "unknown").slice(0, 100)}`,
            last_status: "working",
            updated_at: Date.now(),
          }),
        });
      } catch { /* best-effort */ }
    }

    // Claude stream-json assistant message with content
    if (parsed.type === "assistant" && parsed.message?.content) {
      // Auto-transition to "working" on first Claude output
      await autoTransitionToWorking(slotId, brokerClient);
      // Update the slot's context snapshot with latest output
      try {
        const contentText = Array.isArray(parsed.message.content)
          ? parsed.message.content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("")
          : String(parsed.message.content);

        const summary = contentText.slice(0, 200);
        await brokerClient.updateSlot({
          id: slotId,
          context_snapshot: JSON.stringify({
            last_summary: summary,
            last_status: "working",
            updated_at: Date.now(),
          }),
        });
      } catch {
        // Best-effort snapshot update
      }
    }

    // Tool use signals progress — auto-transition to "working"
    if (parsed.type === "assistant" && parsed.message?.stop_reason === "tool_use") {
      await autoTransitionToWorking(slotId, brokerClient);
      onEvent({
        type: "agent_progress",
        severity: "info",
        slotId,
        sessionId,
        message: "Agent is using tools",
      });
    }

    return;
  } catch {
    // Not JSON — treat as plain text output, ignore
  }
}

/** Read stderr for error messages. */
async function readStderr(
  stderr: ProcessReadableStream,
  slotId: number,
  sessionId: string,
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    const reader = stderr.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Check for error patterns
        if (/error|fatal|panic|exception/i.test(trimmed)) {
          onEvent({
            type: "agent_error",
            severity: "warning",
            slotId,
            sessionId,
            message: `Agent stderr: ${trimmed.slice(0, 200)}`,
          });
        }
      }
    }
  } catch (err) {
    log(LOG_PREFIX, `stderr reader error for slot ${slotId}: ${err}`);
  }
}

/** Handle process exit — update slot and emit event. */
async function handleExit(
  exitCode: number,
  slotId: number,
  sessionId: string,
  brokerClient: BrokerClient,
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  // Update slot status to disconnected
  try {
    await brokerClient.updateSlot({
      id: slotId,
      status: "disconnected",
    });
  } catch (err) {
    log(LOG_PREFIX, `Failed to update slot ${slotId} on exit: ${err}`);
  }

  if (exitCode === 0) {
    onEvent({
      type: "agent_completed",
      severity: "info",
      slotId,
      sessionId,
      message: `Agent in slot ${slotId} completed successfully`,
      data: { exit_code: exitCode },
    });
  } else {
    onEvent({
      type: "agent_crashed",
      severity: "critical",
      slotId,
      sessionId,
      message: `Agent in slot ${slotId} exited with code ${exitCode}`,
      data: { exit_code: exitCode },
    });
  }

  log(LOG_PREFIX, `Slot ${slotId} process exited with code ${exitCode}`);
}

/**
 * Monitor a CodexDriver via its app-server notification stream.
 *
 * The app-server emits rich notifications: turn/started, turn/completed,
 * item/started, item/completed, item/agentMessage/delta, etc. This bridges
 * those into the slot tracking system (token counts, activity summaries,
 * health detection, auto-transition to "working").
 */
export function monitorCodexDriver(
  driver: CodexDriver,
  slotId: number,
  sessionId: string,
  brokerClient: BrokerClient,
  onEvent: (event: AgentEvent) => void,
): void {
  let usageQueue = Promise.resolve();
  let sawThreadUsage = false;
  driver.onNotification((notification: CodexNotification) => {
    if (notification.method === "thread/tokenUsage/updated" || notification.method === "account/rateLimits/updated") {
      if (notification.method === "thread/tokenUsage/updated") sawThreadUsage = true;
      // Serialize telemetry only, keeping item/activity processing off this queue.
      usageQueue = usageQueue.then(async () => {
        const update = codexUsageUpdate(notification);
        if (update) await brokerClient.updateSlot({ id: slotId, agent_usage: update });
      }).catch(() => { log(LOG_PREFIX, `Usage update unavailable for slot ${slotId}`); });
      return;
    }
    // Hollow/OpenAI/Grok often omit thread/tokenUsage/updated. Gemini usually
    // attaches usage on turn/completed; Grok may only attach it on item/completed
    // while the turn is still running. Skip after canonical thread totals arrive.
    if (!sawThreadUsage && (notification.method === "turn/completed" || notification.method === "item/completed")) {
      usageQueue = usageQueue.then(async () => {
        const update = codexUsageUpdate(notification);
        if (update) await brokerClient.updateSlot({ id: slotId, agent_usage: update });
      }).catch(() => { log(LOG_PREFIX, `Usage update unavailable for slot ${slotId}`); });
    }
    void handleCodexNotification(notification, slotId, sessionId, brokerClient, onEvent);
  });
}

/** Attach lifecycle and token monitoring to any persistent engine driver. */
export function monitorAgentDriver(
  driver: BaseAgentDriver,
  slotId: number,
  sessionId: string,
  brokerClient: BrokerClient,
  onEvent: (event: AgentEvent) => void,
): void {
  driver.onNotification((notification) => {
    const usage = driverUsageUpdate(notification);
    if (usage) void updateTokenUsage(slotId, usage, brokerClient);
    if (notification.method === "turn/started") void autoTransitionToWorking(slotId, brokerClient);
    if (notification.method === "turn/completed") {
      onEvent({ type: "agent_output", severity: "info", slotId, sessionId, message: `${driver.kind} turn completed in slot ${slotId}`, data: usage ? { usage } : undefined });
    }
  });
  driver.onExit(() => void handleExit(1, slotId, sessionId, brokerClient, onEvent));
}

/** Normalize native engine token counters without assuming a Codex payload. */
export function driverUsageUpdate(notification: DriverNotification): { input: number; output: number; cacheRead: number } | null {
  const value = (notification.params.usage ?? notification.params) as Record<string, unknown>;
  const number = (snake: string, camel: string) => {
    const raw = value[snake] ?? value[camel];
    return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : 0;
  };
  const usage = {
    input: number("input_tokens", "inputTokens"),
    output: number("output_tokens", "outputTokens"),
    cacheRead: number("cached_input_tokens", "cachedInputTokens"),
  };
  return usage.input || usage.output || usage.cacheRead ? usage : null;
}

function usageStreamId(...ids: unknown[]): string | null {
  const id = ids.find((value): value is string => typeof value === "string" && value.length > 0 && value.length <= 300);
  return id ? createHash("sha256").update(id).digest("hex") : null;
}

function usageTotals(raw: unknown): { input: number; cached: number; output: number } | null {
  const parsed = parseEngineUsage({ usage: raw }) ?? parseEngineUsage(raw);
  if (parsed) return { input: parsed.input, cached: Math.min(parsed.cacheRead, parsed.input), output: parsed.output };
  if (!raw || typeof raw !== "object") return null;
  const t = (raw as { total?: Record<string, unknown> }).total ?? (raw as Record<string, unknown>);
  const input = t.inputTokens ?? t.input_tokens ?? t.prompt_tokens;
  const output = t.outputTokens ?? t.output_tokens ?? t.completion_tokens;
  const cached = t.cachedInputTokens ?? t.cached_input_tokens
    ?? (t.prompt_tokens_details as { cached_tokens?: unknown } | undefined)?.cached_tokens ?? 0;
  if (typeof input !== "number" || typeof output !== "number" || !Number.isFinite(input) || !Number.isFinite(output)) return null;
  if (input < 0 || output < 0) return null;
  const cacheRead = typeof cached === "number" && Number.isFinite(cached) && cached > 0 ? cached : 0;
  return { input, cached: Math.min(cacheRead, input), output };
}

/** Codex 0.153.4 app-server schema: total is cumulative; cached input is a subset of input. */
export function codexUsageUpdate(notification: CodexNotification): AgentUsageUpdate | null {
  const { method, params } = notification;
  try {
    if (method === "thread/tokenUsage/updated") {
      const thread = params.threadId;
      const usage = params.tokenUsage as { total?: Record<string, unknown> } | undefined;
      const stream = usageStreamId(thread);
      if (!stream || !usage?.total) return null;
      return validateUsageUpdate({ kind: "tokens", stream, totals: {
        input: usage.total.inputTokens, cached: usage.total.cachedInputTokens, output: usage.total.outputTokens,
      } });
    }
    if (method === "account/rateLimits/updated") {
      const limits = params.rateLimits as Record<string, any> | undefined;
      if (!limits) return null;
      const bucket = usageStreamId(String(limits.limitId ?? "default"));
      if (!bucket) return null;
      const update: Record<string, unknown> = { kind: "quota", bucket };
      for (const key of ["primary", "secondary"]) {
        const window = limits[key];
        if (window?.windowDurationMins != null) update[key] = {
          usedPercent: window.usedPercent, windowMinutes: window.windowDurationMins,
          resetsAt: window.resetsAt == null ? null : window.resetsAt * 1000,
        };
      }
      return validateUsageUpdate(update);
    }
    if (method === "turn/completed" || method === "item/completed") {
      const item = params.item as { id?: unknown; usage?: unknown } | undefined;
      const raw = params.usage ?? (params.turn as { usage?: unknown } | undefined)?.usage ?? item?.usage;
      const totals = usageTotals(raw);
      const stream = usageStreamId(
        typeof params.turnId === "string" ? params.turnId : notification.turnId,
        typeof (params.turn as { id?: string } | undefined)?.id === "string" ? (params.turn as { id: string }).id : undefined,
        typeof params.threadId === "string" ? params.threadId : notification.threadId,
        item?.id,
      );
      if (!totals || !stream) return null;
      return validateUsageUpdate({ kind: "tokens", stream, totals });
    }
  } catch { /* Unsupported or malformed telemetry stays unknown. */ }
  return null;
}

/** Process a single app-server notification and update slot state. */
async function handleCodexNotification(
  notification: CodexNotification,
  slotId: number,
  sessionId: string,
  brokerClient: BrokerClient,
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const { method, params } = notification;

  // --- Turn lifecycle ---

  if (method === "turn/started") {
    await autoTransitionToWorking(slotId, brokerClient);
    onEvent({
      type: "agent_progress",
      severity: "info",
      slotId,
      sessionId,
      message: `Codex turn started in slot ${slotId}`,
    });
    return;
  }

  if (method === "turn/completed") {
    // Completion usage is not added: thread/tokenUsage/updated is the canonical
    // cumulative stream. Combining both would double count the same requests.
    const turn = params.turn as Record<string, unknown> | undefined;
    const usage = (params.usage ?? turn?.usage) as Record<string, number> | undefined;

    onEvent({
      type: "agent_output",
      severity: "info",
      slotId,
      sessionId,
      message: `Codex turn completed in slot ${slotId}`,
      data: usage ? { usage } : undefined,
    });
    return;
  }

  // --- Item lifecycle ---

  if (method === "item/completed") {
    await autoTransitionToWorking(slotId, brokerClient);
    const item = params.item as Record<string, unknown> | undefined;
    if (!item) return;

    const itemType = item.type as string | undefined;

    if (itemType === "agentMessage" && item.text) {
      try {
        await brokerClient.updateSlot({
          id: slotId,
          context_snapshot: JSON.stringify({
            last_summary: String(item.text).slice(0, 200),
            last_status: "working",
            updated_at: Date.now(),
          }),
        });
      } catch { /* best-effort */ }
    }

    if (itemType === "commandExecution") {
      try {
        await brokerClient.updateSlot({
          id: slotId,
          context_snapshot: JSON.stringify({
            last_summary: `Running: ${String(item.command ?? "shell command").slice(0, 100)}`,
            last_status: "working",
            updated_at: Date.now(),
          }),
        });
      } catch { /* best-effort */ }
    }

    if (itemType === "mcpToolCall") {
      try {
        await brokerClient.updateSlot({
          id: slotId,
          context_snapshot: JSON.stringify({
            last_summary: `MCP: ${String(item.serverLabel ?? "")}/${String(item.toolName ?? "unknown")}`.slice(0, 100),
            last_status: "working",
            updated_at: Date.now(),
          }),
        });
      } catch { /* best-effort */ }
    }

    if (itemType === "fileChange") {
      try {
        await brokerClient.updateSlot({
          id: slotId,
          context_snapshot: JSON.stringify({
            last_summary: `File: ${String(item.filePath ?? "unknown file").slice(0, 100)}`,
            last_status: "working",
            updated_at: Date.now(),
          }),
        });
      } catch { /* best-effort */ }
    }

    onEvent({
      type: "agent_progress",
      severity: "info",
      slotId,
      sessionId,
      message: `Codex ${itemType ?? "activity"} in slot ${slotId}`,
    });
    return;
  }

  // --- Streaming deltas → activity heartbeat ---

  if (method === "item/agentMessage/delta" ||
      method === "item/commandExecution/outputDelta" ||
      method === "item/fileChange/outputDelta") {
    // Don't flood slot updates with every delta, but auto-transition
    await autoTransitionToWorking(slotId, brokerClient);
    return;
  }

  // --- Item started → activity signal ---

  if (method === "item/started") {
    await autoTransitionToWorking(slotId, brokerClient);
    return;
  }
}
