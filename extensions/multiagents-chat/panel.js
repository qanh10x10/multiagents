(() => {
  "use strict";
  const api = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  let selected;
  let pendingMessages;
  let timelineVersion;
  let isRailExpanded = false;

  const SVG_GEMINI = '<svg class="model-brand-icon gemini" viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 24c0-6.627-5.373-12-12-12 6.627 0 12-5.373 12-12 0 6.627 5.373 12 12 12-6.627 0-12 5.373-12 12z"/></svg>';
  const SVG_OPENAI = '<svg class="model-brand-icon openai" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 0 1 8.66 15l-1.73-1a8 8 0 0 0-6.93-12zm-8.66 5a10 10 0 0 1 8.66-5v2a8 8 0 0 0-6.93 4zm0 10a10 10 0 0 1 0-10l1.73 1a8 8 0 0 0 0 8zm8.66 5a10 10 0 0 1-8.66-5l1.73-1a8 8 0 0 0 6.93 4zm8.66-5a10 10 0 0 1-8.66 5v-2a8 8 0 0 0 6.93-4zm0-10a10 10 0 0 1 0 10l-1.73-1a8 8 0 0 0 0-8z"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg>';
  const SVG_GROK = '<svg class="model-brand-icon grok" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="3" x2="21" y2="21"/><line x1="16" y1="3" x2="21" y2="8"/><line x1="3" y1="16" x2="8" y2="21"/></svg>';
  const SVG_CLAUDE = '<svg class="model-brand-icon claude" viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2l2.4 6.6L21 11l-5.6 4.4L17 22l-5-4-5 4 1.6-6.6L3 11l6.6-2.4z"/></svg>';
  const SVG_FALLBACK = '<svg class="model-brand-icon fallback" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

  function resolveModelInfo(agent) {
    const raw = String(agent.model || agent.agent_type || agent.name || "").toLowerCase();
    const displayName = agent.model || agent.agent_type || "AI";
    if (raw.includes("gemini") || raw.startsWith("ag/")) {
      return { brand: "Gemini", icon: SVG_GEMINI, label: displayName.replace(/^ag\//, "") };
    }
    if (raw.includes("codex") || raw.includes("openai") || raw.includes("gpt") || raw.startsWith("cx/")) {
      return { brand: "OpenAI", icon: SVG_OPENAI, label: displayName.replace(/^cx\//, "") };
    }
    if (raw.includes("grok") || raw.includes("xai") || raw.startsWith("xai/")) {
      return { brand: "Grok", icon: SVG_GROK, label: displayName.replace(/^xai\//, "") };
    }
    if (raw.includes("claude") || raw.includes("anthropic")) {
      return { brand: "Claude", icon: SVG_CLAUDE, label: displayName };
    }
    return { brand: "AI", icon: SVG_FALLBACK, label: displayName };
  }

  function resolveRoleDisplay(role, name) {
    const r = String(role || "").toLowerCase();
    const n = String(name || "").toLowerCase();
    if (r.includes("product owner") || n.includes("po")) return { full: "Product Owner", mini: "PO" };
    if (r.includes("designer") || n.includes("designer")) return { full: "UI/UX Designer", mini: "Designer" };
    if (r.includes("engineer") || r.includes("coder") || n.includes("coder")) return { full: "Software Engineer", mini: "Engineer" };
    if (r.includes("manager") || n.includes("pm")) return { full: "Project Manager", mini: "PM" };
    if (r.includes("qa") || n.includes("qa")) return { full: "QA Engineer", mini: "QA" };
    if (r.includes("review") || n.includes("reviewer")) return { full: "Code Reviewer", mini: "Reviewer" };
    return { full: role || "Agent", mini: (role || "Agent").slice(0, 8) };
  }

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }

  function getBadgeClass(type) {
    if (!type) return "badge-chat";
    const t = String(type).toLowerCase();
    if (t === "broadcast") return "badge-broadcast";
    if (t === "system" || t === "control") return "badge-system";
    if (t === "feedback" || t === "review_request" || t === "review") return "badge-feedback";
    if (t === "task_complete" || t === "approval" || t === "complete") return "badge-approval";
    return "badge-chat";
  }

  function senderModel(message, agents) {
    const from = String(message.from || "");
    const agent = (agents || []).find(a => a.name === from);
    return resolveModelInfo(agent || { name: from, model: from });
  }

  function getWorkflowLabel(state) {
    switch (state) {
      case "working": return "Đang xử lý";
      case "done_pending_review": return "Chờ duyệt";
      case "addressing_feedback": return "Đang sửa";
      case "approved": return "Đã duyệt";
      case "released": return "Hoàn tất";
      default: return "Sẵn sàng";
    }
  }

  function renderMessageBody(text) {
    const content = text || "";
    if (content.length <= 500) {
      return node("p", content, "bubble-text");
    }
    const details = node("details", undefined, "msg-expandable");
    const summary = node("summary", content.slice(0, 180) + "... (bấm để xem hết)");
    const full = node("p", content, "bubble-text");
    details.append(summary, full);
    return details;
  }

  function reconcile(container, messages, agents) {
    const keys = new Set();
    for (const message of messages.slice(-50)) {
      const key = String(message.id);
      keys.add(key);
      let row = [...container.children].find(child => child.dataset.id === key);
      const version = JSON.stringify(message);
      if (row?.dataset.version === version) continue;

      const msgType = String(message.type || "chat");
      const badgeClass = getBadgeClass(msgType);
      const isOperator = String(message.from || "").toLowerCase().includes("operator") || String(message.from || "").toLowerCase().includes("user");

      const next = node("article", undefined, "msg-card msg-" + msgType + (isOperator ? " msg-outgoing" : " msg-incoming"));
      next.dataset.id = key;
      next.dataset.version = version;
      next.setAttribute("role", "article");
      next.setAttribute("aria-label", "Tin nhắn từ " + message.from + " đến " + message.to);

      const avatar = node("div", undefined, "msg-avatar");
      const model = senderModel(message, agents);
      avatar.innerHTML = model.icon;
      avatar.title = model.brand;
      const contentWrap = node("div", undefined, "msg-content-wrap");

      const header = node("div", undefined, "msg-header");
      const sender = node("strong", message.from, "msg-sender");
      const route = node("span", " → " + message.to, "meta msg-route");
      const badge = node("span", msgType, "badge " + badgeClass);
      const time = node("time", message.time || "Chưa có thời điểm", "meta msg-time");
      header.append(sender, route, badge, time);

      const bubble = node("div", undefined, "msg-bubble");
      bubble.append(renderMessageBody(message.text));

      contentWrap.append(header, bubble);
      next.append(avatar, contentWrap);

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
      : "Bản quan sát lúc " + new Date(entry.observedAt).toLocaleString("vi-VN") + " · " + entry.snapshot.session.status + " · " + (entry.snapshot.agents.some(a => a.connection === "connected") ? "Có worker kết nối tại thời điểm ghi" : "Không có worker kết nối") + ". Không phải bằng chứng hoàn thành.");
    if (!entry) return;
    const snapshot = entry.snapshot;
    const feed = $("timeline");
    const atEnd = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
    const version = JSON.stringify(snapshot.messages);
    if (atEnd || !timelineVersion) {
      reconcile(feed, snapshot.messages, snapshot.agents);
      timelineVersion = version; pendingMessages = undefined;
      feed.scrollTop = feed.scrollHeight; $("latest").hidden = true;
    } else if (timelineVersion !== version) {
      pendingMessages = snapshot.messages; $("latest").hidden = false;
    }
    reconcile($("events"), snapshot.events || [], snapshot.agents);

    // Render agents in NN/g Presence Rail with Model Brand SVG & Explicit Roles
    const agentsList = snapshot.agents || [];
    if ($("agent-count-badge")) {
      const activeCount = agentsList.filter(a => a.connection === "connected").length;
      $("agent-count-badge").textContent = activeCount + "/" + agentsList.length;
    }

    const agents = JSON.stringify(agentsList);
    if ($("agents").dataset.version !== agents) {
      $("agents").replaceChildren(...agentsList.map(agent => {
        const isConnected = agent.connection === "connected";
        const taskState = agent.task || "standby";
        const workflowLabel = getWorkflowLabel(taskState);
        const modelInfo = resolveModelInfo(agent);
        const roleInfo = resolveRoleDisplay(agent.role, agent.name);

        const card = node("article", undefined, "agent-card");
        card.dataset.status = isConnected ? "connected" : "disconnected";
        card.tabIndex = 0;
        card.title = agent.name + " · " + roleInfo.full + " · " + modelInfo.brand + " · " + (isConnected ? "Đang kết nối" : "Ngắt kết nối") + " · " + workflowLabel;

        // 1. Collapsed Identity (Avatar initials + presence dot + model mini overlay + truncated name + mini role)
        const collapsedId = node("div", undefined, "agent-collapsed-identity");
        const avatarWrap = node("div", undefined, "agent-avatar-badge-wrap");
        const presenceDot = node("span", undefined, "presence-dot " + (isConnected ? "online" : "offline"));
        presenceDot.setAttribute("aria-label", isConnected ? "Đang kết nối" : "Ngắt kết nối");
        avatarWrap.innerHTML = modelInfo.icon;
        avatarWrap.title = modelInfo.brand;
        avatarWrap.append(presenceDot);

        const shortName = node("span", agent.name, "agent-name-collapsed");
        const miniRole = node("span", roleInfo.mini, "agent-role-mini");
        collapsedId.append(avatarWrap, shortName, miniRole);

        // 2. Expanded Content (Full Name + Full Role + Workflow Badge + Separate Model Row + Token Usage)
        const expandedContent = node("div", undefined, "agent-expanded-content");

        const idRow = node("div", undefined, "agent-identity-row");
        const meta = node("div", undefined, "agent-meta");
        const fullName = node("span", agent.name, "agent-full-name");
        const roleFull = node("span", roleInfo.full, "agent-role-full");
        meta.append(fullName, roleFull);

        const wfBadge = node("span", workflowLabel, "workflow-badge " + taskState);
        idRow.append(meta, wfBadge);

        // Separate Model Row
        const modelRow = node("div", undefined, "agent-model-row");
        modelRow.title = "Mô hình AI điều hành: " + modelInfo.brand;
        const modelLabel = node("span", "Model:", "model-row-label");
        const modelChip = node("span", undefined, "model-badge-chip");
        const iconWrap = node("span", undefined, "model-icon-wrap");
        iconWrap.innerHTML = modelInfo.icon;
        const modelName = node("span", modelInfo.brand, "model-name-text");
        modelChip.append(iconWrap, modelName);
        modelRow.append(modelLabel, modelChip);

        // Token Panel
        const tokenPanel = node("div", undefined, "token-panel");
        const tokenHead = node("div", undefined, "token-panel-head");
        tokenHead.append(node("span", "Tiêu thụ Token"), node("span", isConnected ? "Trực tiếp" : "Offline"));

        const usage = agent.usage;
        if (usage?.observedAt) {
          const metricsRow = node("div", undefined, "token-metrics-row");
          const inCell = node("div", undefined, "token-cell");
          inCell.append(node("dt", "Input"), node("dd", String(usage.input ?? "—")));
          const cacheCell = node("div", undefined, "token-cell");
          cacheCell.append(node("dt", "Cached"), node("dd", String(usage.cached ?? "—")));
          const outCell = node("div", undefined, "token-cell");
          outCell.append(node("dt", "Output"), node("dd", String(usage.output ?? "—")));
          metricsRow.append(inCell, cacheCell, outCell);
          tokenPanel.append(tokenHead, metricsRow, node("div", "Cached đã nằm trong input.", "meta token-note"));
        } else {
          tokenPanel.append(tokenHead, node("div", "Chưa được báo cáo", "token-unreported"));
        }

        expandedContent.append(idRow, modelRow, tokenPanel);

        card.append(collapsedId, expandedContent);
        return card;
      }));
      if (!agentsList.length) {
        $("agents").textContent = "Chưa có worker trong phiên.";
      }
      $("agents").dataset.version = agents;
    }

    const plan = JSON.stringify(snapshot.plan);
    if ($("plan").dataset.version !== plan) {
      const statusVi = { done: "xong", in_progress: "đang làm", blocked: "bị chặn", pending: "chưa làm" };
      const nodes = [];
      if (snapshot.plan) {
        const head = node("p", undefined, "plan-head");
        const open = (snapshot.agents || []).filter(a => a.task !== "released").length;
        const pct = snapshot.plan.completion == null ? "?" : (snapshot.plan.completion >= 100 && open > 0 ? 99 : snapshot.plan.completion);
        head.append(node("strong", `${pct}%`));
        head.append(node("span", open > 0 ? ` · ${open} worker chưa đóng` : " · worker đã đóng", "plan-note"));
        nodes.push(head);
        (snapshot.plan.items || []).forEach((item, i) => {
          const p = node("p", undefined, "plan-item");
          const icon = item.status === "done" ? "✓" : item.status === "in_progress" ? "⏳" : "•";
          p.append(
            node("span", `${i + 1}. `, "plan-num"),
            node("span", icon + " ", "plan-icon plan-" + item.status),
            node("strong", (item.agent || "Chưa giao") + ": "),
            node("span", item.label + " · "),
            node("span", statusVi[item.status] || item.status, "badge badge-" + item.status)
          );
          nodes.push(p);
        });
      } else {
        nodes.push(node("p", "Chưa có kế hoạch được ghi."));
      }
      $("plan").replaceChildren(...nodes);
      $("plan").dataset.version = plan;
    }
  });

  if ($("toggle-agent-rail")) {
    $("toggle-agent-rail").addEventListener("click", () => {
      isRailExpanded = !isRailExpanded;
      $("toggle-agent-rail").setAttribute("aria-expanded", String(isRailExpanded));
      if ($("agent-rail")) {
        if (isRailExpanded) {
          $("agent-rail").classList.remove("collapsed");
          $("agent-rail").classList.add("expanded");
        } else {
          $("agent-rail").classList.add("collapsed");
          $("agent-rail").classList.remove("expanded");
        }
      }
    });
  }

  $("session").addEventListener("change", () => api.postMessage({ type: "select", key: $("session").value }));
  $("chat").addEventListener("click", () => api.postMessage({ type: "chat" }));
  $("latest").addEventListener("click", () => {
    if (pendingMessages) { reconcile($("timeline"), pendingMessages, []); timelineVersion = JSON.stringify(pendingMessages); pendingMessages = undefined; }
    $("timeline").scrollTop = $("timeline").scrollHeight; $("latest").hidden = true;
  });
  api.postMessage({ type: "ready" });
})();
