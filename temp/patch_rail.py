from pathlib import Path

p = Path("dashboard/index.html")
text = p.read_text(encoding="utf-8")

old_css = """    .conversation-room { display:grid; grid-template-columns:190px minmax(0,1fr); gap:22px; align-items:start; }
    .conversation-room > * { min-width:0; }
    .conversation-room h1 { font-size:24px; margin:0 0 8px; } .conversation-room h2 { font-size:16px; margin:0 0 12px; }
    .conversation-room button, #session-name, .picker-item { font:inherit; color:var(--text); background:var(--surface2); border:1px solid var(--border); border-radius:6px; padding:10px; cursor:pointer; min-height:44px; }
    .conversation-room :focus-visible, #session-name:focus-visible, .picker :focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
    .conversation-nav button { width:100%; text-align:left; margin-bottom:8px; overflow-wrap:anywhere; }
    .conversation-nav [aria-current=true] { border-color:var(--accent); background:linear-gradient(100deg,#16364e,var(--surface)); }
    .conversation-center .msg-feed { height:52vh; overflow:auto; scrollbar-gutter:stable; overflow-anchor:none; }
    #message-events { height:auto; max-height:240px; margin-top:14px; } #message-system { margin-top:18px; }
    .chat-agent-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin: 0 0 12px;
      overflow-x: auto;
      scrollbar-width: thin;
    }
    .chat-agent-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      font-size: 12px;
      color: var(--text);
      white-space: nowrap;
      transition: border-color 0.15s ease, background 0.15s ease;
      cursor: default;
    }
    .chat-agent-pill:hover, .chat-agent-pill:focus-visible {
      border-color: var(--accent);
      background: rgba(88, 166, 255, 0.08);
    }
    .agent-avatar { font-size: 14px; line-height: 1; }
    .agent-name { font-weight: 600; color: var(--text); }
    .agent-role {
      font-size: 10px;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.03em;
      background: var(--surface2);
      padding: 1px 4px;
      border-radius: 3px;
    }
    .agent-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-muted);
    }
    .chat-agent-pill[data-status="connected"] .agent-status-dot {
      background: var(--green);
      box-shadow: 0 0 6px rgba(63, 185, 80, 0.4);
    }
    .picker-item { width:100%; text-align:left; }
    @media(max-width:1100px) { .conversation-room { grid-template-columns:160px minmax(0,1fr); } }
    @media(max-width:650px) { .conversation-room { grid-template-columns:minmax(0,1fr); } #conversation-sessions { display:flex; gap:8px; overflow:auto; } #conversation-sessions button { min-width:160px; width:auto; } .conversation-center .msg-feed { height:50vh; } .conversation-nav h2 { display:none; } }"""

