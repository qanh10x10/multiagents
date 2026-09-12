/** Shared contract implemented by persistent agent runtimes. */
export type AgentDriverKind = "codex" | "claude" | "gemini";

export interface DriverUsage {
  input_tokens?: number;
  output_tokens?: number;
  cached_input_tokens?: number;
}

export interface DriverNotification {
  method: string;
  threadId?: string;
  turnId?: string;
  params: Record<string, unknown>;
}

export interface DriverTurnResult {
  threadId: string;
  content: string;
  usage?: DriverUsage;
}

export interface DriverSessionOptions {
  prompt: string;
  cwd?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  baseInstructions?: string;
  developerInstructions?: string;
  model?: string;
}

export type DriverNotificationListener = (notification: DriverNotification) => void;

export interface BaseAgentDriver {
  readonly kind: AgentDriverKind;
  readonly threadId: string | null;
  readonly activeTurnId: string | null;
  readonly alive: boolean;
  readonly pid: number;
  readonly lastActivity: number;
  readonly lastNotificationActivity: number;

  startSession(opts: DriverSessionOptions): Promise<DriverTurnResult>;
  resumeThread(threadId: string): Promise<void>;
  reply(threadId: string, prompt: string): Promise<DriverTurnResult>;
  steer(threadId: string, text: string): Promise<void>;
  interrupt(threadId: string): Promise<void>;
  onNotification(cb: DriverNotificationListener): void;
  onExit(cb: () => void): void;
  kill(): Promise<void>;
}
