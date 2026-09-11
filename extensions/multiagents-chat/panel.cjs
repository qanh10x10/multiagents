"use strict";
const { randomBytes } = require("node:crypto");
const { safeText, decodeObservation } = require("./core.cjs");

function validMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return false;
  const keys = Object.keys(message);
  return (keys.length === 1 && ["ready", "chat"].includes(message.type)) ||
    (keys.length === 2 && message.type === "select" && typeof message.key === "string" && message.key.length <= 400);
}

function createConversationPanel(vscode, context) {
  let panel;
  let selected;
  let error = "";
  const snapshots = new Map();
  const send = () => {
    if (!panel) return;
    const trusted = vscode.workspace.isTrusted;
    panel.webview.postMessage({ type: "state", sessions: trusted ? [...snapshots].map(([key, entry]) => ({ key, label: `${entry.snapshot.session.id} · ${entry.owner}` })) : [],
      selected: trusted ? selected : undefined, entry: trusted ? snapshots.get(selected) : undefined,
      error: trusted ? error : "Workspace chưa được tin cậy. Không hiển thị dữ liệu phiên." });
  };
  const open = () => {
    if (panel) { panel.reveal(); send(); return; }
    panel = vscode.window.createWebviewPanel("multiagents.conversation", "Multiagents · Hội thoại", vscode.ViewColumn.Beside,
      { enableScripts: true, localResourceRoots: [context.extensionUri] });
    const nonce = randomBytes(18).toString("hex");
    const resource = name => panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, name));
    panel.webview.html = `<!doctype html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'">
      <link rel="stylesheet" href="${resource("panel.css")}"><title>Hội thoại Multiagents</title></head><body>
      <header><h1>Phòng hội thoại</h1><p>Báo cáo thật từ worker AI và người điều hành. Tổng hợp của điều phối AI nằm riêng trong Chat.</p>
      <label for="session">Phiên đã quan sát</label><select id="session"></select><button id="chat" type="button">Hướng dẫn mở Chat</button>
      <p id="status" role="status"></p><p>Chỉ đọc bản quan sát từ @multiagents /status hoặc /watch. Để chọn phiên mới và xác nhận điều khiển, dùng @multiagents trong Chat.</p></header>
      <main><section aria-labelledby="conversation-title"><h2 id="conversation-title">Hội thoại</h2><div id="timeline" role="region" tabindex="0" aria-label="Lịch sử hội thoại"></div>
      <button id="latest" type="button" hidden>Đến tin mới nhất</button><details><summary>Sự kiện hệ thống</summary><div id="events"></div></details></section>
      <aside aria-label="Worker và nhiệm vụ"><h2>Nhóm đang làm gì</h2><div id="agents"></div><h2>Kế hoạch đã ghi</h2><div id="plan"></div></aside></main>
      <script nonce="${nonce}" src="${resource("panel.js")}"></script></body></html>`;
    const receiver = panel.webview.onDidReceiveMessage(message => {
      if (!validMessage(message)) return;
      if (message.type === "chat") {
        vscode.window.showInformationMessage("Mở Chat, nhập @multiagents để trao đổi với điều phối AI hoặc /status, /watch để đọc dữ liệu. Mọi điều khiển đều cần xác nhận tại Chat.");
      } else if (message.type === "select") {
        if (!vscode.workspace.isTrusted || !snapshots.has(message.key)) return;
        selected = message.key; error = ""; send();
      } else send();
    });
    panel.onDidDispose(() => { receiver.dispose(); panel = undefined; });
  };
  if (vscode.commands?.registerCommand) context.subscriptions.push(vscode.commands.registerCommand("multiagents.openConversation", open));
  context.subscriptions.push({ dispose() { panel?.dispose(); snapshots.clear(); } });
  return {
    publish(owner, value) {
      if (!vscode.workspace.isTrusted) return;
      const snapshot = decodeObservation(JSON.stringify(value), value.session.id);
      const key = JSON.stringify([owner, snapshot.session.id]);
      snapshots.set(key, { owner, snapshot, observedAt: Date.now() });
      if (!selected) selected = key;
      // In-memory cache only; cap both history and number of visited sessions.
      while (snapshots.size > 12) {
        const oldest = [...snapshots.keys()].find(candidate => candidate !== selected);
        snapshots.delete(oldest);
      }
      error = ""; send();
    },
    error(message) { error = safeText(message); send(); },
  };
}

module.exports = { createConversationPanel, validMessage };
