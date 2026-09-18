    function patchTimeline(feed, messages, slotMap) {
      const keep = new Set(messages.map(m => String(m.id)));
      for (const row of [...feed.children]) if (!keep.has(row.dataset.messageId)) row.remove();
      const rows = new Map([...feed.children].map(row => [row.dataset.messageId, row]));
      for (const [index, m] of messages.entries()) {
        const key = String(m.id);
        const fromSlot = slotMap.get(m.from_slot_id);
        const from = fromSlot?.display_name || m.from_id || "Không có ID người gửi";
        const to = m.to_id === "all-workers" || m._broadcast
          ? "Tất cả worker"
          : (slotMap.get(m.to_slot_id)?.display_name || m.to_id || "Nhóm");
        const version = JSON.stringify([m, from, to]);
        let row = rows.get(key);
        if (!row) {
          row = document.createElement("article");
          row.className = "timeline-entry";
          row.dataset.messageId = key;
        }
        if (feed.children[index] !== row) feed.insertBefore(row, feed.children[index] || null);
        if (row?.dataset.version === version) continue;
        const open = row.querySelector("details")?.open;
        const isSteer = m.msg_type === "steer" || (m.text || "").includes("MID-TURN STEER");
        const isSystem = ["system", "control", "team_change"].includes(m.msg_type);
        row.className = "timeline-entry" + (isSteer ? " timeline-entry--steer" : isSystem ? " timeline-entry--system" : "");

        const heading = document.createElement("header"); heading.className = "timeline-heading";
        if (isSteer) {
          const steerBadge = document.createElement("span");
          steerBadge.className = "badge badge-steer";
          steerBadge.textContent = "⚡ MID-TURN STEER";
          heading.append(steerBadge);
        }
        const sender = document.createElement("span"); sender.className = "timeline-sender"; sender.textContent = from;
        const route = document.createElement("span"); route.className = "timeline-route"; route.textContent = "→ " + to;
        const type = document.createElement("span"); type.className = "badge " + (isSteer ? "steer-status-tag tag-success" : isSystem ? "badge-system" : "badge-idle"); type.textContent = isSteer ? "Injected" : m.msg_type;
        const time = document.createElement("time"); const date = new Date(m.sent_at);
        time.textContent = Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        heading.append(sender, route, type, time);

        const body = document.createElement("div"); body.className = "timeline-body" + (isSteer ? " steer-body" : "");
        const rawText = m.text || "";
        const toolActionRegex = /^(●\s+|\[tool\]\s*|Read\s+|Edit\(|Write\(|Exec\(|Bash\()/i;
        if (toolActionRegex.test(rawText.trim()) || rawText.includes("● ")) {
          const lines = rawText.split("\n");
          const frag = document.createDocumentFragment();
          for (const line of lines) {
            const trimmed = line.trim();
            if (toolActionRegex.test(trimmed)) {
              const pill = document.createElement("span");
              pill.className = "tool-action-pill";
              pill.innerHTML = `<span class="tool-pill-dot">●</span> ${esc(trimmed.replace(/^●\s*/, ""))}`;
              frag.append(pill);
            } else if (trimmed) {
              const p = document.createElement("p");
              p.textContent = line;
              frag.append(p);
            }
          }
          body.append(frag);
        } else {
          body.textContent = rawText;
        }

        const avatar = document.createElement("div");
        avatar.className = "msg-avatar";
        const brand = typeof modelInfo === "function" ? modelInfo(fromSlot || { display_name: from }) : { brand: "AI", icon: "" };
        avatar.title = brand.brand;
        avatar.innerHTML = brand.icon;
        const content = document.createElement("div");
        content.className = "timeline-content";
        content.append(heading);
        if ((m.text || "").length > 600) {
          const details = document.createElement("details"); details.dataset.messageId = key; details.open = Boolean(open);
          const summary = document.createElement("summary"); summary.textContent = m.text.slice(0, 160) + " … Xem đầy đủ";
          details.append(summary, body); content.append(details);
        } else content.append(body);
        row.replaceChildren(avatar, content);
        row.dataset.version = version;
      }
      if (!messages.length && !feed.children.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.innerHTML = '<div class="empty-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div><span>Chưa có tin nhắn phù hợp</span>';
        feed.append(empty);
      }
    }

    function collapseBroadcasts(messages) {
      const out = [];
      const skip = new Set();
      for (const m of messages) {
        if (skip.has(m.id)) continue;
        if (m.from_id === "operator" && m.to_slot_id) {
          const t = new Date(m.sent_at).getTime();
          const group = messages.filter(o =>
            o.from_id === m.from_id && o.text === m.text && o.msg_type === m.msg_type && o.to_slot_id &&
            Math.abs(new Date(o.sent_at).getTime() - t) < 2000
          );
          if (group.length > 1) {
            group.forEach(o => skip.add(o.id));
            out.push({ ...m, to_slot_id: null, to_id: "all-workers", _broadcast: group.length });
            continue;
          }
        }
        skip.add(m.id);
        out.push(m);
      }
      return out;
    }

    let sidebarSearchQuery = "";

    function selectAgentFilter(slotId) {
      messageAgent = slotId == null ? "" : String(slotId);
      activeTab = "messages";
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelector('[data-tab="messages"]')?.classList.add("active");
      showPanel("messages");
    }

    async function sendDirectMessage() {
      const input = document.getElementById("prompt-input");
      const text = (input?.value || "").trim();
      if (!text) return;
      const statusEl = document.getElementById("prompt-status");
      const sendBtn = document.getElementById("prompt-send-btn");
      const targetSlotId = messageAgent ? Number(messageAgent) : null;

      if (statusEl) {
        statusEl.textContent = "Đang gửi…";
        statusEl.className = "composer-status pending";
      }
      if (sendBtn) sendBtn.disabled = true;

      try {
        const payload = {
          session_id: state?.sessionId,
          to_slot_id: targetSlotId,
          text: text,
          from_id: "operator",
          msg_type: "chat"
        };
        const res = await fetch("/api/message/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const result = await res.json().catch(() => null);
        if (!res.ok || !result || result.ok === false) {
          throw new Error((result && (result.error || result.message)) || "Gửi không thành công");
        }

        input.value = "";
        if (statusEl) {
          statusEl.textContent = "Đã gửi!";
          statusEl.className = "composer-status success";
          setTimeout(() => { if (statusEl && statusEl.textContent === "Đã gửi!") statusEl.textContent = ""; }, 2500);
        }
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = "Lỗi: " + (err.message || "Thử lại");
          statusEl.className = "composer-status error";
        }
      } finally {
        if (sendBtn) sendBtn.disabled = false;
      }
    }

    function renderMessages(force = false) {
      const el = document.getElementById("panel-messages");
      const changedSession = el.dataset.session !== (state.sessionId || "");
      if (!el.querySelector(".feed-toolbar")) {
        el.innerHTML = '<div class="conversation-room">' +
          '<aside class="agents-sidebar" aria-label="Danh sách Worker">' +
            '<div class="sidebar-header">' +
              '<div class="sidebar-brand">' +
                '<span class="brand-badge-dot"></span>' +
                '<strong class="sidebar-title">AgentsRoom</strong>' +
                '<span class="sidebar-version">v2</span>' +
              '</div>' +
              '<button type="button" class="conversation-nav-switch" id="conversation-switch" title="Tìm và đổi phiên làm việc">' +
                '<span>Phiên làm việc</span><span class="nav-switch-key">⌘K</span>' +
              '</button>' +
              '<div class="sidebar-search-wrap">' +
                '<input type="search" id="agent-search" class="sidebar-search-input" placeholder="Tìm worker..." aria-label="Tìm worker">' +
              '</div>' +
            '</div>' +
            '<div class="sidebar-agent-list" id="conversation-agents" role="list"></div>' +
            '<details class="sidebar-sessions-drawer">' +
              '<summary class="sessions-drawer-summary"><span>Phiên đã lưu</span></summary>' +
              '<div class="conversation-sessions-list" id="conversation-sessions"></div>' +
            '</details>' +
          '</aside>' +
          '<section class="conversation-center" aria-labelledby="chat-target-name">' +
            '<header class="chat-header" id="chat-header">' +
              '<div class="chat-header-main">' +
                '<div class="chat-target-avatar-wrap" id="chat-target-avatar">' +
                  '<div class="agent-avatar-circle">All</div>' +
                '</div>' +
                '<div class="chat-target-info">' +
                  '<div class="chat-target-title-row">' +
                    '<h1 class="chat-target-name" id="chat-target-name">Hội thoại nhóm</h1>' +
                    '<span class="chat-target-role badge badge-idle" id="chat-target-role">All Workers</span>' +
                    '<span class="badge-engine badge-engine--codex" id="chat-target-model">Multi-Engine</span>' +
                  '</div>' +
                  '<div class="chat-target-sub-row">' +
                    '<span class="chat-target-status" id="chat-target-status"><span class="status-indicator-dot dot-connected"></span> Đang kết nối</span>' +
                    '<span class="chat-target-telemetry" id="chat-target-telemetry"></span>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="chat-header-actions">' +
                '<p class="feed-caption" id="message-count" role="status"></p>' +
              '</div>' +
            '</header>' +
            '<div class="feed-toolbar">' +
              '<div class="toolbar-group">' +
                '<select id="message-agent" aria-label="Lọc theo worker"><option value="">Tất cả worker</option></select>' +
              '</div>' +
              '<input id="message-query" type="search" placeholder="Tìm theo nội dung, file, mã lỗi...">' +
              '<label class="toolbar-toggle-label"><input id="message-live" type="checkbox" checked><span>Theo tin mới</span></label>' +
            '</div>' +
            '<p id="conversation-error" role="alert" style="color:var(--red);font-size:12px;margin:0"></p>' +
            '<div class="msg-feed" id="message-timeline" role="region" tabindex="0" aria-label="Lịch sử hội thoại"></div>' +
            '<button id="message-latest" type="button" hidden>Đến tin mới nhất</button>' +
            '<details id="message-system">' +
              '<summary><span>Sự kiện hệ thống / điều khiển</span><span style="font-size:11px;color:var(--text-muted)">Nhật ký</span></summary>' +
              '<div class="msg-feed" id="message-events"></div>' +
            '</details>' +
            '<div class="prompt-composer" id="prompt-composer">' +
              '<div class="composer-header-row">' +
                '<span class="composer-target-pill" id="prompt-target-label"><span>💬</span> Đang nhắn tới: Tất cả worker</span>' +
                '<span class="composer-status" id="prompt-status" role="status"></span>' +
              '</div>' +
              '<div class="composer-box">' +
                '<textarea id="prompt-input" class="composer-textarea" rows="2" placeholder="Give your agent a prompt or a task: Enter to send, Shift+Enter for a new line" aria-label="Nhập prompt"></textarea>' +
                '<div class="composer-footer-row">' +
                  '<span class="composer-actions-hint">Enter gửi &bull; Shift+Enter xuống dòng</span>' +
                  '<button type="button" class="composer-send-btn" id="prompt-send-btn"><span>Gửi</span> &rarr;</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</section>' +
          '<aside class="agent-rail" id="agent-rail" aria-label="Chi tiết Telemetry & Nhiệm vụ">' +
            '<div class="agent-rail-header">' +
              '<button type="button" class="agent-rail-toggle" id="agent-rail-toggle" aria-expanded="false" aria-controls="agent-rail-details" title="Mở rộng xem chi tiết">' +
                '<span class="toggle-icon">◀</span><span class="toggle-label">Chi tiết</span>' +
              '</button>' +
            '</div>' +
            '<div class="agent-rail-list" id="agent-rail-details"></div>' +
          '</aside>' +
        '</div>';

        el.querySelector("#message-agent").onchange = e => { messageAgent=e.target.value; renderMessages(true); };
        el.querySelector("#message-query").oninput = e => { messageQuery=e.target.value; renderMessages(true); };
        el.querySelector("#message-live").onchange = e => { autoScroll=e.target.checked; renderMessages(true); };
        el.querySelector("#message-latest").onclick = () => { autoScroll=true; el.querySelector("#message-live").checked=true; renderMessages(true); const feed=el.querySelector("#message-timeline"); feed.scrollTop=feed.scrollHeight; };
        el.querySelector("#conversation-switch").onclick = openPicker;
        el.querySelector("#agent-rail-toggle").onclick = () => {
          const rail = el.querySelector("#agent-rail");
          const open = !rail.classList.contains("expanded");
          rail.classList.toggle("expanded", open);
          el.querySelector("#agent-rail-toggle").setAttribute("aria-expanded", String(open));
        };
        el.querySelector("#message-timeline").addEventListener("scroll", e => {
          const feed = e.currentTarget;
          if (feed.scrollHeight - feed.scrollTop - feed.clientHeight > 60) { autoScroll=false; el.querySelector("#message-live").checked=false; }
        });

        const agentSearch = el.querySelector("#agent-search");
        if (agentSearch) {
          agentSearch.oninput = e => {
            sidebarSearchQuery = (e.target.value || "").toLowerCase();
            renderMessages(true);
          };
        }

        const sendBtn = el.querySelector("#prompt-send-btn");
        if (sendBtn) sendBtn.onclick = sendDirectMessage;
        const promptInput = el.querySelector("#prompt-input");
        if (promptInput) {
          promptInput.onkeydown = e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendDirectMessage();
            }
          };
        }

        fetchSessions();
      }
      if (changedSession) {
        messageAgent=""; messageQuery=""; autoScroll=true; force=true;
        el.querySelector("#message-query").value=""; el.querySelector("#message-live").checked=true;
        el.querySelector("#message-timeline").replaceChildren(); el.querySelector("#message-events").replaceChildren();
        el.dataset.session=state.sessionId || "";
      }
      const nav = el.querySelector("#conversation-sessions");
      const navKey = JSON.stringify([allSessions, state.sessionId]);
      if (nav && nav.dataset.version !== navKey) {
        nav.replaceChildren(...allSessions.slice(0, 50).map(session => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "session-nav-item";
          button.setAttribute("aria-current", String(session.id === state.sessionId));
          const nameSpan = document.createElement("span");
          nameSpan.className = "session-nav-name";
          nameSpan.textContent = session.name || session.id;
          const metaSpan = document.createElement("span");
          metaSpan.className = "session-nav-meta";
          const dot = document.createElement("span");
          dot.className = "conn-dot " + (session.status === "active" ? "alive" : "");
          if (session.status !== "active") {
            dot.style.background = session.status === "paused" ? "var(--yellow)" : "var(--text-muted)";
            dot.style.boxShadow = "none";
          }
          const statusText = document.createElement("span");
          statusText.textContent = session.status === "active" ? "Đang chạy" : session.status === "paused" ? "Tạm dừng" : "Đã lưu";
          metaSpan.append(dot, statusText);
          button.append(nameSpan, metaSpan);
          button.onclick = () => selectSession(session.id);
          return buttoncollapseBroadcasts(matches.filter(m => !system(m)
        }));
        nav.dataset.version = navKey;
      }
      const slotMap = new Map(state.slots.map(slot => [slot.id, slot]));
      const select = el.querySelector("#message-agent");
      const optionKey = JSON.stringify(state.slots.map(slot => [slot.id, slot.display_name]));
      if (select && select.dataset.version !== optionKey) {
        const all = document.createElement("option"); all.value = ""; all.textContent = "Tất cả worker";
        select.replaceChildren(all, ...state.slots.map(slot => {
          const option = document.createElement("option");
          option.value = String(slot.id);
          option.textContent = slot.display_name || "Worker " + slot.id;
          return option;
        }));
        select.dataset.version = optionKey;
      }
      if (select) select.value = messageAgent;
      const matches = state.messages.slice(-200).filter(m =>
        (!messageAgent || m.from_slot_id === Number(messageAgent) || m.to_slot_id === Number(messageAgent)) &&
        (!messageQuery || [m.text, slotMap.get(m.from_slot_id)?.display_name, m.from_id, slotMap.get(m.to_slot_id)?.display_name, m.to_id].join(" ").toLowerCase().includes(messageQuery.toLowerCase()))
      ).sort((a, b) => a.id - b.id);
      const system = m => ["system", "control", "team_change"].includes(m.msg_type);
      const messages = matches.filter(m => !system(m));
      const caption = `${messages.length} tin / ${state.messages.length} bản ghi tải gần nhất`;
      const captionEl = el.querySelector("#message-count");
      if (captionEl && captionEl.textContent !== caption) captionEl.textContent = caption;
      const feed = el.querySelector("#message-timeline");
      const version = JSON.stringify([messages, optionKey]);
      if (!autoScroll && !force && feed.dataset.rendered) {
        el.querySelector("#message-latest").hidden = feed.dataset.version === version;
      } else {
        const scroll = feed.scrollTop;
        patchTimeline(feed, messages, slotMap);
        if (autoScroll) feed.scrollTop = feed.scrollHeight; else feed.scrollTop = scroll;
        feed.dataset.version = version; feed.dataset.rendered = "1";
        el.querySelector("#message-latest").hidden = true;
      }
      patchTimeline(el.querySelector("#message-events"), matches.filter(system), slotMap);

      // --- Update Chat Header & Composer Target ---
      const activeSlot = slotMap.get(Number(messageAgent));
      const targetAvatar = el.querySelector("#chat-target-avatar");
      const targetName = el.querySelector("#chat-target-name");
      const targetRole = el.querySelector("#chat-target-role");
      const targetModel = el.querySelector("#chat-target-model");
      const targetStatus = el.querySelector("#chat-target-status");
      const targetTelemetry = el.querySelector("#chat-target-telemetry");
      const composerTarget = el.querySelector("#prompt-target-label");

      const roleMeta = role => {
        const raw = String(role || "").toLowerCase();
        if (/product owner|\bpo\b/.test(raw)) return { full: "Product Owner", mini: "PO" };
        if (/project manager|\bpm\b/.test(raw)) return { full: "Project Manager", mini: "PM" };
        if (/ui\/ux|designer/.test(raw)) return { full: "UI/UX Designer", mini: "Designer" };
        if (/qa|qc/.test(raw)) return { full: "QA Engineer", mini: "QA" };
        if (/review/.test(raw)) return { full: "Code Reviewer", mini: "Reviewer" };
        if (/engineer|coder|software/.test(raw)) return { full: "Software Engineer", mini: "Coder" };
        return { full: role || "Agent", mini: (role || "Agent").slice(0, 8) };
      };

      const workflowMeta = state => {
        const key = state || "idle";
        if (key === "working") return { cls: "badge-working", label: "Đang xử lý", mini: "Làm" };
        if (key === "done_pending_review") return { cls: "badge-review", label: "Chờ QC", mini: "QC" };
        if (key === "addressing_feedback") return { cls: "badge-feedback", label: "Sửa QC", mini: "Sửa" };
        if (key === "approved" || key === "released") return { cls: "badge-approved", label: "Đã duyệt", mini: "Xong" };
        return { cls: "badge-standby", label: "Sẵn sàng", mini: "Sẵn" };
      };

      if (activeSlot) {
        const mInfo = modelInfo(activeSlot);
        const rInfo = roleMeta(activeSlot.role || activeSlot.agent_type);
        const wf = workflowMeta(activeSlot.task_state);
        const conn = activeSlot.status === "connected";
        if (targetAvatar) targetAvatar.innerHTML = `<div class="agent-avatar-circle" style="width:36px;height:36px">${esc(rInfo.mini)}<span class="agent-pulse-dot ${conn ? "dot-connected" : "dot-disconnected"}"></span></div>`;
        if (targetName) targetName.textContent = activeSlot.display_name || `Worker ${activeSlot.id}`;
        if (targetRole) { targetRole.textContent = rInfo.full; targetRole.className = `chat-target-role badge ${wf.cls}`; }
        if (targetModel) { targetModel.innerHTML = `${mInfo.icon} ${esc(mInfo.brand)}`; targetModel.className = "badge-engine badge-engine--codex"; }
        if (targetStatus) targetStatus.innerHTML = `<span class="status-indicator-dot ${conn ? "dot-connected" : "dot-disconnected"}"></span> ${conn ? "Đang kết nối" : "Mất kết nối"} &bull; ${wf.label}`;
        const inStr = tokenText(activeSlot, "input_tokens");
        const outStr = tokenText(activeSlot, "output_tokens");
        const totalNum = (Number.isSafeInteger(activeSlot.input_tokens) && activeSlot.input_tokens > 0 ? activeSlot.input_tokens : 0) + (Number.isSafeInteger(activeSlot.output_tokens) && activeSlot.output_tokens > 0 ? activeSlot.output_tokens : 0);
        const totalStr = observedTokens(activeSlot) ? totalNum.toLocaleString("en-US") : "Chưa được báo cáo";
        if (targetTelemetry) {
          targetTelemetry.innerHTML = `<span class="token-metric">Input: <b class="tab-nums">${inStr}</b></span> &bull; <span class="token-metric">Output: <b class="tab-nums">${outStr}</b></span> &bull; <span class="token-metric">Total: <b class="tab-nums">${totalStr}</b></span>`;
        }
        if (composerTarget) composerTarget.innerHTML = `<span>💬</span> Đang nhắn riêng tới: <strong>${esc(activeSlot.display_name)}</strong> (Slot ${activeSlot.id})`;
      } else {
        if (targetAvatar) targetAvatar.innerHTML = `<div class="agent-avatar-circle" style="width:36px;height:36px">ALL<span class="agent-pulse-dot dot-connected"></span></div>`;
        if (targetName) targetName.textContent = "Hội thoại nhóm";
        if (targetRole) { targetRole.textContent = "All Workers"; targetRole.className = "chat-target-role badge badge-idle"; }
        if (targetModel) { targetModel.innerHTML = "Multi-Engine"; }
        if (targetStatus) targetStatus.innerHTML = `<span class="status-indicator-dot dot-connected"></span> ${state.slots.filter(s => s.status === "connected").length}/${state.slots.length} worker kết nối`;
        let sumIn = 0, sumOut = 0, anyObs = false;
        for (const s of state.slots) {
          if (observedTokens(s)) {
            anyObs = true;
            sumIn += (Number.isSafeInteger(s.input_tokens) && s.input_tokens > 0 ? s.input_tokens : 0);
            sumOut += (Number.isSafeInteger(s.output_tokens) && s.output_tokens > 0 ? s.output_tokens : 0);
          }
        }
        if (targetTelemetry) {
          targetTelemetry.innerHTML = `<span class="token-metric">Input: <b class="tab-nums">${anyObs ? sumIn.toLocaleString("en-US") : "0"}</b></span> &bull; <span class="token-metric">Output: <b class="tab-nums">${anyObs ? sumOut.toLocaleString("en-US") : "0"}</b></span> &bull; <span class="token-metric">Total: <b class="tab-nums">${anyObs ? (sumIn + sumOut).toLocaleString("en-US") : "0"}</b></span>`;
        }
        if (composerTarget) composerTarget.innerHTML = `<span>💬</span> Đang nhắn tới: <strong>Tất cả worker</strong>`;
      }

      // --- Render Agents Sidebar (Grouped by status: NEEDS INPUT / TO REVIEW / ACTIVE / SEEN-IDLE) ---
      const info = el.querySelector("#conversation-agents");
      const infoKey = JSON.stringify([state.slots, state.plan, messageAgent, sidebarSearchQuery]);
      if (info && info.dataset.version !== infoKey) {
        let filteredSlots = state.slots;
        if (sidebarSearchQuery) {
          filteredSlots = state.slots.filter(s =>
            (s.display_name || "").toLowerCase().includes(sidebarSearchQuery) ||
            (s.role || "").toLowerCase().includes(sidebarSearchQuery) ||
            (s.agent_type || "").toLowerCase().includes(sidebarSearchQuery)
          );
        }

        const groups = [
          { id: "needs-input", label: "NEEDS INPUT", dot: "dot-blocked", match: s => s.task_state === "blocked" || s.task_state === "needs_input" },
          { id: "review", label: "TO REVIEW", dot: "dot-review", match: s => s.task_state === "done_pending_review" },
          { id: "active", label: "ACTIVE", dot: "dot-connected", match: s => s.task_state === "working" || s.task_state === "addressing_feedback" },
          { id: "idle", label: "SEEN / IDLE", dot: "dot-disconnected", match: s => !["blocked", "needs_input", "done_pending_review", "working", "addressing_feedback"].includes(s.task_state) }
        ];

        const allSelected = messageAgent === "" ? "selected" : "";
        let sidebarHtml = `<div class="agent-nav-card ${allSelected}" data-slot="" tabindex="0" role="button" aria-pressed="${messageAgent === ""}" aria-label="Tất cả worker">
          <div class="agent-avatar-circle">
            <span>ALL</span>
            <span class="agent-pulse-dot dot-connected"></span>
          </div>
          <div class="agent-nav-card-info">
            <div class="agent-nav-card-top">
              <strong class="agent-nav-card-name">Tất cả worker</strong>
              <span class="agent-nav-card-runtime">${state.slots.length}</span>
            </div>
            <span class="agent-nav-card-role">Toàn bộ phòng</span>
            <span class="agent-nav-card-preview">Xem toàn bộ hội thoại nhóm</span>
          </div>
        </div>`;

        for (const g of groups) {
          const inGroup = filteredSlots.filter(g.match);
          if (!inGroup.length) continue;
          sidebarHtml += `<div class="agent-group group-${g.id}">
            <div class="agent-group-title">
              <span class="agent-group-dot"></span>
              <span>${g.label}</span>
              <span style="margin-left:auto;font-size:9.5px;color:var(--text-muted)">(${inGroup.length})</span>
            </div>
            ${inGroup.map(slot => {
              const isSel = String(slot.id) === String(messageAgent) ? "selected" : "";
              const mInfo = modelInfo(slot);
              const rInfo = roleMeta(slot.role || slot.agent_type || "Agent");
              const conn = slot.status === "connected";
              const wf = workflowMeta(slot.task_state);
              const lastMsg = state.messages.filter(m => m.from_slot_id === slot.id || m.to_slot_id === slot.id).at(-1);
              const preview = lastMsg ? (lastMsg.text || "").slice(0, 48) : (slot.task_state ? wf.label : "Sẵn sàng");
              const dotCls = !conn ? "dot-disconnected" : g.dot;
              const connLabel = conn ? "Kết nối" : "Ngắt kết nối";
              return `<div class="agent-nav-card ${isSel}" data-slot="${slot.id}" tabindex="0" role="button" aria-pressed="${isSel === "selected"}" aria-label="${esc(slot.display_name || "Worker " + slot.id)} - ${esc(rInfo.full)} - ${connLabel}">
                <div class="agent-avatar-circle" title="${esc(mInfo.brand)}">
                  <span>${esc(rInfo.mini)}</span>
                  <span class="agent-pulse-dot ${dotCls}"></span>
                </div>
                <div class="agent-nav-card-info">
                  <div class="agent-nav-card-top">
                    <strong class="agent-nav-card-name">${esc(slot.display_name || "Worker " + slot.id)}</strong>
                    <span class="agent-nav-card-runtime" title="Model: ${esc(mInfo.brand)}">${esc(mInfo.brand)}</span>
                  </div>
                  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                    <span class="agent-nav-card-role">${esc(rInfo.full)}</span>
                    <span class="badge ${wf.cls}" style="font-size:9.5px;padding:1px 5px">${esc(wf.label)}</span>
                    <span class="status-label-text" style="font-size:9.5px;color:${conn ? "var(--green)" : "var(--text-muted)"}">[${connLabel}]</span>
                  </div>
                  <span class="agent-nav-card-preview">${esc(preview)}</span>
                </div>
              </div>`;
            }).join("")}
          </div>`;
        }

        info.innerHTML = sidebarHtml;
        info.dataset.version = infoKey;

        // Card click handler
        info.querySelectorAll(".agent-nav-card").forEach(card => {
          const selectCard = () => {
            messageAgent = card.dataset.slot || "";
            const sel = el.querySelector("#message-agent");
            if (sel) sel.value = messageAgent;
            renderMessages(true);
          };
          card.onclick = selectCard;
          card.onkeydown = event => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              selectCard();
            }
          };
        });
      }
    }
