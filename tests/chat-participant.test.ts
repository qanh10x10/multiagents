import { expect, mock, test } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

let handler: any;
let confirmed = false;
let restartConfirmed = false;
let current: any;
let cancellations: Array<() => void> = [];
const calls: Array<{ name: string; input: any }> = [];
const toolContexts: any[] = [];
class TextPart { constructor(public value: string) {} }
class ToolCall { constructor(public callId: string, public name: string, public input: any) {} }
class ToolResult { constructor(public callId: string, public content: any) {} }
class MarkdownString {
  value = ""; isTrusted = false; supportHtml = false;
  appendText(text: string) { this.value += text.replace(/ /g, "&nbsp;"); }
}
const vscode = {
  workspace: { isTrusted: true },
  chat: { createChatParticipant: (_id: string, callback: any) => { handler = callback; return { dispose() {} }; } },
  ThemeIcon: class {},
  LanguageModelTextPart: TextPart,
  LanguageModelToolCallPart: ToolCall,
  LanguageModelToolResultPart: ToolResult,
  LanguageModelChatMessage: { User: (content: any) => ({ role: "user", content }), Assistant: (content: any) => ({ role: "assistant", content }) },
  MarkdownString,
  CancellationTokenSource: class {
    token = { isCancellationRequested: false, onCancellationRequested: (callback: () => void) => {
      cancellations.push(callback); return { dispose() {} };
    } };
    cancel() { this.token.isCancellationRequested = true; cancellations.forEach(callback => callback()); }
    dispose() {}
  },
  window: {
    showQuickPick: async (items: any[]) => items[0],
    showWarningMessage: async (..._args: any[]): Promise<string | undefined> => confirmed ? "Xác nhận" : undefined,
    showInputBox: async () => "team",
  },
  lm: {
    tools: ["get_chat_observation", "control_session", "direct_agent", "remove_agent", "list_sessions", "resume_session"].map(name => ({
      name: "mcp_owner_" + name, description: name,
      inputSchema: { properties: { action: { enum: ["interrupt_agent"] } } },
    })),
    invokeTool: async (name: string, options: any) => {
      toolContexts.push(options.toolInvocationToken);
      calls.push({ name, input: options.input });
      return { content: [new TextPart(name.endsWith("get_chat_observation") ? JSON.stringify(current)
        : name.endsWith("list_sessions") ? "=== Multiagents Sessions ===\n\n  team\n    Name: Team | Status: archived\n"
        : "Request accepted")] };
    },
  },
};
mock.module("vscode", () => vscode);
const { activate } = require("../extensions/multiagents-chat/extension.cjs");

test("participant requires confirmation, targets owning MCP, and never interprets watch cancellation as stop", async () => {
  const subscriptions: any[] = [];
  activate({ subscriptions });
  const output: any[] = [];
  const stream = { markdown: (part: any) => output.push(part) };
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  current = { session: { id: "team", status: "active" }, agents: [{ id: 7, name: "Worker", connection: "connected", task: "working", paused: false }], messages: [], plan: null };
  const request = (command: string, prompt = "team | Worker") => handler({ command, prompt, toolInvocationToken: {} }, {}, stream, token);

  calls.length = 0; confirmed = false;
  await request("stop");
  expect(calls.some(call => call.name.endsWith("remove_agent"))).toBe(false);

  confirmed = true;
  await request("interrupt");
  expect(calls.at(-1)).toEqual({ name: "mcp_owner_control_session", input: { session_id: "team", target: "7", action: "interrupt_agent" } });

  await request("direct", "team | Worker | preserve compatibility");
  expect(calls.at(-1)!.name).toBe("mcp_owner_direct_agent");
  expect(calls.at(-1)!.input.message).toContain("preserve compatibility");

  calls.length = 0;
  token.isCancellationRequested = true;
  await request("watch", "team");
  expect(calls).toHaveLength(0);
  token.isCancellationRequested = false;
  current.agents[0].connection = "disconnected";
  await request("watch", "team");
  expect(calls.every(call => call.name.endsWith("get_chat_observation"))).toBe(true);

  current.agents[0].connection = "connected";
  calls.length = 0;
  vscode.window.showWarningMessage = async () => { current.agents[0].task = "approved"; return "Xác nhận"; };
  await request("stop");
  expect(calls.some(call => call.name.endsWith("remove_agent"))).toBe(false);

  expect(output.filter(part => part instanceof MarkdownString).every(part => !part.isTrusted && !part.supportHtml)).toBe(true);
  subscriptions.forEach(item => item.dispose());
  cancellations = [];
});

