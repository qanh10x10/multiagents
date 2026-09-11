"use strict";

const OBSERVATION = "get_chat_observation";
const ACTIONS = { pause: "pause_agent", interrupt: "interrupt_agent", resume: "resume_agent" };

function parseRequest(command, prompt) {
  if (!["watch", "status", "direct", "stop", ...Object.keys(ACTIONS)].includes(command)) {
    throw new Error("Chọn /watch, /status, /pause, /interrupt, /direct, /resume hoặc /stop.");
  }
  const parts = prompt.split("|");
  const session = parts.shift()?.trim();
  if (!session || !/^[a-zA-Z0-9_-]{1,150}$/.test(session)) throw new Error("Cần ID phiên chính xác.");
  if (command === "watch" || command === "status") {
    if (parts.length) throw new Error("Watch/status chỉ nhận ID phiên.");
    return { command, session };
  }
  const target = parts.shift()?.trim();
  if (!target) throw new Error("Dùng: ID phiên | tên chính xác hoặc ID worker.");
  const message = parts.join("|").trim();
  if (command === "direct" && (!message || message.length > 12000)) throw new Error("Điều kiện cần từ 1 đến 12000 ký tự.");
  if (command !== "direct" && message) throw new Error("Có nội dung thừa sau tên worker.");
  return { command, session, target, message };
}

function toolFamily(tools, observationName) {
  const observation = tools.find(tool => tool.name === observationName);
  if (!observation || !observation.name.endsWith(OBSERVATION)) throw new Error("Công cụ quan sát của MCP đã chọn không còn khả dụng. Kiểm tra cấu hình MCP.");
  const prefix = observation.name.slice(0, -OBSERVATION.length);
  return name => {
    const tool = tools.find(tool => tool.name === prefix + name);
    if (!tool) throw new Error(`MCP đã chọn không có ${name}. Kiểm tra phiên bản và công cụ MCP.`);
    return tool;
  };
}

function exactAgent(snapshot, target) {
  const matches = snapshot.agents.filter(agent => String(agent.id) === target || agent.name === target);
  if (matches.length !== 1) throw new Error("Cần tên hoặc ID khớp đúng một worker. Xem /status trước.");
  return matches[0];
}

function decodeObservation(text, session) {
  if (typeof text !== "string" || text.length > 500000) throw new Error("Bản quan sát vượt giới hạn.");
  const value = JSON.parse(text);
  if (value?.session?.id !== session || typeof value.session.status !== "string" || !Array.isArray(value.agents) || !Array.isArray(value.messages) ||
      value.agents.length > 100 || value.messages.length > 200 || value.agents.some(a => !a || !Number.isSafeInteger(a.id) || a.id <= 0 ||
        typeof a.name !== "string" || typeof a.connection !== "string" || typeof a.task !== "string" || typeof a.paused !== "boolean") ||
      new Set(value.agents.map(a => a.id)).size !== value.agents.length) {
    throw new Error("Bản quan sát không hợp lệ từ MCP đã chọn.");
  }
  const clean = (value, size = 4000) => safeText(value).slice(0, size);
  const records = rows => (Array.isArray(rows) ? [...rows] : []).sort((a, b) => a?.id - b?.id).slice(-50).map(m => {
    if (!m || !Number.isSafeInteger(m.id) || typeof m.text !== "string" || typeof m.from !== "string" || typeof m.to !== "string") throw new Error("Tin nhắn quan sát không hợp lệ.");
    return { id: m.id, from: clean(m.from, 200), to: clean(m.to, 200), time: clean(m.time, 100), type: clean(m.type, 80), text: clean(m.text) };
  });
  const count = n => Number.isSafeInteger(n) && n >= 0 ? n : null;
  return { session: { id: session, status: clean(value.session.status, 80) },
    agents: value.agents.map(a => ({ id: a.id, name: clean(a.name, 200), connection: clean(a.connection, 80), task: clean(a.task, 80), paused: a.paused,
      usage: a.usage?.observedAt && Number.isFinite(a.usage.observedAt) ? { observedAt: a.usage.observedAt, input: count(a.usage.input), cached: count(a.usage.cached), output: count(a.usage.output) } : null })),
    messages: records(value.messages), events: records(value.events),
    plan: value.plan && Array.isArray(value.plan.items) ? { completion: Number.isFinite(value.plan.completion) ? value.plan.completion : null,
      items: value.plan.items.slice(0, 100).map(item => ({ label: clean(item.label, 1000), status: clean(item.status, 80), agent: item.agent == null ? null : clean(item.agent, 200) })) } : null };
}

