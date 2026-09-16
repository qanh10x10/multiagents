from pathlib import Path

p = Path("dashboard/index.html")
text = p.read_text(encoding="utf-8")
orig = text

text = text.replace('<html lang="en">', '<html lang="vi">', 1)

old_css = """    .conversation-room { display:grid; grid-template-columns:190px minmax(0,1fr) 280px; gap:22px; align-items:start; }
    .conversation-room > * { min-width:0; }
    .conversation-room h1 { font-size:24px; margin:0 0 8px; } .conversation-room h2 { font-size:16px; margin:0 0 12px; }
    .conversation-room button, #session-name, .picker-item { font:inherit; color:var(--text); background:var(--surface2); border:1px solid var(--border); border-radius:6px; padding:10px; cursor:pointer; min-height:44px; }
    .conversation-room :focus-visible, #session-name:focus-visible, .picker :focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
    .conversation-nav button { width:100%; text-align:left; margin-bottom:8px; overflow-wrap:anywhere; }
    .conversation-nav [aria-current=true] { border-color:var(--accent); background:linear-gradient(100deg,#16364e,var(--surface)); }
    .conversation-center .msg-feed { height:52vh; overflow:auto; scrollbar-gutter:stable; overflow-anchor:none; }
    #message-events { height:auto; max-height:240px; margin-top:14px; } #message-system { margin-top:18px; }
    .conversation-details { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:16px; max-height:80vh; overflow:auto; }
    .conversation-agent { border-bottom:1px solid var(--border); padding:12px 0; font-size:12px; overflow-wrap:anywhere; }
    .conversation-agent h3 { font-size:14px; margin:0 0 8px; } .conversation-agent p { margin:8px 0; line-height:1.6; }
    .conversation-agent summary { cursor:pointer; color:var(--accent); min-height:32px; } .picker-item { width:100%; text-align:left; }
    @media(max-width:1100px) { .conversation-room { grid-template-columns:160px minmax(0,1fr); } .conversation-details { grid-column:1 / -1; max-height:none; } #conversation-agents { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:16px; } }
    @media(max-width:650px) { .conversation-room { grid-template-columns:minmax(0,1fr); } #conversation-sessions { display:flex; gap:8px; overflow:auto; } #conversation-sessions button { min-width:160px; width:auto; } .conversation-center .msg-feed { height:50vh; } .conversation-nav h2 { display:none; } }"""