new_css = """    .conversation-room { display:grid; grid-template-columns:190px minmax(0,1fr) auto; gap:16px; align-items:stretch; }
    .conversation-room > * { min-width:0; }
    .conversation-room h1 { font-size:24px; margin:0 0 8px; } .conversation-room h2 { font-size:16px; margin:0 0 12px; }
    .conversation-room button, #session-name, .picker-item { font:inherit; color:var(--text); background:var(--surface2); border:1px solid var(--border); border-radius:6px; padding:10px; cursor:pointer; min-height:44px; }
    .conversation-room :focus-visible, #session-name:focus-visible, .picker :focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
    .conversation-nav button { width:100%; text-align:left; margin-bottom:8px; overflow-wrap:anywhere; }
    .conversation-nav [aria-current=true] { border-color:var(--accent); background:linear-gradient(100deg,#16364e,var(--surface)); }
    .conversation-center .msg-feed { height:52vh; overflow:auto; scrollbar-gutter:stable; overflow-anchor:none; }
    #message-events { height:auto; max-height:240px; margin-top:14px; } #message-system { margin-top:18px; }
    .agent-rail {
      width: 56px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      display: flex;
      flex-direction: column;
      transition: width 0.24s cubic-bezier(0.16, 1, 0.3, 1);
      overflow: hidden;
      max-height: 80vh;
    }
    .agent-rail.expanded { width: 270px; }
    .agent-rail-header {
      padding: 10px;
      display: flex;
      align-items: center;
      border-bottom: 1px solid var(--border);
    }
    .agent-rail-toggle {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      cursor: pointer;
      padding: 6px;
      font-size: 11px;
      min-height: 36px;
    }
    .agent-rail:not(.expanded) .toggle-label { display: none; }
    .agent-rail.expanded .toggle-icon { transform: rotate(180deg); }
    .agent-rail-list {
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow-y: auto;
      flex: 1;
    }
    .agent-rail-card {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px;
      cursor: pointer;
      transition: border-color 0.15s ease;
    }
    .agent-rail-card:hover, .agent-rail-card:focus-visible { border-color: var(--accent); outline: none; }
    .agent-rail-summary { display: flex; align-items: center; gap: 10px; }
    .agent-avatar-wrap {
      position: relative;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: rgba(88, 166, 255, 0.12);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
    }
    .agent-pulse-dot {
      position: absolute;
      bottom: 0;
      right: 0;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      border: 2px solid var(--surface);
      background: var(--text-muted);
    }
    .dot-connected { background: var(--green); box-shadow: 0 0 6px var(--green); }
    .dot-disconnected { background: var(--text-dim); }
    .agent-rail:not(.expanded) .agent-info-col,
    .agent-rail:not(.expanded) .agent-rail-details { display: none; }
    .agent-info-col { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    .agent-name-row { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
    .agent-name { font-size: 12px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .agent-role { font-size: 10px; color: var(--text-dim); }
    .agent-rail-details { margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(255, 255, 255, 0.05); }
    .token-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 4px;
      margin-bottom: 6px;
    }
    .token-col { text-align: center; }
    .token-col dt { font-size: 9px; color: var(--text-dim); text-transform: uppercase; }
    .token-col dd { margin: 0; font-size: 11px; font-weight: 600; color: var(--text); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .agent-task-desc { font-size: 11px; color: var(--text-dim); overflow-wrap: anywhere; }
    .badge-standby { background: rgba(128, 128, 128, 0.15); color: var(--text-dim); }
    .picker-item { width:100%; text-align:left; }
    @media (prefers-reduced-motion: reduce) { .agent-rail { transition: none; } }
    @media(max-width:1100px) { .conversation-room { grid-template-columns:160px minmax(0,1fr) auto; } }
    @media(max-width:650px) { .conversation-room { grid-template-columns:minmax(0,1fr); } .agent-rail { width: 100%; max-height: none; } .agent-rail.expanded { width: 100%; } #conversation-sessions { display:flex; gap:8px; overflow:auto; } #conversation-sessions button { min-width:160px; width:auto; } .conversation-center .msg-feed { height:50vh; } .conversation-nav h2 { display:none; } }"""

if old_css not in text:
    raise SystemExit("CSS block not found")
text = text.replace(old_css, new_css, 1)

old_html = """        el.innerHTML = '<div class="conversation-room"><nav class="conversation-nav" aria-label="Phiên làm việc"><h2>Phiên làm việc</h2><button type="button" id="conversation-switch">Tìm / đổi phiên</button><div id="conversation-sessions"></div></nav><section class="conversation-center" aria-labelledby="conversation-heading"><h1 id="conversation-heading">Hội thoại của nhóm</h1><div class="chat-agent-bar" id="conversation-agents" role="region" aria-label="Danh sách agents tham gia"></div><p class="feed-caption">Tin nhắn thật của worker AI và người điều hành. Chỉ xem; dùng @multiagents trong VS Code Chat để điều phối và xác nhận điều khiển.</p><div class="feed-toolbar"><label>Worker<select id="message-agent"><option value="">Tất cả worker</option></select></label><label>Tìm nội dung<input id="message-query" type="search" placeholder="Nhiệm vụ, file, kiểm thử hoặc vướng mắc"></label><label><input id="message-live" type="checkbox" checked>Theo tin mới</label></div><p id="conversation-error" role="alert"></p><p class="feed-caption" id="message-count" role="status"></p><div class="msg-feed" id="message-timeline" role="region" tabindex="0" aria-label="Lịch sử hội thoại"></div><button id="message-latest" type="button" hidden>Đến tin mới nhất</button><details id="message-system"><summary>Sự kiện hệ thống / điều khiển</summary><div class="msg-feed" id="message-events"></div></details></section></div>';"""

