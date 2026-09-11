(() => {
  "use strict";
  const api = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  let selected;
  let pendingMessages;
  let timelineVersion;
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }
  function reconcile(container, messages) {
    const keys = new Set();
    for (const message of messages.slice(-50)) {
      const key = String(message.id);
      keys.add(key);
      let row = [...container.children].find(child => child.dataset.id === key);
      const version = JSON.stringify(message);
      if (row?.dataset.version === version) continue;
      const next = node("article"); next.dataset.id = key; next.dataset.version = version;
      next.append(node("strong", message.from), node("span", ` → ${message.to} · ${message.type}`, "meta"), node("time", message.time || "Chưa có thời điểm", "meta"), node("p", message.text));
      if (row) row.replaceWith(next); else container.append(next);
    }
    for (const row of [...container.children]) if (!keys.has(row.dataset.id)) row.remove();
    if (!messages.length) container.textContent = "Chưa có bản ghi trong cửa sổ quan sát.";
    else for (const child of [...container.childNodes]) if (child.nodeType === 3) child.remove();
  }
  window.addEventListener("message", event => {
    const data = event.data;
    if (data?.type !== "state" || !Array.isArray(data.sessions)) return;
    const options = JSON.stringify(data.sessions);
    if ($("session").dataset.options !== options) {
      $("session").replaceChildren(...data.sessions.map(session => { const option = node("option", session.label); option.value = session.key; return option; }));
      $("session").dataset.options = options;
    }
    $("session").value = data.selected || "";
    const entry = data.entry;
    if (selected !== data.selected || !entry) {
      for (const id of ["timeline", "events", "agents", "plan"]) $(id).replaceChildren();
      selected = data.selected;
      timelineVersion = undefined; pendingMessages = undefined;
      $("latest").hidden = true;
      delete $("agents").dataset.version; delete $("plan").dataset.version;
    }
    $("status").textContent = data.error || (!entry ? "Chưa có dữ liệu. Dùng @multiagents /status trong Chat để quan sát một phiên."
      : `Bản quan sát lúc ${new Date(entry.observedAt).toLocaleString("vi-VN")} · ${entry.snapshot.session.status} · ${entry.snapshot.agents.some(a => a.connection === "connected") ? "Có worker kết nối tại thời điểm ghi" : "Không có worker kết nối"}. Không phải bằng chứng hoàn thành.`);
    if (!entry) return;
    const snapshot = entry.snapshot;
    const feed = $("timeline");
    const atEnd = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
    const version = JSON.stringify(snapshot.messages);
    if (atEnd || !timelineVersion) {
      reconcile(feed, snapshot.messages);
      timelineVersion = version; pendingMessages = undefined;
      feed.scrollTop = feed.scrollHeight; $("latest").hidden = true;
    } else if (timelineVersion !== version) {
      pendingMessages = snapshot.messages; $("latest").hidden = false;
    }
    reconcile($("events"), snapshot.events || []);
    const agents = JSON.stringify(snapshot.agents);
    if ($("agents").dataset.version !== agents) {
      $("agents").replaceChildren(...snapshot.agents.map(agent => {
        const card = node("article"); card.append(node("strong", `${agent.name} · AI`), node("p", `${agent.connection} · ${agent.task}${agent.paused ? " · tạm dừng" : ""}`));
        const usage = agent.usage;
        card.append(node("p", usage?.observedAt ? `Input ${usage.input ?? "chưa báo"} · Cached ${usage.cached ?? "chưa báo"} · Output ${usage.output ?? "chưa báo"}. Cached đã nằm trong input.` : "Token chưa được báo cáo; không phải số 0.", "meta"));
        card.append(node("p", "Hạn mức 5 giờ / tuần: xem báo cáo quota trong dashboard; không suy ra từ số token.", "meta"));
        return card;
      }));
      $("agents").dataset.version = agents;
    }
    const plan = JSON.stringify(snapshot.plan);
    if ($("plan").dataset.version !== plan) {
      $("plan").replaceChildren(...(snapshot.plan?.items || []).map(item => node("p", `${item.agent || "Chưa giao"}: ${item.label} · ${item.status}`)));
      if (!snapshot.plan) $("plan").textContent = "Chưa có kế hoạch được ghi.";
      $("plan").dataset.version = plan;
    }
  });
  $("session").addEventListener("change", () => api.postMessage({ type: "select", key: $("session").value }));
  $("chat").addEventListener("click", () => api.postMessage({ type: "chat" }));
  $("latest").addEventListener("click", () => {
    if (pendingMessages) { reconcile($("timeline"), pendingMessages); timelineVersion = JSON.stringify(pendingMessages); pendingMessages = undefined; }
    $("timeline").scrollTop = $("timeline").scrollHeight; $("latest").hidden = true;
  });
  api.postMessage({ type: "ready" });
})();