function safeText(text) {
  // Defense in depth only: arbitrary free text can still contain sensitive data.
  return String(text ?? "").replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|ghp|github_pat)-?[A-Za-z0-9_]{16,}\b/g, "[redacted]")
    .replace(/\b(api[_-]?key|token|password|secret)\s*[:=]\s*([^\s,;]+)/gi, "$1=[redacted]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

function statusText(snapshot) {
  return [`Phiên: ${snapshot.session.id} (${snapshot.session.status})`,
    ...snapshot.agents.map(agent => `${agent.name} [${agent.id}] · AI | kết nối: ${agent.connection} | nhiệm vụ: ${agent.task} | tạm dừng: ${agent.paused ? "có" : "không"}`),
    `Kế hoạch đã ghi: ${snapshot.plan?.completion == null ? "chưa rõ" : `${snapshot.plan.completion}%`}. Chưa xác minh tiến độ bàn giao.`,
    ...(snapshot.plan?.items ?? []).map(item => `  ${item.status}: ${item.label} (${item.agent ?? "chưa giao"})`),
  ].join("\n");
}

function cancellableDelay(ms, token) {
  return new Promise(resolve => {
    if (token.isCancellationRequested) return resolve();
    let subscription;
    const finish = () => { clearTimeout(timer); subscription?.dispose(); resolve(); };
    const timer = setTimeout(finish, ms);
    subscription = token.onCancellationRequested(finish);
    if (token.isCancellationRequested) finish();
  });
}

async function watch({ fetchSnapshot, emit, token, delay = cancellableDelay, now = Date.now, interval = 4000, duration = 600000 }) {
  const started = now();
  let previousStatus = "";
  let seen = new Set();
  let first = true;
  while (!token.isCancellationRequested && now() - started < duration) {
    const snapshot = await fetchSnapshot();
    if (token.isCancellationRequested) return;
    const status = statusText(snapshot);
    if (status !== previousStatus) { emit(status); previousStatus = status; }
    const ordered = [...snapshot.messages].sort((a, b) => a.id - b.id);
    const fresh = ordered.filter(message => !seen.has(message.id));
    if (first && fresh.length > 5) emit("Hiển thị 5 báo cáo mới nhất; xem bản ghi cũ trong dashboard.");
    for (const message of first ? fresh.slice(-5) : fresh) {
      emit(`${message.time} | ${message.from} -> ${message.to} | ${message.type}\n${message.text}`);
    }
    seen = new Set(ordered.map(message => message.id));
    first = false;
    if (snapshot.session.status === "archived" || snapshot.agents.every(agent => agent.connection !== "connected")) {
      emit("Đã dừng theo dõi: phiên lưu trữ hoặc không còn worker kết nối. Điều này không chứng minh hoàn thành.");
      return;
    }
    await delay(interval, token);
  }
  if (!token.isCancellationRequested) emit("Đã hết cửa sổ theo dõi 10 phút. Dùng /watch để xem tiếp. Worker vẫn giữ trạng thái hiện tại.");
}

function chatContext(history, tool) {
  for (const turn of [...(history || [])].reverse()) {
    const data = turn.participant === "multiagents.chat" && turn.result?.metadata;
    if (data?.tool === tool && /^[a-zA-Z0-9_-]{1,150}$/.test(data.session || "")) return data;
  }
  return {};
}

function followups(result) {
  const session = result?.metadata?.session;
  if (!/^[a-zA-Z0-9_-]{1,150}$/.test(session || "")) return [];
  return [
    { command: "status", prompt: session, label: "Cập nhật trạng thái" },
    { command: "watch", prompt: session, label: "Theo dõi nhóm" },
    { command: "resume", prompt: `${session} | @all`, label: "Tiếp tục cả nhóm" },
    { command: "direct", prompt: session, label: "Thêm điều kiện..." },
    { command: "session", prompt: "", label: "Đổi phiên" },
  ];
}

function sessionChoices(text) {
  // Parse only the current server's bounded list_sessions display contract.
  if (!text.startsWith("=== Multiagents Sessions ===")) return [];
  const lines = text.split(/\r?\n/);
  const choices = [];
  for (let i = 0; i < lines.length; i++) {
    const id = /^  ([a-zA-Z0-9_-]{1,150})$/.exec(lines[i]);
    if (id && /^    Name: /.test(lines[i + 1] || "")) {
      choices.push({ label: id[1], description: safeText(lines[i + 1].trim()) });
    }
  }
  return choices;
}

function conversationIntent(prompt) {
  const text = String(prompt || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d").toLowerCase().trim().replace(/[.!?]+$/, "").replace(/\s+/g, " ");
  if (!text) return { command: "status", welcome: true };
  if (/^(doi|chon)( lai)? session$|^switch session$/.test(text)) return { command: "session" };
  if (/^(xem )?(tien do|trang thai)( hien tai)?$|^status$|^show status$/.test(text)) return { command: "status" };
  if (/^(theo doi|theo doi tien do|xem bao cao truc tiep|watch)$/.test(text)) return { command: "watch" };
  // Whole-utterance matching: negation, mixed actions and arbitrary prose must not execute controls.
  const match = /^(tiep tuc(?: xu ly)?|xu ly tiep|bat lai|khoi dong lai|resume|continue(?: work)?|restart|tam dung|pause|ngat|interrupt|dung|stop)(?: (tat ca(?: cac)?|all|toan bo))?(?: (?:worker|workers|agent|agents|team|nhom|cong viec|task(?: dang (?:ton dong|tam dung))?))?$/.exec(text);
  if (!match) return { command: "clarify" };
  const verb = match[1];
  const command = /^(tam dung|pause)$/.test(verb) ? "pause"
    : /^(ngat|interrupt)$/.test(verb) ? "interrupt"
    : /^(dung|stop)$/.test(verb) ? "stop" : "resume";
  const all = Boolean(match[2]);
  return { command, all, continueWork: /^(tiep tuc|xu ly tiep|continue)/.test(verb) };
}

function resumeRoster(snapshot) {
  return {
    restart: snapshot.agents.filter(a => a.connection === "disconnected" && a.task !== "released"),
    unpause: snapshot.agents.filter(a => a.connection === "connected" && a.paused && a.task !== "released"),
  };
}

function stateKey(snapshot) {
  return JSON.stringify({ status: snapshot.session.status, agents: snapshot.agents.map(a => ({
    id: a.id, name: a.name, connection: a.connection, task: a.task, paused: a.paused,
  })).sort((a, b) => String(a.id).localeCompare(String(b.id))) });
}

module.exports = { OBSERVATION, ACTIONS, parseRequest, toolFamily, exactAgent, decodeObservation, safeText, statusText, cancellableDelay, watch, chatContext, followups, sessionChoices, conversationIntent, resumeRoster, stateKey };