new_html = """        el.innerHTML = '<div class="conversation-room"><nav class="conversation-nav" aria-label="Phiên làm việc"><h2>Phiên làm việc</h2><button type="button" id="conversation-switch">Tìm / đổi phiên</button><div id="conversation-sessions"></div></nav><section class="conversation-center" aria-labelledby="conversation-heading"><h1 id="conversation-heading">Hội thoại của nhóm</h1><p class="feed-caption">Tin nhắn thật của worker AI và người điều hành. Chỉ xem; dùng @multiagents trong VS Code Chat để điều phối và xác nhận điều khiển.</p><div class="feed-toolbar"><label>Worker<select id="message-agent"><option value="">Tất cả worker</option></select></label><label>Tìm nội dung<input id="message-query" type="search" placeholder="Nhiệm vụ, file, kiểm thử hoặc vướng mắc"></label><label><input id="message-live" type="checkbox" checked>Theo tin mới</label></div><p id="conversation-error" role="alert"></p><p class="feed-caption" id="message-count" role="status"></p><div class="msg-feed" id="message-timeline" role="region" tabindex="0" aria-label="Lịch sử hội thoại"></div><button id="message-latest" type="button" hidden>Đến tin mới nhất</button><details id="message-system"><summary>Sự kiện hệ thống / điều khiển</summary><div class="msg-feed" id="message-events"></div></details></section><aside class="agent-rail" id="agent-rail" aria-label="Danh sách Agent tham gia"><div class="agent-rail-header"><button type="button" class="agent-rail-toggle" id="agent-rail-toggle" aria-expanded="false" aria-controls="conversation-agents" title="Mở rộng / Thu gọn danh sách Agent"><span class="toggle-icon">◀</span><span class="toggle-label">Agents</span></button></div><div class="agent-rail-list" id="conversation-agents" role="list"></div></aside></div>';"""

if old_html not in text:
    raise SystemExit("conversation innerHTML not found")
text = text.replace(old_html, new_html, 1)

old_bind = """        el.querySelector("#conversation-switch").onclick = openPicker;
        el.querySelector("#message-timeline").addEventListener("scroll", e => {"""
new_bind = """        el.querySelector("#conversation-switch").onclick = openPicker;
        el.querySelector("#agent-rail-toggle").onclick = () => {
          const rail = el.querySelector("#agent-rail");
          const open = !rail.classList.contains("expanded");
          rail.classList.toggle("expanded", open);
          el.querySelector("#agent-rail-toggle").setAttribute("aria-expanded", String(open));
        };
        el.querySelector("#message-timeline").addEventListener("scroll", e => {"""
if old_bind not in text:
    raise SystemExit("bind block not found")
text = text.replace(old_bind, new_bind, 1)

