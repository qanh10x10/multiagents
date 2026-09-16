from pathlib import Path

p = Path("dashboard/index.html")
text = p.read_text(encoding="utf-8")

old_css = """    .agent-rail {
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

new_css = """    .conversation-room .agent-rail-toggle { min-height: 32px; padding: 6px 4px; }
    .agent-rail {
      width: 84px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      transition: width 220ms cubic-bezier(0.16, 1, 0.3, 1);
      overflow: hidden;
      max-height: 80vh;
    }
    .agent-rail.expanded { width: 300px; }
    .agent-rail-header {
      padding: 8px;
      display: flex;
      align-items: center;
      border-bottom: 1px solid var(--border);
    }
    .agent-rail-toggle {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text-dim);
      cursor: pointer;
      font-size: 10px;
      font-weight: 500;
      line-height: 1.2;
    }
    .agent-rail.expanded .agent-rail-toggle { flex-direction: row; gap: 6px; font-size: 11px; }
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
      padding: 8px 6px;
      cursor: pointer;
      transition: border-color 0.15s ease;
    }
    .agent-rail-card:hover, .agent-rail-card:focus-visible { border-color: var(--accent); outline: none; }
    .agent-collapsed-identity {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      min-width: 0;
    }
    .agent-rail.expanded .agent-collapsed-identity { flex-direction: row; align-items: center; gap: 10px; }
    .agent-avatar-wrap {
      position: relative;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: linear-gradient(180deg, #1E293B, #0F172A);
      border: 1px solid #334155;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .agent-rail.expanded .agent-avatar-wrap { width: 36px; height: 36px; }
    .agent-initials {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: #F8FAFC;
      line-height: 1;
    }
    .agent-pulse-dot {
      position: absolute;
      bottom: -1px;
      right: -1px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      border: 2px solid var(--surface);
      background: var(--text-muted);
    }
    .dot-connected { background: #10B981; box-shadow: 0 0 6px #10B981; }
    .dot-disconnected { background: #64748B; }
    .agent-name-collapsed {
      display: block;
      max-width: 64px;
      font-size: 11px;
      font-weight: 500;
      color: #E2E8F0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: center;
    }
    .agent-rail.expanded .agent-name-collapsed { max-width: none; text-align: left; flex: 1; }
    .workflow-mini-pill {
      font-size: 9px;
      font-weight: 600;
      line-height: 1;
      padding: 2px 5px;
      border-radius: 999px;
      max-width: 64px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .agent-rail.expanded .workflow-mini-pill { display: none; }
    .agent-rail:not(.expanded) .agent-expanded-content { display: none; }
    .agent-expanded-content { min-width: 0; }
    .agent-identity-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; margin-top: 8px; }
    .agent-full-name { display: block; font-size: 13px; font-weight: 700; color: #F8FAFC; }
    .agent-role { font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.03em; }
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

old_toggle = '''<button type="button" class="agent-rail-toggle" id="agent-rail-toggle" aria-expanded="false" aria-controls="conversation-agents" title="Mở rộng / Thu gọn danh sách Agent"><span class="toggle-icon">◀</span><span class="toggle-label">Agents</span></button>'''
new_toggle = '''<button type="button" class="agent-rail-toggle" id="agent-rail-toggle" aria-expanded="false" aria-controls="conversation-agents" title="Mở rộng xem token và nhiệm vụ"><span class="toggle-icon">◀</span><span class="toggle-label">Chi tiết</span></button>'''
if old_toggle not in text:
    raise SystemExit("toggle markup not found")
text = text.replace(old_toggle, new_toggle, 1)

old_info = """        const statusLabel = status => status === "connected" ? "Đang kết nối" : "Mất kết nối";
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
        }).join("") || '<p>Phiên chưa có worker.</p>';"""

new_info = """        const statusLabel = status => status === "connected" ? "Đang kết nối" : "Mất kết nối";
        const workflowMeta = state => {
          const key = state || "idle";
          if (key === "working") return { cls: "badge-working", label: "Đang xử lý", mini: "Làm" };
          if (key === "done_pending_review") return { cls: "badge-review", label: "Chờ duyệt", mini: "Duyệt" };
          if (key === "addressing_feedback") return { cls: "badge-feedback", label: "Đang sửa", mini: "Sửa" };
          if (key === "approved" || key === "released") return { cls: "badge-approved", label: "Đã duyệt", mini: "Xong" };
          return { cls: "badge-standby", label: "Sẵn sàng", mini: "Sẵn" };
        };
        const initialsOf = name => {
          const parts = String(name || "").trim().split(/\\s+/).filter(Boolean);
          if (!parts.length) return "AG";
          const letters = parts.slice(0, 2).map(part => Array.from(part)[0]).join("");
          return letters.toUpperCase();
        };
        const shortName = name => {
          const parts = String(name || "").trim().split(/\\s+/).filter(Boolean);
          if (parts.length >= 2) return parts[0] + " " + Array.from(parts[1])[0] + ".";
          return parts[0] || "Agent";
        };
        info.innerHTML=state.slots.map(slot=>{
          const name = slot.display_name || ("Worker " + slot.id);
          const role = slot.role || slot.agent_type || "Agent";
          const connected = slot.status === "connected";
          const wf = workflowMeta(slot.task_state);
          const task = (state.plan?.items || []).filter(item=>item.assigned_to_slot===slot.id && item.status!=="done").map(item=>item.label).join("; ");
          const title = name + " · " + statusLabel(slot.status) + " · " + wf.label + (task ? " · " + task : "");
          return '<div class="agent-rail-card" role="listitem" tabindex="0" data-slot="' + Number(slot.id) + '" title="' + esc(title) + '"><div class="agent-collapsed-identity"><div class="agent-avatar-wrap"><span class="agent-initials">' + esc(initialsOf(name)) + '</span><span class="agent-pulse-dot ' + (connected ? "dot-connected" : "dot-disconnected") + '" aria-label="' + esc(statusLabel(slot.status)) + '"></span></div><span class="agent-name-collapsed">' + esc(shortName(name)) + '</span><span class="workflow-mini-pill badge ' + wf.cls + '">' + esc(wf.mini) + '</span></div><div class="agent-expanded-content"><div class="agent-identity-row"><div><strong class="agent-full-name">' + esc(name) + '</strong><span class="agent-role">' + esc(role) + '</span></div><span class="badge ' + wf.cls + '">' + esc(wf.label) + '</span></div><div class="agent-rail-details"><div class="token-grid"><div class="token-col"><dt>Input</dt><dd>' + tokenText(slot, "input_tokens") + '</dd></div><div class="token-col"><dt>Cached</dt><dd>' + tokenText(slot, "cache_read_tokens") + '</dd></div><div class="token-col"><dt>Output</dt><dd>' + tokenText(slot, "output_tokens") + '</dd></div></div><div class="agent-task-desc">' + esc(task || "Chưa có nhiệm vụ đang làm trong kế hoạch") + '</div></div></div></div>';
        }).join("") || '<p>Phiên chưa có worker.</p>';"""

if old_info not in text:
    raise SystemExit("info render not found")
text = text.replace(old_info, new_info, 1)

p.write_text(text, encoding="utf-8", newline="\n")
checks = {
  "width_84": "width: 84px" in text,
  "width_300": "width: 300px" in text,
  "initials": "agent-initials" in text,
  "collapsed_name": "agent-name-collapsed" in text,
  "hide_info_col": "agent-rail:not(.expanded) .agent-info-col" in text,
  "dot_only_icon": "agent-avatar-icon" in text,
  "conversation_agents": 'id="conversation-agents"' in text,
}
print(checks)
if not checks["width_84"] or not checks["initials"] or not checks["collapsed_name"] or checks["hide_info_col"] or checks["dot_only_icon"]:
    raise SystemExit("post-check failed")
print("ok")
