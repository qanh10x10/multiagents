import type { Subprocess } from "bun";
import { log } from "../shared/utils.ts";
import type {
  BaseAgentDriver,
  DriverNotification,
  DriverNotificationListener,
  DriverSessionOptions,
  DriverTurnResult,
  DriverUsage,
} from "../shared/agent-driver.ts";

export class UnsupportedDriverOperationError extends Error {
  constructor(operation: string) {
    super(`Claude driver does not support ${operation}`);
    this.name = "UnsupportedDriverOperationError";
  }
}

export interface ClaudeRuntimeConfig {
  command?: string;
  args?: string[];
  steerMethod?: string;
  interruptMethod?: string;
  resumeMethod?: string;
  capabilities?: { steer?: boolean; interrupt?: boolean; resume?: boolean };
}

type Proc = Subprocess<"pipe", "pipe", "pipe">;

function usageOf(value: any): DriverUsage | undefined {
  const u = value?.usage ?? value;
  if (!u || typeof u !== "object") return undefined;
  const usage: DriverUsage = {
    input_tokens: u.input_tokens ?? u.inputTokens,
    output_tokens: u.output_tokens ?? u.outputTokens,
    cached_input_tokens: u.cached_input_tokens ?? u.cachedInputTokens,
  };
  return Object.values(usage).some((n) => typeof n === "number") ? usage : undefined;
}

export class ClaudeDriver implements BaseAgentDriver {
  readonly kind = "claude" as const;
  private readonly proc: Proc;
  private readonly runtime: ClaudeRuntimeConfig;
  private aliveState = true;
  private thread: string | null = null;
  private active: string | null = null;
  private last = Date.now();
  private lastNotification = Date.now();
  private buffer = "";
  private listeners: DriverNotificationListener[] = [];
  private pending: { resolve: (r: DriverTurnResult) => void; reject: (e: Error) => void; content: string[]; timer: ReturnType<typeof setTimeout> } | null = null;
  private readonly turnTimeoutMs: number;

  private constructor(proc: Proc, runtime: ClaudeRuntimeConfig, timeoutMs: number) {
    this.proc = proc;
    this.runtime = runtime;
    this.turnTimeoutMs = timeoutMs;
    this.startReader();
    proc.exited.then((code) => {
      this.aliveState = false;
      this.active = null;
      this.pending?.reject(new Error(`claude process exited (code ${code})`));
      this.pending = null;
    });
  }

  static async spawn(
    cwd: string,
    env: Record<string, string | undefined> = process.env,
    timeoutMs = 30_000,
    runtime: ClaudeRuntimeConfig = {},
  ): Promise<ClaudeDriver> {
    const command = runtime.command ?? "claude";
    const args = runtime.args ?? [
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
    ];
    const proc = Bun.spawn([command, ...args], {
      cwd,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    }) as Proc;
    const driver = new ClaudeDriver(proc, runtime, timeoutMs);
    void driver.readStderr();
    return driver;
  }

  get threadId() { return this.thread; }
  get activeTurnId() { return this.active; }
  get alive() { return this.aliveState; }
  get pid() { return this.proc.pid; }
  get process() { return this.proc; }
  get lastActivity() { return this.last; }
  get lastNotificationActivity() { return this.lastNotification; }

  onNotification(cb: DriverNotificationListener) { this.listeners.push(cb); }
  onExit(cb: () => void) { this.proc.exited.then(() => { try { cb(); } catch {} }); }

  async startSession(opts: DriverSessionOptions): Promise<DriverTurnResult> {
    return this.sendPrompt(opts.prompt, opts);
  }

  async reply(threadId: string, prompt: string): Promise<DriverTurnResult> {
    if (this.thread && threadId !== this.thread) throw new Error("Claude thread mismatch");
    return this.sendPrompt(prompt, { prompt });
  }

  async resumeThread(threadId: string): Promise<void> {
    if (!this.runtime.capabilities?.resume || !this.runtime.resumeMethod)
      throw new UnsupportedDriverOperationError("resumeThread");
    await this.rpc(this.runtime.resumeMethod, { session_id: threadId });
    this.thread = threadId;
  }