new_css = """    .conversation-room { display:grid; grid-template-columns:190px minmax(0,1fr); gap:22px; align-items:start; }
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

if old_css not in text:
    raise SystemExit("CSS block not found")
text = text.replace(old_css, new_css, 1)

old_tab = '      <button type="button" class="tab" data-tab="agents">Agents <span class="tab-badge" id="badge-agents">0</span></button>\n'
if old_tab not in text:
    raise SystemExit("agents tab not found")
text = text.replace(old_tab, "", 1)

old_panel = '      <div id="panel-agents" class="hidden"></div>\n'
if old_panel not in text:
    raise SystemExit("panel-agents not found")
text = text.replace(old_panel, "", 1)

text = text.replace(
    '      const tabs = ["agents", "messages", "plan", "knowledge", "files", "stats"];',
    '      const tabs = ["messages", "plan", "knowledge", "files", "stats"];',
    1,
)
text = text.replace('        case "agents": renderAgents(); break;\n', "", 1)
text = text.replace('      document.getElementById("badge-agents").textContent = connected;\n', "", 1)

start = text.find("    // --- Agents panel ---")
end = text.find("    // --- Messages panel ---")
if start < 0 or end < 0:
    raise SystemExit(f"agents panel markers missing {start} {end}")
text = text[:start] + "    // --- Messages panel ---\n\n" + text[end + len("    // --- Messages panel ---"):]

old_html = """        el.innerHTML = '<div class="conversation-room"><nav class="conversation-nav" aria-label="Phiên làm việc"><h2>Phiên làm việc</h2><button type="button" id="conversation-switch">Tìm / đổi phiên</button><div id="conversation-sessions"></div></nav><section class="conversation-center" aria-labelledby="conversation-heading"><h1 id="conversation-heading">Hội thoại của nhóm</h1><p class="feed-caption">Tin nhắn thật của worker AI và người điều hành. Chỉ xem; dùng @multiagents trong VS Code Chat để điều phối và xác nhận điều khiển.</p><div class="feed-toolbar"><label>Worker<select id="message-agent"><option value="">Tất cả worker</option></select></label><label>Tìm nội dung<input id="message-query" type="search" placeholder="Nhiệm vụ, file, kiểm thử hoặc vướng mắc"></label><label><input id="message-live" type="checkbox" checked>Theo tin mới</label></div><p id="conversation-error" role="alert"></p><p class="feed-caption" id="message-count" role="status"></p><div class="msg-feed" id="message-timeline" role="region" tabindex="0" aria-label="Lịch sử hội thoại"></div><button id="message-latest" type="button" hidden>Đến tin mới nhất</button><details id="message-system"><summary>Sự kiện hệ thống / điều khiển</summary><div class="msg-feed" id="message-events"></div></details></section><aside class="conversation-details" aria-label="Worker, nhiệm vụ và mức sử dụng"><h2>Nhóm đang làm gì</h2><div id="conversation-agents"></div></aside></div>';"""

new_html = """        el.innerHTML = '<div class="conversation-room"><nav class="conversation-nav" aria-label="Phiên làm việc"><h2>Phiên làm việc</h2><button type="button" id="conversation-switch">Tìm / đổi phiên</button><div id="conversation-sessions"></div></nav><section class="conversation-center" aria-labelledby="conversation-heading"><h1 id="conversation-heading">Hội thoại của nhóm</h1><div class="chat-agent-bar" id="conversation-agents" role="region" aria-label="Danh sách agents tham gia"></div><p class="feed-caption">Tin nhắn thật của worker AI và người điều hành. Chỉ xem; dùng @multiagents trong VS Code Chat để điều phối và xác nhận điều khiển.</p><div class="feed-toolbar"><label>Worker<select id="message-agent"><option value="">Tất cả worker</option></select></label><label>Tìm nội dung<input id="message-query" type="search" placeholder="Nhiệm vụ, file, kiểm thử hoặc vướng mắc"></label><label><input id="message-live" type="checkbox" checked>Theo tin mới</label></div><p id="conversation-error" role="alert"></p><p class="feed-caption" id="message-count" role="status"></p><div class="msg-feed" id="message-timeline" role="region" tabindex="0" aria-label="Lịch sử hội thoại"></div><button id="message-latest" type="button" hidden>Đến tin mới nhất</button><details id="message-system"><summary>Sự kiện hệ thống / điều khiển</summary><div class="msg-feed" id="message-events"></div></details></section></div>';"""

if old_html not in text:
    raise SystemExit("conversation innerHTML not found")
text = text.replace(old_html, new_html, 1)

old_info = """      const info=el.querySelector("#conversation-agents");
      const infoKey=JSON.stringify([state.slots,state.plan,Math.floor(Date.now()/60000)]);
      if(info.dataset.version!==infoKey) {
        const opened=new Set([...info.querySelectorAll("details[open]")].map(d=>d.dataset.slot));
        info.innerHTML=state.slots.map(slot=>'<section class="conversation-agent"><h3>' + esc(slot.display_name || 'Worker ' + slot.id) + ' · AI</h3><p>' + esc(slot.status) + ' · ' + esc(slot.task_state) + '</p><p>' + esc((state.plan?.items || []).filter(item=>item.assigned_to_slot===slot.id && item.status!=="done").map(item=>item.label).join("; ") || "Chưa có nhiệm vụ đang làm trong kế hoạch") + '</p><details data-slot="' + Number(slot.id) + '"><summary>Token và hạn mức provider</summary>' + renderUsage(slot) + '</details></section>').join("") || '<p>Phiên chưa có worker.</p>';
        info.querySelectorAll("details").forEach(d=>d.open=opened.has(d.dataset.slot));
        info.dataset.version=infoKey;
      }"""

new_info = """      const info=el.querySelector("#conversation-agents");
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

if old_info not in text:
    raise SystemExit("conversation agents render not found")
text = text.replace(old_info, new_info, 1)