test("guided commands reuse only same-chat same-server context and confirm offline restart", async () => {
  activate({ subscriptions: [] });
  calls.length = 0;
  confirmed = false;
  const output: any[] = [];
  const stream = { markdown: (part: any) => output.push(part) };
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  current = { session: { id: "team", status: "archived" }, agents: [
    { id: 7, name: "Worker", connection: "disconnected", task: "approved", paused: false },
    { id: 8, name: "Other", connection: "disconnected", task: "working", paused: false },
  ], messages: [], plan: null };
  vscode.window.showWarningMessage = async () => restartConfirmed ? "Khởi động lại worker" : undefined;
  const status = await handler({ command: "status", prompt: "team" }, {}, stream, token);
  expect(status.metadata.session).toBe("team");
  const history = { history: [{ participant: "multiagents.chat", result: status }] };
  await handler({ command: "resume", prompt: "" }, history, stream, token);
  expect(calls.some(call => call.name.endsWith("resume_session"))).toBe(false);
  restartConfirmed = true;
  await handler({ command: "resume", prompt: "xu ly tiep tuc task" }, history, stream, token);
  expect(calls.at(-1)).toEqual({ name: "mcp_owner_resume_session", input: { session_id: "team", agents_to_skip: ["Other"] } });
  calls.length = 0; restartConfirmed = false;
  await handler({ prompt: "continue work" }, history, stream, token);
  expect(calls.some(call => call.name.endsWith("resume_session"))).toBe(false);

  calls.length = 0;
  await handler({ command: "status", prompt: "" }, {}, stream, token);
  expect(calls.map(call => call.name)).toEqual(["mcp_owner_list_sessions", "mcp_owner_get_chat_observation"]);

  calls.length = 0;
  const pick = vscode.window.showQuickPick;
  vscode.window.showQuickPick = async () => undefined;
  await handler({ command: "resume", prompt: "" }, history, stream, token);
  expect(calls.every(call => call.name.endsWith("get_chat_observation"))).toBe(true);
  calls.length = 0;
  await handler({ command: "status", prompt: "" }, {}, stream, token);
  expect(calls.map(call => call.name)).toEqual(["mcp_owner_list_sessions"]);
  vscode.window.showQuickPick = pick;

  current.agents[0].connection = "connected";
  current.agents[0].task = "working";
  current.session.status = "active";
  vscode.window.showInputBox = async () => "preserve public API";
  vscode.window.showWarningMessage = async () => "Xác nhận";
  await handler({ command: "direct", prompt: "" }, history, stream, token);
  expect(calls.at(-1)!.input.message).toContain("preserve public API");

  calls.length = 0;
  await handler({ command: "stop", prompt: "team | Worker | unexpected" }, history, stream, token);
  expect(calls.some(call => call.name.endsWith("remove_agent"))).toBe(false);
});

