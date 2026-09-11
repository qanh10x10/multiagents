// Manual browser fixture. No broker, credentials, worker, or provider connections.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let current = "fixture-ui";
let nextId = 45;
let offline = false;
const clients = new Set<any>();
const sessions = [{ id: "fixture-ui", name: "[Fixture] Nhóm giao diện", status: "active" }, { id: "fixture-empty", name: "[Fixture] Phiên trống", status: "archived" }];
const slots = [{ id: 1, display_name: "[Fixture] Kỹ sư AI", status: "connected", task_state: "working", paused: false, role: "Engineer", agent_type: "codex", input_tokens: 1000, output_tokens: 100, cache_read_tokens: 200,
  agent_usage: JSON.stringify({ tokensObservedAt: Date.now(), quotas: { account: { primary: { windowMinutes: 300, usedPercent: 20, observedAt: Date.now(), resetsAt: Date.now()+3600000 }, secondary: { windowMinutes: 10080, usedPercent: 50, observedAt: Date.now() } } } }) },
  { id: 2, display_name: "[Fixture] Worker ngoại tuyến", status: "disconnected", task_state: "done_pending_review", paused: false, agent_type: "codex" }];
const messages = Array.from({ length: 45 }, (_, id) => ({ id, session_id: "fixture-ui", from_slot_id: id%2 ? 1 : null, from_id: id%2 ? "peer-ai" : "operator-fixture", to_slot_id: id%2 ? null : 1, to_id: id%2 ? "operator-fixture" : "peer-ai", sent_at: new Date(Date.UTC(2026,8,9,1,id)).toISOString(), msg_type: id===2 ? "system" : "chat",
  text: id===3 ? '<img src=x onerror="window.fixtureXss=true"> [Fixture] Nội dung phải hiển thị như văn bản.' : `[Fixture ${id}] Báo cáo kiểm thử giao diện, không phải hội thoại thật. ` + (id===4 ? "Chi tiết để kiểm tra mở rộng. ".repeat(70) : "Đang kiểm tra vị trí đọc và bàn phím.") }));
function state() { return { sessionId: current, session: sessions.find(s=>s.id===current), slots: current==="fixture-ui" ? slots : [], peers: [], messages: current==="fixture-ui" ? messages : [], plan: { completion: 50, items: [{ id: 1, label: "[Fixture] Kiểm tra hội thoại", status: "in_progress", assigned_to_slot: 1 }] }, knowledge: [], guardrails: [], fileLocks: [], fileOwnership: [], brokerAlive: !offline, timestamp: Date.now() }; }
function broadcast() { for (const ws of clients) ws.send(JSON.stringify({ type: "state", data: state() })); }
function panelHtml(empty: boolean) {
  const panelModule = require.resolve("../extensions/multiagents-chat/panel.cjs");
  delete require.cache[panelModule];
  const { createConversationPanel } = require(panelModule);
  let open!: () => void;
  const webview = { html: "", cspSource: "'self'", asWebviewUri: (path: string) => path, postMessage() {}, onDidReceiveMessage() { return { dispose() {} }; } };
  createConversationPanel({ workspace: { isTrusted: true }, commands: { registerCommand(_: string, cb: () => void) { open=cb; return { dispose() {} }; } }, ViewColumn: { Beside: 2 }, Uri: { joinPath: (_: any, name: string) => "/panel/"+name }, window: { createWebviewPanel: () => ({ webview, onDidDispose() {}, dispose() {} }) } }, { extensionUri: "/panel", subscriptions: [] });
  open();
  const nonce = /nonce-([a-f0-9]+)/.exec(webview.html)![1];
  const entry = { owner: "fixture-owner", observedAt: Date.now(), snapshot: { session: { id: "fixture-ui", status: "active" }, agents: slots.map(s=>({ id:s.id, name:s.display_name, connection:s.status, task:s.task_state, paused:false })), plan: null,
    messages: messages.filter(m=>m.msg_type==="chat").map(m=>({ id:m.id, from:m.from_slot_id ? "[Fixture] Kỹ sư AI" : "Người điều hành fixture", to:"Nhóm fixture", time:m.sent_at, type:m.msg_type, text:m.text })), events: [] } };
  const payload = JSON.stringify({ type:"state", sessions:empty ? [] : [{key:"fixture-ui",label:"[Fixture] Nhóm giao diện"}], selected:empty ? null : "fixture-ui", entry:empty ? null : entry }).replace(/</g,"\\u003c");
  return webview.html.replace('</head>', '<link rel="stylesheet" href="/panel/fixture.css"></head>').replace('<script nonce=', `<script nonce="${nonce}">window.acquireVsCodeApi=()=>({postMessage:()=>setTimeout(()=>window.postMessage(${payload},'*'),0)});</script><script nonce=`);
}
const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname==="/ws" && server.upgrade(req)) return;
    if (url.pathname==="/api/sessions") return Response.json(sessions);
    if (url.pathname==="/api/session" && req.method==="POST") { const body=await req.json() as {session_id?: string}; if(!sessions.some(s=>s.id===body.session_id)) return new Response("Unknown",{status:400}); current=body.session_id!; broadcast(); return Response.json({ok:true}); }
    if (url.pathname==="/fixture/append") { messages.push({...messages[1]!,id:nextId++,text:"[Fixture] Tin mới bổ sung",sent_at:new Date().toISOString()}); broadcast(); return Response.json({ok:true}); }
    if (url.pathname==="/fixture/offline") { offline=true; broadcast(); return Response.json({ok:true}); }
    if (url.pathname==="/fixture/close" && req.method==="POST") { setTimeout(()=>{server.stop(true);process.exit(0);},100); return Response.json({ok:true}); }
    if (url.pathname==="/panel/fixture.css") return new Response(':root{--vscode-font-family:Verdana,sans-serif;--vscode-foreground:#e6edf3;--vscode-editor-background:#0d1117;--vscode-descriptionForeground:#a0a9b5;--vscode-panel-border:#30363d;--vscode-focusBorder:#58a6ff;--vscode-button-foreground:#fff;--vscode-button-background:#145e9e;--vscode-dropdown-foreground:#e6edf3;--vscode-dropdown-background:#1c2333}',{headers:{'Content-Type':'text/css'}});
    if (url.pathname==="/panel") return new Response(panelHtml(url.searchParams.has("empty")),{headers:{"Content-Type":"text/html;charset=utf-8"}});
    if (url.pathname==="/panel/panel.js" || url.pathname==="/panel/panel.css") return new Response(Bun.file(new URL("../extensions/multiagents-chat/"+url.pathname.split("/").at(-1),import.meta.url)));
    if (["/", "/index.html", "/app.js", "/app.css"].includes(url.pathname)) return new Response(Bun.file(new URL("../dashboard/"+(url.pathname==="/" ? "index.html" : url.pathname.slice(1)),import.meta.url)));
    return Response.json({error:"Fixture endpoint not implemented"},{status:404});
  }, websocket: { open(ws) { clients.add(ws); ws.send(JSON.stringify({type:"state",data:state()})); }, close(ws) {clients.delete(ws);}, message(ws,data) { if(data==="ping") ws.send(JSON.stringify({type:"pong"})); } },
});
console.log(`CONVERSATION_FIXTURE http://127.0.0.1:${server.port}`);
setTimeout(()=>server.stop(true), 15*60000);