old_info = """      const info=el.querySelector("#conversation-agents");
      const infoKey=JSON.stringify([state.slots,state.plan]);
      if(info.dataset.version!==infoKey) {
        const statusLabel = status => status === "connected" ? "Đang kết nối" : "Mất kết nối";
        info.innerHTML=state.slots.map(slot=>{
          const name = slot.display_name || ("Worker " + slot.id);
          const role = slot.role || slot.agent_type || "Agent";
          const connected = slot.status === "connected";
          const task = (state.plan?.items || []).filter(item=>item.assigned_to_slot===slot.id && item.status!=="done").map(item=>item.label).join("; ");
          const title = name + " · " + statusLabel(slot.status) + (task ? " · " + task : "");
          return '<div class="chat-agent-pill" data-status="' + (connected ? "connected" : "disconnected") + '" tabindex="0" title="' + esc(title) + '"><span class="agent-avatar" aria-hidden="true">●</span><span class="agent-name">' + esc(name) + '</span><span class="agent-role">' + esc(role) + '</span><span class="agent-status-dot" aria-label="' + esc(statusLabel(slot.status)) + '"></span></div>';
        }).join("") || '<p>Phiên chưa có worker.</p>';
        info.dataset.version=infoKey;
      }"""

new_info = """      const info=el.querySelector("#conversation-agents");
      const infoKey=JSON.stringify([state.slots,state.plan]);
      if(info.dataset.version!==infoKey) {
        const statusLabel = status => status === "connected" ? "Đang kết nối" : "Mất kết nối";
        const workflowMeta = state => {
          const key = state || "idle";
          if (key === "working") return { cls: "badge-working", label: "Đang xử lý" };
          if (key === "done_pending_review") return { cls: "badge-review", label: "Chờ duyệt" };
          if (key === "addressing_feedback") return { cls: "badge-feedback", label: "Đang sửa" };
          if (key === "approved" || key === "released") return { cls: "badge-approved", label: "Đã duyệt" };
          return { cls: "badge-standby", label: "Sẵn sàng" };
        };
        info.innerHTML=state.slots.map(slot=>{
          const name = slot.display_name || ("Worker " + slot.id);
          const role = slot.role || slot.agent_type || "Agent";
          const connected = slot.status === "connected";
          const wf = workflowMeta(slot.task_state);
          const task = (state.plan?.items || []).filter(item=>item.assigned_to_slot===slot.id && item.status!=="done").map(item=>item.label).join("; ");
          const title = name + " · " + statusLabel(slot.status) + " · " + wf.label + (task ? " · " + task : "");
          return '<div class="agent-rail-card" role="listitem" tabindex="0" data-slot="' + Number(slot.id) + '" title="' + esc(title) + '"><div class="agent-rail-summary"><div class="agent-avatar-wrap"><span class="agent-avatar-icon" aria-hidden="true">●</span><span class="agent-pulse-dot ' + (connected ? "dot-connected" : "dot-disconnected") + '" aria-label="' + esc(statusLabel(slot.status)) + '"></span></div><div class="agent-info-col"><div class="agent-name-row"><strong class="agent-name">' + esc(name) + '</strong><span class="badge ' + wf.cls + '">' + esc(wf.label) + '</span></div><span class="agent-role">' + esc(role) + '</span></div></div><div class="agent-rail-details"><div class="token-grid"><div class="token-col"><dt>Input</dt><dd>' + tokenText(slot, "input_tokens") + '</dd></div><div class="token-col"><dt>Cached</dt><dd>' + tokenText(slot, "cache_read_tokens") + '</dd></div><div class="token-col"><dt>Output</dt><dd>' + tokenText(slot, "output_tokens") + '</dd></div></div><div class="agent-task-desc">' + esc(task || "Chưa có nhiệm vụ đang làm trong kế hoạch") + '</div></div></div>';
        }).join("") || '<p>Phiên chưa có worker.</p>';
        info.dataset.version=infoKey;
      }"""

if old_info not in text:
    raise SystemExit("info render not found")
text = text.replace(old_info, new_info, 1)

p.write_text(text, encoding="utf-8", newline="\n")
print("patched")
print("agent-rail", "agent-rail" in text)
print("chat-agent-bar", "chat-agent-bar" in text)
print("conversation-agents", 'id="conversation-agents"' in text)
print("5h", "5 giờ" in text)
print("weekly", "Hằng tuần" in text)
print("Chưa được báo cáo", "Chưa được báo cáo" in text)
print("Sẵn sàng", "Sẵn sàng" in text)
