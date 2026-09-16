from pathlib import Path

p = Path("dashboard/index.html")
text = p.read_text(encoding="utf-8")

old_css = """    .agent-pulse-dot {
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
    .agent-role { font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.03em; }"""

new_css = """    .agent-pulse-dot {
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
    .agent-model-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #111827;
      border: 1.5px solid #1F2A44;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #F8FAFC;
    }
    .agent-model-badge .model-svg { width: 10px; height: 10px; }
    .model-svg.icon-gemini { color: #60A5FA; }
    .model-svg.icon-codex { color: #10B981; }
    .model-svg.icon-grok { color: #F8FAFC; }
    .model-svg.icon-claude { color: #FB923C; }
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
    .agent-role-mini {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.04em;
      color: #94A3B8;
      background: #111827;
      border: 1px solid #1F2A44;
      padding: 1px 4px;
      border-radius: 4px;
      max-width: 64px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .agent-rail.expanded .agent-role-mini { display: none; }
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
    .agent-role-full { display: block; font-size: 11px; color: var(--text-dim); }
    .agent-model-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--text-dim);
      margin-top: 6px;
    }
    .agent-model-row .model-svg { width: 14px; height: 14px; }
    .model-badge-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 2px 8px;
      color: var(--text);
    }"""

if old_css not in text:
    raise SystemExit("CSS block not found")
text = text.replace(old_css, new_css, 1)

old_helpers = """        const initialsOf = name => {
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

new_helpers = r"""        const initialsOf = name => {
          const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
          if (!parts.length) return "AG";
          const letters = parts.slice(0, 2).map(part => Array.from(part)[0]).join("");
          return letters.toUpperCase();
        };
        const shortName = name => {
          const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
          if (parts.length >= 2) return parts[0] + " " + Array.from(parts[1])[0] + ".";
          return parts[0] || "Agent";
        };
        const roleMeta = role => {
          const raw = String(role || "").toLowerCase();
          if (/product owner|\bpo\b/.test(raw)) return { full: "Product Owner", mini: "PO" };
          if (/project manager|\bpm\b/.test(raw)) return { full: "Project Manager", mini: "PM" };
          if (/ui\/ux|designer/.test(raw)) return { full: "UI/UX Designer", mini: "Designer" };
          if (/qa/.test(raw)) return { full: "QA Engineer", mini: "QA" };
          if (/review/.test(raw)) return { full: "Code Reviewer", mini: "Reviewer" };
          if (/engineer|coder|software/.test(raw)) return { full: "Software Engineer", mini: "Coder" };
          return { full: role || "Agent", mini: (role || "Agent").slice(0, 8) };
        };
        const modelInfo = slot => {
          const raw = String(slot.model_selection?.model || slot.agent_type || "").toLowerCase();
          const label = slot.model_selection?.model || slot.agent_type || "AI";
          const gemini = '<svg class="model-svg icon-gemini" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C12 7.523 7.523 12 2 12C7.523 12 12 16.477 12 22C12 16.477 16.477 12 22 12C16.477 12 12 7.523 12 2Z"/></svg>';
          const openai = '<svg class="model-svg icon-codex" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a10 10 0 0 1 10 10c0 5.523-4.477 10-10 10S2 17.523 2 12"/><path d="M12 6a6 6 0 1 1-6 6"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>';
          const grok = '<svg class="model-svg icon-grok" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="4" x2="20" y2="20"/><line x1="15" y1="4" x2="20" y2="9"/><line x1="4" y1="15" x2="9" y2="20"/></svg>';
          const claude = '<svg class="model-svg icon-claude" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="12,2 15,9 22,12 15,15 12,22 9,15 2,12 9,9"/></svg>';
          const fallback = '<svg class="model-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
          if (raw.includes("gemini") || raw.startsWith("ag/") || raw.includes("google")) return { brand: "Gemini", icon: gemini, label };
          if (raw.includes("grok") || raw.includes("xai")) return { brand: "Grok", icon: grok, label };
          if (raw.includes("claude") || raw.includes("anthropic")) return { brand: "Claude", icon: claude, label };
          if (raw.includes("codex") || raw.includes("openai") || raw.includes("gpt") || raw.startsWith("cx/") || raw === "codex") return { brand: "OpenAI / Codex", icon: openai, label };
          return { brand: "AI", icon: fallback, label };
        };
        info.innerHTML=state.slots.map(slot=>{
          const name = slot.display_name || ("Worker " + slot.id);
          const role = roleMeta(slot.role || slot.agent_type || "Agent");
          const model = modelInfo(slot);
          const connected = slot.status === "connected";
          const wf = workflowMeta(slot.task_state);
          const task = (state.plan?.items || []).filter(item=>item.assigned_to_slot===slot.id && item.status!=="done").map(item=>item.label).join("; ");
          const title = name + " · " + role.full + " · " + model.brand + " · " + statusLabel(slot.status) + " · " + wf.label + (task ? " · " + task : "");
          return '<div class="agent-rail-card" role="listitem" tabindex="0" data-slot="' + Number(slot.id) + '" title="' + esc(title) + '"><div class="agent-collapsed-identity"><div class="agent-avatar-wrap"><span class="agent-initials">' + esc(initialsOf(name)) + '</span><span class="agent-model-badge" title="' + esc(model.brand) + '">' + model.icon + '</span><span class="agent-pulse-dot ' + (connected ? "dot-connected" : "dot-disconnected") + '" aria-label="' + esc(statusLabel(slot.status)) + '"></span></div><span class="agent-name-collapsed">' + esc(shortName(name)) + '</span><span class="agent-role-mini">' + esc(role.mini) + '</span><span class="workflow-mini-pill badge ' + wf.cls + '">' + esc(wf.mini) + '</span></div><div class="agent-expanded-content"><div class="agent-identity-row"><div><strong class="agent-full-name">' + esc(name) + '</strong><span class="agent-role-full">' + esc(role.full) + '</span></div><span class="badge ' + wf.cls + '">' + esc(wf.label) + '</span></div><div class="agent-model-row"><span>Model:</span><span class="model-badge-chip">' + model.icon + '<span>' + esc(model.brand) + '</span></span></div><div class="agent-rail-details"><div class="token-grid"><div class="token-col"><dt>Input</dt><dd>' + tokenText(slot, "input_tokens") + '</dd></div><div class="token-col"><dt>Cached</dt><dd>' + tokenText(slot, "cache_read_tokens") + '</dd></div><div class="token-col"><dt>Output</dt><dd>' + tokenText(slot, "output_tokens") + '</dd></div></div><div class="agent-task-desc">' + esc(task || "Chưa có nhiệm vụ đang làm trong kế hoạch") + '</div></div></div></div>';
        }).join("") || '<p>Phiên chưa có worker.</p>';"""

# The file uses real regex \s not escaped \\s in JS source. Read actual snippet.
start = text.find("        const initialsOf = name => {")
end = text.find("        info.dataset.version=infoKey;")
if start < 0 or end < 0:
    raise SystemExit(f"helper markers missing {start} {end}")
text = text[:start] + new_helpers + "\n" + text[end:]

p.write_text(text, encoding="utf-8", newline="\n")
print("agent-model-badge", "agent-model-badge" in text)
print("agent-role-full", "agent-role-full" in text)
print("Software Engineer", "Software Engineer" in text)
print("icon-gemini", "icon-gemini" in text)
print("icon-grok", "icon-grok" in text)
print("conversation-agents", 'id="conversation-agents"' in text)
print("5h", "5 giờ" in text)