  async steer(threadId: string, text: string): Promise<void> {
    if (!this.runtime.capabilities?.steer || !this.runtime.steerMethod)
      throw new UnsupportedDriverOperationError("steer");
    if (!this.active) throw new Error("Cannot steer: no active turn");
    if (this.thread && threadId !== this.thread) throw new Error("Claude thread mismatch");
    await this.rpc(this.runtime.steerMethod, { session_id: threadId, text });
  }

  async interrupt(threadId: string): Promise<void> {
    if (!this.runtime.capabilities?.interrupt || !this.runtime.interruptMethod)
      throw new UnsupportedDriverOperationError("interrupt");
    if (this.thread && threadId !== this.thread) throw new Error("Claude thread mismatch");
    await this.rpc(this.runtime.interruptMethod, { session_id: threadId });
  }

  async kill(): Promise<void> {
    if (!this.aliveState) return;
    this.aliveState = false;
    try { this.proc.kill(); } catch {}
  }

  private async sendPrompt(prompt: string, opts: DriverSessionOptions): Promise<DriverTurnResult> {
    if (!this.aliveState) throw new Error("claude process is not alive");
    if (this.pending) throw new Error("Claude turn already active");
    const instructions = [opts.baseInstructions, opts.developerInstructions].filter(Boolean).join("\n\n");
    const effectivePrompt = instructions ? `${instructions}\n\n${prompt}` : prompt;
    const frame = {
      type: "user",
      message: { role: "user", content: [{ type: "text", text: effectivePrompt }] },
      ...(this.thread ? { session_id: this.thread } : {}),
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        this.active = null;
        reject(new Error(`Claude turn timed out after ${this.turnTimeoutMs}ms`));
      }, this.turnTimeoutMs);
      this.pending = { resolve, reject, content: [], timer };
      try {
        this.proc.stdin.write(JSON.stringify(frame) + "\n");
        this.proc.stdin.flush();
      } catch (error) {
        clearTimeout(timer);
        this.pending = null;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async rpc(method: string, params: Record<string, unknown>): Promise<void> {
    this.proc.stdin.write(JSON.stringify({ type: "control", method, params }) + "\n");
    this.proc.stdin.flush();
  }

  private async startReader() {
    const reader = this.proc.stdout.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) this.handleLine(line.trim());
      }
    } catch (error) {
      this.pending?.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleLine(line: string) {
    this.last = this.lastNotification = Date.now();
    let msg: any;
    try { msg = JSON.parse(line); }
    catch {
      this.emit({ method: "protocol/error", params: { error: "Malformed JSONL frame" } });
      this.pending?.reject(new Error("Malformed Claude JSONL frame"));
      this.pending = null;
      this.active = null;
      return;
    }
    const threadId = msg.session_id ?? msg.sessionId ?? msg.thread_id;
    const turnId = msg.turn_id ?? msg.turnId;
    if (typeof threadId === "string") this.thread = threadId;
    if (typeof turnId === "string") this.active = turnId;
    const method = msg.type === "assistant" ? "item/agentMessage/delta" : msg.type === "result" ? "turn/completed" : `claude/${msg.type ?? "event"}`;
    this.emit({ method, threadId: this.thread ?? undefined, turnId: this.active ?? undefined, params: msg });
    if (msg.type === "assistant") {
      const text = typeof msg.delta === "string" ? msg.delta : typeof msg.message?.content === "string" ? msg.message.content : "";
      if (text) this.pending?.content.push(text);
    }
    if (msg.type === "result") {
      const pending = this.pending;
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending = null;
      this.active = null;
      if (msg.is_error || msg.subtype === "error") {
        pending.reject(new Error("Claude turn failed; check provider configuration and availability."));
        return;
      }
      const content = typeof msg.result === "string" ? msg.result : pending.content.join("");
      pending.resolve({ threadId: this.thread ?? "", content, usage: usageOf(msg.usage ?? msg) });
    }
  }

  private emit(notification: DriverNotification) {
    for (const listener of this.listeners) try { listener(notification); } catch {}
  }

  private async readStderr() {
    const reader = this.proc.stderr.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      if (/error|fatal|panic/i.test(text)) log("claude-driver", text.trim().slice(0, 200));
    }
  }
}