old_usage = """    function renderUsage(slot) {
      const data = usageData(slot);
      const windows = Object.values(data?.quotas || {}).flatMap(bucket => [bucket.primary, bucket.secondary].filter(Boolean));
      const quotaHtml = [300, 10080].map(minutes => {
        const label = minutes === 300 ? "5 giờ" : "Hằng tuần";
        const matches = windows.filter(w => w.windowMinutes === minutes && Number.isFinite(w.usedPercent) && w.usedPercent >= 0 && w.usedPercent <= 100 && Number.isFinite(w.observedAt));
        if (!matches.length) return `<div class="usage-limit"><strong>${label}</strong><div class="usage-note">Provider chưa báo cáo</div></div>`;
        return matches.map((w, i) => {
          const remaining = Math.round((100 - w.usedPercent) * 10) / 10;
          const expired = Boolean(w.resetsAt && w.resetsAt <= Date.now());
          const stale = Date.now() - w.observedAt > 300000 || slot.status !== "connected" || expired;
          const windowLabel = `${label}${matches.length > 1 ? ` bucket ${i + 1}` : ""}`;
          return `<div class="usage-limit ${expired ? "expired" : remaining <= 20 ? "low" : ""}">
            <strong>${windowLabel}: ${remaining}% còn lại${stale ? " (báo cáo gần nhất)" : ""}</strong>
            <progress max="100" value="${remaining}" aria-label="${esc(windowLabel)} còn lại: ${remaining}%${stale ? ", báo cáo gần nhất" : ""}"></progress>
            <div class="usage-note">${w.usedPercent}% đã dùng. ${w.resetsAt ? `Đặt lại ${esc(new Date(w.resetsAt).toLocaleString())}${expired ? " - đang chờ cập nhật" : ""}` : "Chưa báo thời điểm đặt lại"}<br>Ghi nhận ${esc(new Date(w.observedAt).toLocaleString())}</div>
          </div>`;
        }).join("");
      }).join("");
      return `<section aria-label="Token và hạn mức provider">
        <dl class="usage-counters"><div><dt>Input</dt><dd>${tokenText(slot, "input_tokens")}</dd></div><div><dt>Cached input</dt><dd>${tokenText(slot, "cache_read_tokens")}</dd></div><div><dt>Output</dt><dd>${tokenText(slot, "output_tokens")}</dd></div></dl>
        <div class="usage-note">${data?.tokensObservedAt ? `Tổng đã ghi nhận; cached đã nằm trong input. Cập nhật ${esc(new Date(data.tokensObservedAt).toLocaleString())}.` : "Chưa nhận báo cáo token được hỗ trợ. Không phải số 0 đo được."}</div>
        ${quotaHtml}<p class="usage-note">Hạn mức provider/tài khoản có thể dùng chung với worker khác. Đây không phải ngân sách riêng của worker, không suy ra từ số token.</p>
      </section>`;
    }"""

new_usage = """    function renderUsage(slot) {
      const data = usageData(slot);
      return `<section aria-label="Token đã ghi nhận">
        <dl class="usage-counters"><div><dt>Input</dt><dd>${tokenText(slot, "input_tokens")}</dd></div><div><dt>Cached input</dt><dd>${tokenText(slot, "cache_read_tokens")}</dd></div><div><dt>Output</dt><dd>${tokenText(slot, "output_tokens")}</dd></div></dl>
        <div class="usage-note">${data?.tokensObservedAt ? `Tổng đã ghi nhận; cached đã nằm trong input. Cập nhật ${esc(new Date(data.tokensObservedAt).toLocaleString())}.` : "Chưa nhận báo cáo token được hỗ trợ. Không phải số 0 đo được."}</div>
      </section>`;
    }"""

if old_usage not in text:
    raise SystemExit("renderUsage not found")
text = text.replace(old_usage, new_usage, 1)

if text == orig:
    raise SystemExit("no changes")
p.write_text(text, encoding="utf-8", newline="\n")
print("patched dashboard/index.html", len(orig), "->", len(text))
print("agents_tab", 'data-tab="agents"' in text)
print("5h", "5 giờ" in text)
print("weekly", "Hằng tuần" in text)
print("chat-agent-bar", "chat-agent-bar" in text)
print("lang_vi", 'lang="vi"' in text)
print("panel-agents", "panel-agents" in text)
print("renderAgents", "renderAgents" in text)
print("conversation-agents", "conversation-agents" in text)