test("session selection and deterministic resume-all require confirmation with current roster", async () => {
  activate({ subscriptions: [] });
  const output: any[] = [];
  const stream = { markdown: (part: any) => output.push(part) };
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  const picks: string[] = [];
  vscode.window.showQuickPick = async (items: any[]) => { picks.push(items[0].label); return items[0]; };
  current = { session: { id: "team", status: "active" }, agents: [
    { id: 1, name: "Manager", connection: "connected", task: "working", paused: false },
    { id: 2, name: "Offline", connection: "disconnected", task: "working", paused: false },
    { id: 3, name: "Paused", connection: "connected", task: "working", paused: true },
    { id: 4, name: "Released", connection: "disconnected", task: "released", paused: false },
  ], messages: [], plan: null };
  calls.length = 0;
  const selected = await handler({ command: "session", prompt: "" }, {}, stream, token);
  expect(selected.metadata.session).toBe("team");
  expect(picks).toEqual(["mcp_owner_get_chat_observation", "team"]);
  expect(calls.map(c => c.name)).toEqual(["mcp_owner_list_sessions", "mcp_owner_get_chat_observation"]);
  const history = { history: [{ participant: "multiagents.chat", result: selected }] };
  const request = (prompt: string) => handler({ command: prompt === "xem tien do" ? "status" : prompt === "doi session" ? "session" : prompt === "tiep tuc xu ly task dang ton dong" ? "direct" : "resume", prompt: prompt === "xem tien do" || prompt === "doi session" ? "" : prompt === "tiep tuc xu ly task dang ton dong" ? "team | Manager | tiep tuc xu ly task dang ton dong" : "team | @all" }, history, stream, token);
  picks.length = 0; calls.length = 0;
  await request("xem tien do");
  expect(picks).toEqual([]);
  expect(calls.map(c => c.name)).toEqual(["mcp_owner_get_chat_observation"]);

  let confirmations = 0;
  vscode.window.showWarningMessage = async () => { confirmations++; return undefined; };
  calls.length = 0;
  await request("bat lai all worker");
  expect(calls.every(c => c.name.endsWith("get_chat_observation"))).toBe(true);
  expect(confirmations).toBe(1);
  confirmations = 0;
  vscode.window.showWarningMessage = async () => { confirmations++; return "Tiếp tục cả nhóm"; };
  calls.length = 0;
  await request("bat lai tat ca worker");
  expect(confirmations).toBe(1);
  expect(picks).toEqual([]);
  expect(calls.filter(c => !c.name.endsWith("get_chat_observation"))).toEqual([
    { name: "mcp_owner_resume_session", input: { session_id: "team", agents_to_skip: [] } },
    { name: "mcp_owner_control_session", input: { session_id: "team", target: "3", action: "resume_agent" } },
  ]);

  calls.length = 0;
  vscode.window.showWarningMessage = async () => { current.agents[1].connection = "connected"; return "Tiếp tục cả nhóm"; };
  await request("bat lai all worker");
  expect(calls.every(c => c.name.endsWith("get_chat_observation"))).toBe(true);
  current.agents[2].paused = false;
  calls.length = 0; confirmations = 0;
  vscode.window.showWarningMessage = async () => { confirmations++; return "Tiếp tục cả nhóm"; };
  await request("bat lai all worker");
  expect(confirmations).toBe(0);
  expect(calls.every(c => c.name.endsWith("get_chat_observation"))).toBe(true);

  calls.length = 0;
  vscode.window.showWarningMessage = async () => "Xác nhận";
  await request("tiep tuc xu ly task dang ton dong");
  expect(calls.at(-1)).toMatchObject({ name: "mcp_owner_direct_agent", input: { target: "1" } });
  expect(calls.at(-1)!.input.message).toContain("tiep tuc xu ly task dang ton dong");
  expect(calls.some(c => c.name.endsWith("resume_session"))).toBe(false);

  calls.length = 0;
  vscode.window.showQuickPick = async () => undefined;
  await handler({ prompt: "khong bat lai all worker" }, history, stream, token);
  expect(calls.every(c => c.name.endsWith("get_chat_observation"))).toBe(true);
  calls.length = 0;
  await request("doi session");
  expect(calls.map(c => c.name)).toEqual(["mcp_owner_list_sessions"]);
  expect(output.filter(p => p instanceof MarkdownString).every(p => !p.value.includes("&nbsp;") && !p.isTrusted && !p.supportHtml)).toBe(true);
  vscode.window.showQuickPick = async (items: any[]) => items[0];
});

test("selected-model coordinator reuses exact native confirmation and invocation context", async () => {
  const run = async (confirm: boolean, stale = false) => {
    activate({ subscriptions: [] }); calls.length = 0; toolContexts.length = 0;
    current = { session: { id: "team", status: "active" }, agents: [{ id: 1, name: "Worker", connection: "disconnected", task: "working", paused: false }], messages: [], plan: null };
    vscode.window.showQuickPick = async (items: any[]) => items[0];
    let confirmations = 0;
    vscode.window.showWarningMessage = async (warning: any) => {
      confirmations++; expect(warning).toContain("Worker [1]");
      if (stale) current.session.status = "archived";
      return confirm ? "Tiếp tục cả nhóm" : undefined;
    };
    const steps = [
      [new ToolCall("1", "observe", { session: "team" })],
      [new ToolCall("2", "control", { session: "team", action: "resume", target: "@all", authorization: "bật lại tất cả woker" })],
      [new TextPart("Chỉ báo yêu cầu đã gửi, chưa xác minh kết quả.")],
    ];
    const model = { id: "selected", name: "Selected", maxInputTokens: 32000, countTokens: async () => 10,
      sendRequest: async () => ({ stream: (async function* () { for (const part of steps.shift() || []) yield part; })() }) };
    const context = { request: "actual-chat" };
    const output: any[] = [];
    await handler({ prompt: "bật lại tất cả woker", model, toolInvocationToken: context }, {}, { markdown: (part: any) => output.push(part) },
      { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) });
    expect(confirmations).toBe(1); expect(toolContexts.every(item => item === context)).toBe(true);
    expect(calls.every(call => call.name.startsWith("mcp_owner_"))).toBe(true);
    return calls.filter(call => call.name.endsWith("resume_session"));
  };
  expect(await run(false)).toHaveLength(0);
  expect(await run(true)).toHaveLength(1);
  expect(await run(true, true)).toHaveLength(0);
});
