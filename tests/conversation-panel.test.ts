import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
const require = createRequire(import.meta.url);
const { createConversationPanel, validMessage } = require("../extensions/multiagents-chat/panel.cjs");
const { decodeObservation } = require("../extensions/multiagents-chat/core.cjs");

test("dashboard inline scripts and panel renderer parse without executing the page", async () => {
  const html = await Bun.file(new URL("../dashboard/index.html", import.meta.url)).text();
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) expect(() => new Function(match[1]!)).not.toThrow();
  const panel = await Bun.file(new URL("../extensions/multiagents-chat/panel.js", import.meta.url)).text();
  expect(() => new Function(panel)).not.toThrow();
});

test("dashboard header does not present recorded approvals as verified completion", async () => {
  const html = await Bun.file(new URL("../dashboard/index.html", import.meta.url)).text();
  const code = html.slice(html.indexOf("    function renderHeader()"), html.indexOf("    function renderBadges()"));
  const elements: Record<string, any> = {};
  runInNewContext(`${code}; renderHeader();`, { state: { brokerAlive: true, session: { id: "s", status: "active" }, slots: [{status: "disconnected"}] },
    isSessionComplete: () => true, document: { getElementById: (id: string) => elements[id] ||= { style: {}, textContent: "" } } });
  expect(elements["session-status-badge"].textContent).toContain("chưa xác minh bàn giao");
  expect(elements["uptime"].textContent).toBe("");
});

test("panel validates exact messages, never accepts controls or external URLs", () => {
  for (const value of [null, [], { type: "control" }, { type: "chat", command: "evil" }, { type: "select", key: 1 }, { type: "select", key: "x".repeat(401) }]) expect(validMessage(value)).toBe(false);
  expect(validMessage({ type: "ready" })).toBe(true);
  expect(validMessage({ type: "select", key: "known" })).toBe(true);
});

test("host keeps scoped bounded snapshots, CSP and trust guard without tool or network APIs", () => {
  let command: () => void, receive: (data: any) => void;
  const posted: any[] = [];
  const webview = { html: "", cspSource: "vscode-webview:", asWebviewUri: (value: string) => value,
    postMessage: (data: any) => posted.push(data), onDidReceiveMessage: (callback: any) => { receive = callback; return { dispose() {} }; } };
  const vscode = { workspace: { isTrusted: true }, commands: { registerCommand: (_: string, callback: any) => { command = callback; return { dispose() {} }; } },
    ViewColumn: { Beside: 2 }, Uri: { joinPath: (root: string, name: string) => `${root}/${name}` }, window: {
      createWebviewPanel: () => ({ webview, onDidDispose() {}, dispose() {}, reveal() {} }), showInformationMessage() {},
    } };
  const host = createConversationPanel(vscode, { extensionUri: "extension", subscriptions: [] });
  command!(); receive!({ type: "ready" });
  expect(posted.at(-1).entry).toBeUndefined();
  expect(webview.html).toContain("default-src 'none'"); expect(webview.html).toContain("connect-src 'none'");
  expect(webview.html).not.toContain("unsafe-inline");
  for (let i = 0; i < 15; i++) host.publish("owner", { session: { id: `s${i}`, status: "active" }, agents: [], messages: [], plan: null });
  expect(posted.at(-1).sessions).toHaveLength(12);
  const selected = posted.at(-1).selected;
  receive!({ type: "select", key: "unknown" }); expect(posted.at(-1).selected).toBe(selected);
  vscode.workspace.isTrusted = false; receive!({ type: "ready" });
  expect(posted.at(-1).sessions).toHaveLength(0); expect(posted.at(-1).entry).toBeUndefined();
});

test("observation strips private fields, bounds history and preserves token unknown/zero", () => {
  const data = { session: { id: "ui", status: "active", config: "PRIVATE" }, agents: [{ id: 1, name: "Worker", task: "working", connection: "connected", paused: false,
    prompt: "PRIVATE", usage: { observedAt: 100, input: 0, cached: 0, output: 0 } }], messages: Array.from({ length: 60 }, (_, id) => ({ id, from: "Worker", to: "Operator", time: "now", type: "chat", text: "<script>not executable</script>" })), plan: null };
  const snapshot = decodeObservation(JSON.stringify(data), "ui");
  expect(snapshot.messages).toHaveLength(50); expect(JSON.stringify(snapshot)).not.toContain("PRIVATE");
  expect(snapshot.agents[0].usage.input).toBe(0);
  expect(decodeObservation(JSON.stringify({ ...data, messages: [...data.messages].reverse() }), "ui").messages.map((m: any) => m.id)).toEqual(snapshot.messages.map((m: any) => m.id));
  expect(() => decodeObservation(JSON.stringify(data), "wrong")).toThrow();
  data.agents[0]!.usage.input = -1;
  expect(decodeObservation(JSON.stringify(data), "ui").agents[0].usage.input).toBeNull();
});
