(() => {
  "use strict";

  const panel = document.getElementById("panel-studio");
  const studioTab = document.querySelector('[data-tab="studio"]');
  if (!panel || !studioTab) return;

  const ui = {
    loaded: false,
    loading: false,
    section: "teams",
    view: "graph",
    search: "",
    selectedAgentId: "",
    selectedTeamId: "",
    selectedProviderId: "",
    data: null,
    error: "",
    notice: "",
    noticeType: "",
    runPreview: null,
    importPreview: null,
    dialogReturnFocus: null,
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[char]);
  }

  function slug(value, prefix) {
    const clean = String(value ?? "").trim().toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
    return clean || `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }

  function clone(value) { return structuredClone(value); }
  function library() { return ui.data?.library ?? { version: 1, agents: [], teams: [] }; }
  function providers() { return ui.data?.providers ?? []; }
  function agentsById() { return new Map(library().agents.map(agent => [agent.id, agent])); }
  function currentTeam() { return library().teams.find(team => team.id === ui.selectedTeamId) ?? null; }
  function currentAgent() { return library().agents.find(agent => agent.id === ui.selectedAgentId) ?? null; }
  function currentProvider() { return providers().find(provider => provider.id === ui.selectedProviderId) ?? null; }

  function setNotice(message, type = "") {
    ui.notice = message;
    ui.noticeType = type;
    renderStudio();
  }

  async function request(path, options = {}) {
    const method = options.method ?? "GET";
    const headers = { Accept: "application/json", ...(options.headers ?? {}) };
    if (method !== "GET") {
      headers["Content-Type"] = "application/json";
      if (ui.data?.csrfToken) headers["X-Studio-CSRF"] = ui.data.csrfToken;
    }
    const response = await fetch(path, { ...options, method, headers });
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error(`Studio returned an unreadable response (${response.status}).`); }
    if (!response.ok || payload?.ok !== true) {
      const error = new Error(payload?.error?.message || `Studio request failed (${response.status}).`);
      error.code = payload?.error?.code;
      throw error;
    }
    return payload.data;
  }

  async function loadStudio({ announce = false } = {}) {
    if (ui.loading) return;
    ui.loading = true;
    ui.error = "";
    renderStudio();
    try {
      ui.data = await request("/api/studio");
      ui.loaded = true;
      const dataLibrary = library();
      if (!ui.selectedTeamId || !dataLibrary.teams.some(team => team.id === ui.selectedTeamId)) {
        ui.selectedTeamId = dataLibrary.teams[0]?.id ?? "";
      }
      if (!ui.selectedAgentId || !dataLibrary.agents.some(agent => agent.id === ui.selectedAgentId)) {
        ui.selectedAgentId = dataLibrary.agents[0]?.id ?? "";
      }
      if (!ui.selectedProviderId || !providers().some(provider => provider.id === ui.selectedProviderId)) {
        ui.selectedProviderId = providers()[0]?.id ?? "";
      }
      if (announce) ui.notice = "Studio configuration refreshed.";
    } catch (error) {
      ui.error = error.message;
    } finally {
      ui.loading = false;
      renderStudio();
    }
  }

  async function saveLibrary(nextLibrary, successMessage) {
    try {
      await request("/api/studio/library", {
        method: "PUT",
        body: JSON.stringify({ schemaVersion: 1, baseRevision: ui.data.revision, library: nextLibrary }),
      });
      await loadStudio();
      setNotice(successMessage, "success");
    } catch (error) {
      if (error.code === "STALE_REVISION") await loadStudio();
      setNotice(error.message, "error");
    }
  }

  async function saveProviders(nextProviders, successMessage) {
    try {
      await request("/api/studio/providers", {
        method: "PUT",
        body: JSON.stringify({ baseRevision: ui.data.revision, providers: nextProviders }),
      });
      await loadStudio();
      setNotice(successMessage, "success");
    } catch (error) {
      if (error.code === "STALE_REVISION") await loadStudio();
      setNotice(error.message, "error");
    }
  }

  function readinessFor(agent) {
    if (agent?.runtime !== "codex") return { label: "Runtime unavailable", className: "blocked", detail: "Studio launches currently support explicitly configured Codex workers only." };
    if (!agent?.modelRef) return { label: "Needs model mapping", className: "blocked", detail: "Choose a local provider and model." };
    const provider = providers().find(item => item.id === agent.modelRef.providerId);
    if (!provider) return { label: "Provider unavailable", className: "blocked", detail: "Remap this agent to a provider on this machine." };
    const model = provider.models?.find(item => item.id === agent.modelRef.modelId);
    if (!model) return { label: "Model unavailable", className: "blocked", detail: "Remap this agent to an available model." };
    const status = ui.data?.readiness?.find(item => item.providerId === provider.id);
    if (!status?.credentialPresent) return { label: "Needs credential", className: "setup", detail: "Enter a key securely on this machine." };
    const modelStatus = status.models?.find(item => item.modelId === model.id);
    if (modelStatus && modelStatus.ready === false) return { label: "Not ready", className: "blocked", detail: modelStatus.reason || "Provider configuration is incomplete." };
    if (status.connectionVerified) return { label: "Connection verified", className: "verified", detail: "Verified only after an explicit user-authorized test." };
    return { label: "Credential present", className: "ready", detail: "Connection has not been tested." };
  }

  function validateTeam(team, { execution = false } = {}) {
    if (!team) return [{ severity: "error", message: "Choose a team template." }];
    const issues = [];
    const memberIds = new Set();
    const agentIds = new Set();
    for (const member of team.members ?? []) {
      if (memberIds.has(member.id)) issues.push({ severity: "error", message: `Duplicate member ID: ${member.id}` });
      memberIds.add(member.id);
      if (agentIds.has(member.agentId)) issues.push({ severity: "error", message: `Agent ${member.agentId} is already in this team.` });
      agentIds.add(member.agentId);
      if (member.reportsTo === member.id) issues.push({ severity: "error", message: `${member.id} cannot report to itself.` });
    }
    if (!team.members?.length) issues.push({ severity: execution ? "error" : "warning", message: "Add at least one named agent." });
    if (!memberIds.has(team.managerId)) issues.push({ severity: execution ? "error" : "warning", message: "Choose one team manager." });
    for (const member of team.members ?? []) {
      if (member.reportsTo && !memberIds.has(member.reportsTo)) issues.push({ severity: "error", message: `${member.id} reports to a missing member.` });
      if (member.id === team.managerId && member.reportsTo) issues.push({ severity: "error", message: "The manager cannot report to another member." });
      if (execution && member.id !== team.managerId && !member.reportsTo) issues.push({ severity: "error", message: `${member.id} needs a reporting relationship.` });
      const seen = new Set();
      let cursor = member.id;
      while (cursor) {
        if (seen.has(cursor)) { issues.push({ severity: "error", message: `Reporting cycle includes ${cursor}.` }); break; }
        seen.add(cursor);
        cursor = team.members.find(item => item.id === cursor)?.reportsTo;
      }
      if (execution) {
        const agent = agentsById().get(member.agentId);
        if (!agent) issues.push({ severity: "error", message: `Member ${member.id} references a missing agent.` });
        else if (readinessFor(agent).className !== "ready" && readinessFor(agent).className !== "verified") {
          issues.push({ severity: "error", message: `${agent.displayName}: ${readinessFor(agent).label}.` });
        }
      }
    }
    return issues.filter((issue, index, all) => all.findIndex(candidate => candidate.message === issue.message) === index);
  }

  function statusChip(agent) {
    const readiness = readinessFor(agent);
    return `<span class="studio-chip ${readiness.className}" title="${escapeHtml(readiness.detail)}">${escapeHtml(readiness.label)}</span>`;
  }

  function filteredAgents() {
    const query = ui.search.trim().toLowerCase();
    return library().agents.filter(agent => !query || `${agent.displayName} ${agent.role} ${agent.runtime} ${agent.id}`.toLowerCase().includes(query));
  }

  function filteredTeams() {
    const query = ui.search.trim().toLowerCase();
    return library().teams.filter(team => !query || `${team.name} ${team.description ?? ""} ${team.id}`.toLowerCase().includes(query));
  }

  function filteredProviders() {
    const query = ui.search.trim().toLowerCase();
    return providers().filter(provider => !query || `${provider.name} ${provider.protocol} ${provider.id}`.toLowerCase().includes(query));
  }

  function credentialDetail(provider) {
    if (!provider) return emptyState("Select a provider", "Choose a provider to add or clear its API key.", "new-provider", "Add provider");
    const status = ui.data?.readiness?.find(item => item.providerId === provider.id);
    return `<div class="studio-pane-header"><div><span class="studio-eyebrow">Local secret</span><h2>${escapeHtml(provider.name)}</h2></div></div>
      <div class="studio-pane-body"><dl class="studio-definition"><dt>Provider</dt><dd>${escapeHtml(provider.id)}</dd><dt>Environment reference</dt><dd>${escapeHtml(provider.envKeyRef ?? "Derived at runtime")}</dd><dt>Status</dt><dd>${status?.credentialPresent ? "Stored in memory" : "Not configured"}</dd></dl>
      <div class="studio-inline-actions" style="margin-top:14px"><button class="studio-button cyan" data-action="credential">${status?.credentialPresent ? "Replace API key" : "Add API key"}</button>${status?.credentialPresent ? '<button class="studio-button danger" data-action="clear-credential">Clear key</button>' : ""}</div>
      <p class="studio-field-hint" style="margin-top:14px">Keys never enter provider metadata, exports, browser storage, or disk. Restarting the dashboard clears them.</p></div>`;
  }

  function navigationBody() {
    if (ui.loading && !ui.loaded) return `<div class="studio-loading" aria-busy="true"><div class="studio-skeleton"></div><div class="studio-skeleton"></div><div class="studio-skeleton"></div></div>`;
    if (ui.error && !ui.loaded) return `<div class="studio-empty"><strong>Studio is unavailable</strong><span>${escapeHtml(ui.error)}</span><button class="studio-button" data-action="reload">Try again</button></div>`;

    if (ui.section === "agents") {
      const rows = filteredAgents().map(agent => `<li><button class="studio-card ${agent.id === ui.selectedAgentId ? "selected" : ""}" data-select-agent="${escapeHtml(agent.id)}">
        <span class="studio-card-name"><span>${escapeHtml(agent.displayName)}</span><span class="studio-card-id">${escapeHtml(agent.id)}</span></span>
        <span class="studio-card-meta">${escapeHtml(agent.role)} · ${escapeHtml(agent.runtime)}</span>${statusChip(agent)}</button></li>`).join("");
      return rows ? `<ul class="studio-list">${rows}</ul>` : emptyState("No named agents", "Create an agent definition before composing a team.", "new-agent", "Create agent");
    }
    if (ui.section === "providers" || ui.section === "credentials") {
      const readiness = new Map((ui.data?.readiness ?? []).map(item => [item.providerId, item]));
      const rows = filteredProviders().map(provider => {
        const status = readiness.get(provider.id);
        const label = status?.credentialPresent ? "Credential present" : status?.discovered ? "Discovered · needs credential" : "Configured · needs credential";
        return `<li><button class="studio-card ${provider.id === ui.selectedProviderId ? "selected" : ""}" data-select-provider="${escapeHtml(provider.id)}">
          <span class="studio-card-name"><span>${escapeHtml(provider.name)}</span><span class="studio-card-id">${escapeHtml(provider.id)}</span></span>
          <span class="studio-card-meta">${escapeHtml(provider.protocol)} · ${provider.models?.length ?? 0} model(s)</span>
          <span class="studio-chip ${status?.credentialPresent ? "ready" : status?.discovered ? "discovered" : "configured"}">${escapeHtml(label)}</span></button></li>`;
      }).join("");
      return rows ? `<ul class="studio-list">${rows}</ul>` : `<div class="studio-empty"><strong>No providers configured</strong><span>Import catalog metadata or define a provider for this machine.</span><div class="studio-inline-actions"><button class="studio-button" data-action="catalog">Import catalog</button><button class="studio-button" data-action="new-provider">Add provider</button></div></div>`;
    }
    const rows = filteredTeams().map(team => {
      const issues = validateTeam(team);
      return `<li><button class="studio-card ${team.id === ui.selectedTeamId ? "selected" : ""}" data-select-team="${escapeHtml(team.id)}">
        <span class="studio-card-name"><span>${escapeHtml(team.name)}</span><span class="studio-card-id">${escapeHtml(team.id)}</span></span>
        <span class="studio-card-meta">Template · ${team.members?.length ?? 0} named member(s)</span>
        <span class="studio-chip ${issues.some(issue => issue.severity === "error") ? "blocked" : issues.length ? "setup" : "ready"}">${issues.length ? `${issues.length} draft issue(s)` : "Draft ready"}</span></button></li>`;
    }).join("");
    return rows ? `<ul class="studio-list">${rows}</ul>` : emptyState("No team templates", "Create a reusable draft. Saving never launches workers.", "new-team", "Create template");
  }

  function emptyState(title, body, action, label) {
    return `<div class="studio-empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span><button class="studio-button" data-action="${action}">${escapeHtml(label)}</button></div>`;
  }

  function agentDetail(agent) {
    if (!agent) return emptyState("Select an agent", "Inspect its role, runtime, model mapping, and local readiness.", "new-agent", "Create agent");
    const provider = providers().find(item => item.id === agent.modelRef?.providerId);
    const model = provider?.models?.find(item => item.id === agent.modelRef?.modelId);
    return `<div class="studio-pane-header"><div><span class="studio-eyebrow">Reusable agent</span><h2>${escapeHtml(agent.displayName)}</h2></div><button class="studio-button small" data-action="edit-agent">Edit</button></div>
      <div class="studio-pane-body"><dl class="studio-definition">
        <dt>Stable ID</dt><dd>${escapeHtml(agent.id)}</dd><dt>Role</dt><dd>${escapeHtml(agent.role)}</dd><dt>Runtime</dt><dd>${escapeHtml(agent.runtime)}</dd>
        <dt>Provider</dt><dd>${escapeHtml(provider?.name ?? "Not mapped")}</dd><dt>Model</dt><dd>${escapeHtml(model?.name ?? agent.modelRef?.modelId ?? "Not mapped")}</dd>
      </dl><p class="studio-card-meta" style="margin-top:14px">${escapeHtml(agent.description)}</p></div>`;
  }

  function providerDetail(provider) {
    if (!provider) return emptyState("Select a provider", "Inspect configuration and enter this machine's credential securely.", "new-provider", "Add provider");
    const status = ui.data.readiness?.find(item => item.providerId === provider.id);
    const stateLabel = status?.connectionVerified ? "Connection verified" : status?.credentialPresent ? "Credential present · not tested" : status?.discovered ? "Discovered metadata · key required" : "Configured metadata · key required";
    const models = provider.models?.map(model => `<li class="studio-issue"><strong>${escapeHtml(model.name)}</strong><br>${escapeHtml(model.id)}${model.capabilities?.toolCalling ? " · tools declared" : " · tools not declared"}</li>`).join("") || "";
    return `<div class="studio-pane-header"><div><span class="studio-eyebrow">Local provider</span><h2>${escapeHtml(provider.name)}</h2></div><div class="studio-inline-actions"><button class="studio-button small" data-action="catalog">Import catalog</button><button class="studio-button small" data-action="edit-provider">Edit</button></div></div>
      <div class="studio-pane-body"><dl class="studio-definition"><dt>ID</dt><dd>${escapeHtml(provider.id)}</dd><dt>Protocol</dt><dd>${escapeHtml(provider.protocol)}</dd><dt>Base URL</dt><dd>${escapeHtml(provider.baseUrl)}</dd><dt>Readiness</dt><dd>${escapeHtml(stateLabel)}</dd></dl>
      <div class="studio-inline-actions" style="margin-top:14px"><button class="studio-button" data-action="credential">${status?.credentialPresent ? "Replace key" : "Enter API key"}</button>${status?.credentialPresent ? '<button class="studio-button danger" data-action="clear-credential">Clear key</button>' : ""}</div>
      <h3 style="margin:18px 0 8px">Models</h3><ul class="studio-issues">${models || '<li class="studio-issue">No models configured.</li>'}</ul></div>`;
  }

  function memberRow(team, member) {
    const agent = agentsById().get(member.agentId);
    const options = team.members.filter(candidate => candidate.id !== member.id).map(candidate => {
      const target = agentsById().get(candidate.agentId);
      return `<option value="${escapeHtml(candidate.id)}" ${member.reportsTo === candidate.id ? "selected" : ""}>${escapeHtml(target?.displayName ?? candidate.id)}</option>`;
    }).join("");
    return `<li class="studio-member-row" data-member-id="${escapeHtml(member.id)}">
      <div class="studio-member-identity"><strong>${escapeHtml(agent?.displayName ?? "Missing agent")}</strong><span>${escapeHtml(agent?.role ?? member.agentId)} · ${escapeHtml(member.id)}</span></div>
      <label class="studio-field">Reports to<select data-action="reports-to" ${member.id === team.managerId ? "disabled" : ""}><option value="">Unassigned</option>${options}</select></label>
      <div class="studio-inline-actions"><button class="studio-button small" data-action="set-manager" ${member.id === team.managerId ? "disabled" : ""}>${member.id === team.managerId ? "Manager" : "Set manager"}</button><button class="studio-button small danger" data-action="remove-member" aria-label="Remove ${escapeHtml(agent?.displayName ?? member.id)}">Remove</button></div>
    </li>`;
  }

  function treeNode(team, member, seen = new Set()) {
    const agent = agentsById().get(member.agentId);
    if (seen.has(member.id)) return `<li><div class="studio-node"><div class="studio-node-role">Cycle</div><div class="studio-node-name">${escapeHtml(member.id)}</div></div></li>`;
    const nextSeen = new Set(seen).add(member.id);
    const children = team.members.filter(candidate => candidate.reportsTo === member.id && candidate.id !== member.id);
    return `<li><div class="studio-node ${member.id === team.managerId ? "manager" : ""}" tabindex="0">
      <div class="studio-node-role">${member.id === team.managerId ? "Manager" : escapeHtml(agent?.role ?? "Member")}</div>
      <div class="studio-node-name">${escapeHtml(agent?.displayName ?? "Missing agent")}</div>
      <div class="studio-node-model">${escapeHtml(agent?.runtime ?? "unknown")} · ${escapeHtml(agent?.modelRef ? `${agent.modelRef.providerId}/${agent.modelRef.modelId}` : "model not mapped")}</div>
      ${member.task ? `<div class="studio-node-task">${escapeHtml(member.task)}</div>` : ""}</div>
      ${children.length ? `<ul>${children.map(child => treeNode(team, child, nextSeen)).join("")}</ul>` : ""}</li>`;
  }

  function teamCanvas(team) {
    if (!team) return emptyState("Choose a template", "Select or create a team template to edit its topology.", "new-team", "Create template");
    const manager = team.members.find(member => member.id === team.managerId);
    const issues = validateTeam(team);
    const graph = manager ? `<ul class="studio-tree">${treeNode(team, manager)}</ul>` : `<div class="studio-empty"><strong>No manager selected</strong><span>Add named members and choose the manager.</span></div>`;
    const memberList = team.members.map(member => memberRow(team, member)).join("");
    return `<div class="studio-canvas-toolbar"><div><span class="studio-eyebrow">Template, not a session</span><h2>${escapeHtml(team.name)}</h2></div>
      <div class="studio-inline-actions"><button class="studio-button small" data-action="add-member">Add named agent</button><button class="studio-button small" data-action="edit-team">Edit details</button></div></div>
      <div class="studio-canvas" ${ui.view === "list" ? "hidden" : ""} aria-label="Reporting graph for ${escapeHtml(team.name)}">${graph}</div>
      <ul class="studio-member-list" ${ui.view === "graph" ? "hidden" : ""} aria-label="Named members and reporting relationships">${memberList || '<li class="studio-empty">No members in this draft.</li>'}</ul>
      ${issues.length ? `<div class="studio-pane-body"><ul class="studio-issues">${issues.map(issue => `<li class="studio-issue ${issue.severity}">${escapeHtml(issue.message)}</li>`).join("")}</ul></div>` : ""}`;
  }

  function teamInspector(team) {
    if (!team) return `<div class="studio-pane-body">${emptyState("Nothing selected", "Select a team template to review readiness.", "new-team", "Create template")}</div>`;
    const issues = validateTeam(team, { execution: true });
    const manager = team.members.find(member => member.id === team.managerId);
    const managerAgent = manager ? agentsById().get(manager.agentId) : null;
    return `<div class="studio-pane-body">
      <div class="studio-inspector-section"><h3>Template identity</h3><dl class="studio-definition"><dt>Name</dt><dd>${escapeHtml(team.name)}</dd><dt>Stable ID</dt><dd>${escapeHtml(team.id)}</dd><dt>Manager</dt><dd>${escapeHtml(managerAgent?.displayName ?? "Not selected")}</dd><dt>Members</dt><dd>${team.members.length}</dd></dl></div>
      <div class="studio-inspector-section"><h3>Execution readiness</h3>${issues.length ? `<ul class="studio-issues">${issues.map(issue => `<li class="studio-issue ${issue.severity}">${escapeHtml(issue.message)}</li>`).join("")}</ul>` : '<span class="studio-chip ready">Ready for preview</span>'}</div>
      <div class="studio-inspector-section"><h3>Run boundary</h3><p class="studio-card-meta">Saving or editing never launches workers. A run requires target, task, roster and provider-fee review.</p><button class="studio-button primary" data-action="open-run" ${issues.some(issue => issue.severity === "error") ? "disabled" : ""}>Review a new run</button></div>
    </div>`;
  }

  function renderStudio() {
    const focusKey = document.activeElement?.dataset?.focusKey;
    const selectedTeam = currentTeam();
    const count = library().teams.length;
    document.getElementById("badge-studio").textContent = count ? String(count) : "new";
    const detail = ui.section === "agents" ? agentDetail(currentAgent()) : ui.section === "providers" ? providerDetail(currentProvider()) : ui.section === "credentials" ? credentialDetail(currentProvider()) : teamCanvas(selectedTeam);
    const createAction = ui.section === "agents" ? "new-agent" : ui.section === "providers" ? "new-provider" : "new-team";
    const createLabel = ui.section === "agents" ? "New agent" : ui.section === "providers" ? "Add provider" : "New template";
    panel.innerHTML = `<section class="studio-shell" aria-busy="${ui.loading}">
      <header class="studio-hero"><div><span class="studio-eyebrow">Reusable workflow design</span><h1 id="studio-title">Team Studio</h1><p>Compose named agent definitions into portable team templates. Templates are configuration; live sessions remain in the monitoring tabs.</p></div>
        <div class="studio-actions"><button class="studio-button" data-action="refresh">Refresh</button><button class="studio-button" data-action="import">Import config</button><button class="studio-button" data-action="export">Export config</button><button class="studio-button cyan" data-action="${createAction}">${createLabel}</button></div></header>
      <div class="studio-statusbar ${ui.error || ui.noticeType === "error" ? "error" : ui.noticeType === "success" ? "success" : ""}"><span role="status" aria-live="polite">${escapeHtml(ui.error || ui.notice || (ui.data ? `Revision ${ui.data.revision.slice(0, 10)} · secrets stay on this machine` : "Loading Studio configuration..."))}</span><span>${ui.data?.credentialStorage === "memory" ? "Credentials: memory only" : ""}</span></div>
      <div class="studio-workspace">
        <aside class="studio-pane studio-library"><div class="studio-pane-header"><h2>Library</h2><div class="studio-segmented" aria-label="Library section">
          ${["teams", "agents", "providers", "credentials"].map(section => `<button type="button" data-section="${section}" aria-pressed="${ui.section === section}">${section[0].toUpperCase() + section.slice(1)}</button>`).join("")}</div></div>
          <div class="studio-pane-body studio-scroll"><label class="studio-field studio-search">Search ${escapeHtml(ui.section)}<input type="search" value="${escapeHtml(ui.search)}" data-action="search" data-focus-key="studio-search"></label>${navigationBody()}</div></aside>
        <main class="studio-pane studio-topology"><div class="studio-pane-header"><h2>${ui.section === "teams" ? "Topology" : ui.section === "credentials" ? "Credentials" : "Details"}</h2>${ui.section === "teams" ? `<div class="studio-segmented" aria-label="Topology view"><button type="button" data-view="graph" aria-pressed="${ui.view === "graph"}">Graph</button><button type="button" data-view="list" aria-pressed="${ui.view === "list"}">List</button></div>` : ""}</div><div class="studio-canvas-wrap">${detail}</div></main>
        <aside class="studio-pane studio-inspector"><div class="studio-pane-header"><h2>Readiness</h2></div>${ui.section === "teams" ? teamInspector(selectedTeam) : `<div class="studio-pane-body"><p class="studio-card-meta">${ui.section === "agents" ? "Agent identity is reusable. Model and credential readiness are local to this machine." : "Metadata availability, credentials and connection verification are separate states."}</p></div>`}</aside>
      </div><div id="studio-dialog-root"></div></section>`;
    if (focusKey) panel.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
  }

  function dialogMarkup(title, description, body, footer) {
    return `<dialog class="studio-dialog"><div class="studio-dialog-header"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div><button class="studio-button ghost studio-dialog-close" type="button" data-dialog-close aria-label="Close dialog">×</button></div><div class="studio-dialog-body">${body}</div><div class="studio-dialog-footer">${footer}</div></dialog>`;
  }

  function openDialog(html, trigger = document.activeElement) {
    ui.dialogReturnFocus = trigger;
    const root = document.getElementById("studio-dialog-root");
    root.innerHTML = html;
    const dialog = root.querySelector("dialog");
    dialog.addEventListener("close", () => { ui.dialogReturnFocus?.focus?.(); root.innerHTML = ""; });
    dialog.showModal();
    const initialFocus = dialog.querySelector(".studio-dialog-body")?.querySelector("input,select,textarea,button") ?? dialog.querySelector(".studio-dialog-close");
    initialFocus?.focus();
  }

  function closeDialog() { document.querySelector(".studio-dialog[open]")?.close(); }

  function agentDialog(agent) {
    const selectedProvider = agent?.modelRef?.providerId ?? "";
    const selectedModel = agent?.modelRef?.modelId ?? "";
    const providerOptions = providers().map(provider => `<option value="${escapeHtml(provider.id)}" ${selectedProvider === provider.id ? "selected" : ""}>${escapeHtml(provider.name)}</option>`).join("");
    const modelOptions = providers().flatMap(provider => provider.models.map(model => `<option data-provider="${escapeHtml(provider.id)}" value="${escapeHtml(`${provider.id}::${model.id}`)}" ${selectedProvider === provider.id && selectedModel === model.id ? "selected" : ""}>${escapeHtml(provider.name)} / ${escapeHtml(model.name)}</option>`)).join("");
    return dialogMarkup(agent ? "Edit named agent" : "Create named agent", "Identity is reusable; provider credentials are never stored here.", `<form id="studio-agent-form" class="studio-form-grid" data-original-id="${escapeHtml(agent?.id)}">
      <label class="studio-field">Display name<input name="displayName" required value="${escapeHtml(agent?.displayName)}"></label>
      <label class="studio-field">Stable ID<input name="id" required pattern="[A-Za-z0-9_.-]+" value="${escapeHtml(agent?.id)}" ${agent ? "readonly" : ""}></label>
      <label class="studio-field">Role<input name="role" required value="${escapeHtml(agent?.role)}"></label>
      <label class="studio-field">Runtime<select name="runtime"><option value="codex" ${agent?.runtime === "codex" ? "selected" : ""}>Codex</option><option value="claude" ${agent?.runtime === "claude" ? "selected" : ""}>Claude</option><option value="gemini" ${agent?.runtime === "gemini" ? "selected" : ""}>Gemini</option></select></label>
      <label class="studio-field wide">Description<textarea name="description" required>${escapeHtml(agent?.description)}</textarea></label>
      <label class="studio-field wide">Provider / model<select name="model"><option value="">Not mapped yet</option>${modelOptions}</select><span class="studio-field-hint">Unresolved mappings are allowed in drafts and block run preview.</span></label>
      ${providerOptions ? "" : '<p class="studio-field-hint wide">No local provider metadata is available yet.</p>'}
    </form>`, `${agent ? '<button class="studio-button danger" data-action="delete-agent">Delete agent</button>' : ""}<button class="studio-button" data-dialog-close>Cancel</button><button class="studio-button primary" data-submit-form="studio-agent-form">Save agent</button>`);
  }

  function teamDialog(team) {
    return dialogMarkup(team ? "Edit template details" : "Create team template", "This saves reusable configuration and does not launch a session.", `<form id="studio-team-form" class="studio-form-grid" data-original-id="${escapeHtml(team?.id)}"><label class="studio-field">Template name<input name="name" required value="${escapeHtml(team?.name)}"></label><label class="studio-field">Stable ID<input name="id" required pattern="[A-Za-z0-9_.-]+" value="${escapeHtml(team?.id)}" ${team ? "readonly" : ""}></label><label class="studio-field wide">Description<textarea name="description">${escapeHtml(team?.description)}</textarea></label></form>`, `${team ? '<button class="studio-button danger" data-action="delete-team">Delete template</button>' : ""}<button class="studio-button" data-dialog-close>Cancel</button><button class="studio-button primary" data-submit-form="studio-team-form">Save draft</button>`);
  }

  function providerDialog(provider) {
    const models = provider?.models?.map(model => `${model.id} | ${model.name} | ${model.capabilities?.toolCalling ? "tools" : ""}`).join("\n") ?? "";
    return dialogMarkup(provider ? "Edit provider metadata" : "Add provider metadata", "Configuration only. Saving metadata never tests a connection.", `<form id="studio-provider-form" class="studio-form-grid" data-original-id="${escapeHtml(provider?.id)}">
      <label class="studio-field">Provider name<input name="name" required value="${escapeHtml(provider?.name)}"></label><label class="studio-field">Stable ID<input name="id" required pattern="[A-Za-z0-9_.-]+" value="${escapeHtml(provider?.id)}" ${provider ? "readonly" : ""}></label>
      <label class="studio-field">Protocol<select name="protocol">${["responses","openai","anthropic","ollama","custom"].map(protocol => `<option value="${protocol}" ${provider?.protocol === protocol ? "selected" : ""}>${protocol}</option>`).join("")}</select></label>
      <label class="studio-field">Environment key reference<input name="envKeyRef" value="${escapeHtml(provider?.envKeyRef)}" placeholder="MY_PROVIDER_API_KEY"></label>
      <label class="studio-field wide">Base URL<input name="baseUrl" type="url" required value="${escapeHtml(provider?.baseUrl)}" placeholder="https://provider.example/v1"></label>
      <label class="studio-field wide">Models<textarea name="models" required placeholder="model-id | Model name | tools">${escapeHtml(models)}</textarea><span class="studio-field-hint">One per line. Add “tools” only when tool calling is declared; declarations are not verification.</span></label>
    </form>`, `${provider ? '<button class="studio-button danger" data-action="delete-provider">Delete provider</button>' : ""}<button class="studio-button" data-dialog-close>Cancel</button><button class="studio-button primary" data-submit-form="studio-provider-form">Save metadata</button>`);
  }

  function addMemberDialog(team) {
    const used = new Set(team.members.map(member => member.agentId));
    const options = library().agents.filter(agent => !used.has(agent.id)).map(agent => `<option value="${escapeHtml(agent.id)}">${escapeHtml(agent.displayName)} — ${escapeHtml(agent.role)} (${escapeHtml(agent.runtime)})</option>`).join("");
    return dialogMarkup("Add named agent", "Select an existing reusable identity. A new isolated worker is created only when a run is confirmed.", options ? `<form id="studio-member-form"><label class="studio-field">Agent identity<select name="agentId" required>${options}</select></label></form>` : `<div class="studio-alert">Every available agent is already in this team. Duplicate identities are not allowed.</div>`, `<button class="studio-button" data-dialog-close>Cancel</button>${options ? '<button class="studio-button primary" data-submit-form="studio-member-form">Add member</button>' : ""}`);
  }

  function credentialDialog(provider) {
    return dialogMarkup(`Enter key for ${provider.name}`, "Stored in server memory only. The value is cleared from this form immediately and must be re-entered after restart.", `<div class="studio-alert">Do not paste API keys into chat, templates, catalog files, or exports.</div><form id="studio-credential-form"><label class="studio-field">API key<input type="password" name="apiKey" required autocomplete="new-password" aria-describedby="credential-note"><span id="credential-note" class="studio-field-hint">This action does not test the connection or incur provider charges.</span></label></form>`, `<button class="studio-button" data-dialog-close>Cancel</button><button class="studio-button primary" data-submit-form="studio-credential-form">Store for this process</button>`);
  }

  function importDialog() {
    return dialogMarkup("Import portable configuration", "Preview a secret-free JSON bundle before applying it.", `<form id="studio-import-form"><label class="studio-field">Configuration file<input type="file" name="bundle" accept="application/json,.json" required><span class="studio-field-hint">Sessions, credentials and machine-specific runtime state are never restored.</span></label></form>`, `<button class="studio-button" data-dialog-close>Cancel</button><button class="studio-button primary" data-submit-form="studio-import-form">Preview import</button>`);
  }

  function catalogDialog() {
    return dialogMarkup("Import provider metadata", "Use a validated local catalog path. This imports metadata only, not credentials or subscriptions.", `<form id="studio-catalog-form"><label class="studio-field">Catalog path<input name="catalogPath" required placeholder="C:\\path\\to\\chatLanguageModels.json"><span class="studio-field-hint">File existence does not mean credentials or connectivity are ready.</span></label></form>`, `<button class="studio-button" data-dialog-close>Cancel</button><button class="studio-button primary" data-submit-form="studio-catalog-form">Import metadata</button>`);
  }

  function runDialog(team) {
    const issues = validateTeam(team, { execution: true });
    return dialogMarkup(`Review a new run: ${team.name}`, "A saved template is not a live session. Preview target, task, roster and possible provider fees before launching.", `<div class="studio-alert">Each worker can incur provider charges. No connection test runs automatically.</div>
      <form id="studio-preview-form" class="studio-form-grid"><input type="hidden" name="templateId" value="${escapeHtml(team.id)}"><label class="studio-field wide">Absolute project directory<input name="target" required placeholder="C:\\projects\\example"></label><label class="studio-field wide">Task for this run<textarea name="task" required></textarea></label></form>
      ${issues.length ? `<ul class="studio-issues" style="margin-top:12px">${issues.map(issue => `<li class="studio-issue ${issue.severity}">${escapeHtml(issue.message)}</li>`).join("")}</ul>` : ""}`, `<button class="studio-button" data-dialog-close>Cancel</button><button class="studio-button primary" data-submit-form="studio-preview-form" ${issues.some(issue => issue.severity === "error") ? "disabled" : ""}>Preview run</button>`);
  }

  function runConfirmationDialog(preview) {
    const roster = preview.resolvedRoster?.map(agent => `<li class="studio-issue"><strong>${escapeHtml(agent.display_name ?? agent.name ?? agent.role ?? "Named member")}</strong><br>${escapeHtml(agent.agent_type ?? "runtime")} · ${escapeHtml(agent.model_selection ? `${agent.model_selection.provider}/${agent.model_selection.model}` : "model unresolved")}</li>`).join("") ?? "";
    const blockers = preview.blockers?.map(item => `<li class="studio-issue error">${escapeHtml(item.message ?? item)}</li>`).join("") ?? "";
    return dialogMarkup("Confirm target, task, roster and cost", "This is the final boundary before creating a live session.", `<div class="studio-alert">${escapeHtml(preview.costDisclosure)}</div>${blockers ? `<ul class="studio-issues">${blockers}</ul>` : `<ul class="studio-issues">${roster}</ul>`}<form id="studio-run-form" class="studio-form-grid" style="margin-top:12px">
      <label class="studio-check wide"><input type="checkbox" name="approvedTarget" required> I reviewed the target project directory.</label><label class="studio-check wide"><input type="checkbox" name="approvedTask" required> I reviewed the task and scope.</label><label class="studio-check wide"><input type="checkbox" name="approvedRoster" required> I reviewed every named member and model.</label><label class="studio-check wide"><input type="checkbox" name="approvedCost" required> I understand each worker may incur provider fees.</label></form>`, `<button class="studio-button" data-dialog-close>Cancel</button><button class="studio-button danger" data-submit-form="studio-run-form" ${!preview.valid || !ui.data.capabilities?.run ? "disabled" : ""}>${ui.data.capabilities?.run ? "Launch team" : "Launch integration unavailable"}</button>`);
  }

  function formData(form) { return Object.fromEntries(new FormData(form).entries()); }

  async function submitAgent(form) {
    if (!form.reportValidity()) return;
    const values = formData(form);
    const next = clone(library());
    const originalId = form.dataset.originalId;
    if (!originalId && next.agents.some(agent => agent.id === values.id)) return setNotice("Agent ID already exists.", "error");
    const existing = originalId ? next.agents.find(agent => agent.id === originalId) : null;
    const [providerId, modelId] = String(values.model || "").split("::");
    const agent = { id: values.id, displayName: values.displayName, role: values.role, description: values.description, runtime: values.runtime };
    if (providerId && modelId) agent.modelRef = { providerId, modelId };
    if (existing) {
      Object.assign(existing, agent);
      if (!agent.modelRef) delete existing.modelRef;
    } else next.agents.push(agent);
    ui.selectedAgentId = agent.id;
    closeDialog();
    await saveLibrary(next, `${agent.displayName} saved. No team was launched.`);
  }

  async function submitTeam(form) {
    if (!form.reportValidity()) return;
    const values = formData(form);
    const next = clone(library());
    const originalId = form.dataset.originalId;
    if (!originalId && next.teams.some(team => team.id === values.id)) return setNotice("Template ID already exists.", "error");
    const existing = originalId ? next.teams.find(team => team.id === originalId) : null;
    const team = existing ?? { id: values.id, name: values.name, members: [], managerId: "" };
    team.name = values.name;
    if (values.description) team.description = values.description; else delete team.description;
    if (!existing) next.teams.push(team);
    ui.selectedTeamId = team.id;
    closeDialog();
    await saveLibrary(next, `${team.name} saved as a template draft. No session was created.`);
  }

  async function submitProvider(form) {
    if (!form.reportValidity()) return;
    const values = formData(form);
    const modelRows = String(values.models).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const originalId = form.dataset.originalId;
    const originalProvider = originalId ? providers().find(provider => provider.id === originalId) : null;
    const models = modelRows.map(line => {
      const [id, name, flags = ""] = line.split("|").map(item => item.trim());
      const previous = originalProvider?.models?.find(model => model.id === id);
      return { ...previous, id, name: name || id, capabilities: { ...(previous?.capabilities ?? {}), toolCalling: flags.toLowerCase().split(/[, ]+/).includes("tools") } };
    });
    if (models.some(model => !model.id)) return setNotice("Every model needs an ID.", "error");
    const next = clone(providers());
    const value = { id: values.id, name: values.name, protocol: values.protocol, baseUrl: values.baseUrl, models };
    if (values.envKeyRef) value.envKeyRef = values.envKeyRef;
    if (!originalId && next.some(provider => provider.id === value.id)) return setNotice("Provider ID already exists.", "error");
    const index = originalId ? next.findIndex(provider => provider.id === originalId) : -1;
    if (index >= 0) next[index] = value; else next.push(value);
    ui.selectedProviderId = value.id;
    closeDialog();
    await saveProviders(next, `${value.name} metadata saved. No connection was tested.`);
  }

  async function submitMember(form) {
    if (!form.reportValidity()) return;
    const values = formData(form);
    const next = clone(library());
    const team = next.teams.find(item => item.id === ui.selectedTeamId);
    const agent = next.agents.find(item => item.id === values.agentId);
    if (!team || !agent) return;
    if (team.members.some(member => member.agentId === agent.id)) return setNotice(`${agent.displayName} is already in this team.`, "error");
    let memberId = slug(`${team.id}-${agent.id}`, "member").slice(0, 64);
    if (team.members.some(member => member.id === memberId)) memberId = `member-${crypto.randomUUID().slice(0, 12)}`;
    const member = { id: memberId, agentId: agent.id };
    if (team.members.length) member.reportsTo = team.managerId || team.members[0].id;
    team.members.push(member);
    if (!team.managerId) team.managerId = member.id;
    closeDialog();
    await saveLibrary(next, `${agent.displayName} added to ${team.name}. This remains a template draft.`);
  }

  async function submitCredential(form) {
    if (!form.reportValidity()) return;
    const input = form.elements.apiKey;
    const apiKey = input.value;
    input.value = "";
    const provider = currentProvider();
    closeDialog();
    try {
      await request(`/api/studio/providers/${encodeURIComponent(provider.id)}/credential`, { method: "PUT", body: JSON.stringify({ apiKey }) });
      await loadStudio();
      setNotice(`Credential stored in memory for ${provider.name}. Connection not tested.`, "success");
    } catch (error) { setNotice(error.message, "error"); }
  }

  async function submitCatalog(form) {
    if (!form.reportValidity()) return;
    const values = formData(form);
    closeDialog();
    try {
      const result = await request("/api/studio/catalog/import", { method: "POST", body: JSON.stringify({ catalogPath: values.catalogPath, baseRevision: ui.data.revision }) });
      await loadStudio();
      setNotice(result.warnings?.join(" ") || "Provider metadata imported. Enter credentials separately.", "success");
    } catch (error) { setNotice(error.message, "error"); }
  }

  async function submitImport(form) {
    if (!form.reportValidity()) return;
    const file = form.elements.bundle.files[0];
    let bundle;
    try { bundle = JSON.parse(await file.text()); }
    catch { return setNotice("Choose a valid JSON configuration bundle.", "error"); }
    closeDialog();
    try {
      ui.importPreview = await request("/api/studio/import", { method: "POST", body: JSON.stringify({ bundle, apply: false }) });
      openDialog(dialogMarkup("Review import", "Only configuration will be applied. Credentials and sessions are excluded.", `<div class="studio-alert">${escapeHtml(ui.importPreview.warnings?.join(" ") || "Review the incoming configuration.")}</div><dl class="studio-definition"><dt>Agents after import</dt><dd>${ui.importPreview.library.agents.length}</dd><dt>Templates after import</dt><dd>${ui.importPreview.library.teams.length}</dd><dt>Providers after import</dt><dd>${ui.importPreview.providers.length}</dd></dl>`, `<button class="studio-button" data-dialog-close>Cancel</button><button class="studio-button danger" data-action="apply-import">Apply configuration</button>`));
      ui.importPreview.bundle = bundle;
    } catch (error) { setNotice(error.message, "error"); }
  }

  async function submitPreview(form) {
    if (!form.reportValidity()) return;
    const values = formData(form);
    try {
      const preview = await request("/api/studio/run/preview", { method: "POST", body: JSON.stringify({ libraryRevision: ui.data.revision, templateId: values.templateId, target: values.target, task: values.task }) });
      ui.runPreview = preview;
      closeDialog();
      openDialog(runConfirmationDialog(preview));
    } catch (error) { setNotice(error.message, "error"); }
  }

  async function submitRun(form) {
    if (!form.reportValidity() || !ui.runPreview?.previewToken || !ui.data.capabilities?.run) return;
    const approvals = formData(form);
    const requestId = crypto.randomUUID();
    closeDialog();
    try {
      await request("/api/studio/run", { method: "POST", body: JSON.stringify({ previewToken: ui.runPreview.previewToken, requestId, approvedTarget: !!approvals.approvedTarget, approvedTask: !!approvals.approvedTask, approvedRoster: !!approvals.approvedRoster, approvedCost: !!approvals.approvedCost }) });
      ui.runPreview = null;
      setNotice("Team launch accepted. Use the monitoring tabs to inspect the live session.", "success");
    } catch (error) { setNotice(`${error.message} Check Sessions before retrying.`, "error"); }
  }

  const formHandlers = {
    "studio-agent-form": submitAgent,
    "studio-team-form": submitTeam,
    "studio-provider-form": submitProvider,
    "studio-member-form": submitMember,
    "studio-credential-form": submitCredential,
    "studio-catalog-form": submitCatalog,
    "studio-import-form": submitImport,
    "studio-preview-form": submitPreview,
    "studio-run-form": submitRun,
  };

  async function handleAction(action, element) {
    const team = currentTeam(), agent = currentAgent(), provider = currentProvider();
    if (action === "reload" || action === "refresh") return loadStudio({ announce: true });
    if (action === "new-agent") return openDialog(agentDialog(null), element);
    if (action === "edit-agent" && agent) return openDialog(agentDialog(agent), element);
    if (action === "new-team") return openDialog(teamDialog(null), element);
    if (action === "edit-team" && team) return openDialog(teamDialog(team), element);
    if (action === "new-provider") return openDialog(providerDialog(null), element);
    if (action === "edit-provider" && provider) return openDialog(providerDialog(provider), element);
    if (action === "add-member" && team) return openDialog(addMemberDialog(team), element);
    if (action === "credential" && provider) return openDialog(credentialDialog(provider), element);
    if (action === "catalog") return openDialog(catalogDialog(), element);
    if (action === "import") return openDialog(importDialog(), element);
    if (action === "open-run" && team) return openDialog(runDialog(team), element);
    if (action === "export") {
      try {
        const bundle = await request("/api/studio/export");
        const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = "multiagents-studio.json"; link.click(); URL.revokeObjectURL(url);
        return setNotice("Portable configuration exported without credentials or sessions.", "success");
      } catch (error) { return setNotice(error.message, "error"); }
    }
    if (action === "clear-credential" && provider) {
      try { await request(`/api/studio/providers/${encodeURIComponent(provider.id)}/credential`, { method: "DELETE", body: "{}" }); await loadStudio(); setNotice(`Credential cleared for ${provider.name}.`, "success"); }
      catch (error) { setNotice(error.message, "error"); }
      return;
    }
    if (action === "delete-agent" && agent) {
      if (library().teams.some(item => item.members.some(member => member.agentId === agent.id))) return setNotice("Remove this agent from team templates before deleting it.", "error");
      const next = clone(library()); next.agents = next.agents.filter(item => item.id !== agent.id); closeDialog(); ui.selectedAgentId = ""; return saveLibrary(next, `${agent.displayName} deleted.`);
    }
    if (action === "delete-team" && team) { const next = clone(library()); next.teams = next.teams.filter(item => item.id !== team.id); closeDialog(); ui.selectedTeamId = ""; return saveLibrary(next, `${team.name} deleted.`); }
    if (action === "delete-provider" && provider) {
      if (library().agents.some(item => item.modelRef?.providerId === provider.id)) return setNotice("Remap agents before deleting this provider.", "error");
      const next = clone(providers()).filter(item => item.id !== provider.id); closeDialog(); ui.selectedProviderId = ""; return saveProviders(next, `${provider.name} deleted.`);
    }
    if (action === "apply-import" && ui.importPreview?.bundle) {
      try { await request("/api/studio/import", { method: "POST", body: JSON.stringify({ bundle: ui.importPreview.bundle, apply: true, baseRevision: ui.data.revision, confirmed: true }) }); ui.importPreview = null; closeDialog(); await loadStudio(); setNotice("Portable configuration applied. Resolve local model and credential requirements before running.", "success"); }
      catch (error) { setNotice(error.message, "error"); }
    }
  }

  panel.addEventListener("click", async event => {
    const close = event.target.closest("[data-dialog-close]");
    if (close) { closeDialog(); return; }
    const section = event.target.closest("[data-section]");
    if (section) { ui.section = section.dataset.section; ui.search = ""; renderStudio(); return; }
    const view = event.target.closest("[data-view]");
    if (view) { ui.view = view.dataset.view; renderStudio(); return; }
    const teamSelect = event.target.closest("[data-select-team]");
    if (teamSelect) { ui.selectedTeamId = teamSelect.dataset.selectTeam; renderStudio(); return; }
    const agentSelect = event.target.closest("[data-select-agent]");
    if (agentSelect) { ui.selectedAgentId = agentSelect.dataset.selectAgent; renderStudio(); return; }
    const providerSelect = event.target.closest("[data-select-provider]");
    if (providerSelect) { ui.selectedProviderId = providerSelect.dataset.selectProvider; renderStudio(); return; }
    const submit = event.target.closest("[data-submit-form]");
    if (submit) {
      const form = document.getElementById(submit.dataset.submitForm);
      await formHandlers[form?.id]?.(form); return;
    }
    const actionElement = event.target.closest("[data-action]");
    if (!actionElement) return;
    const action = actionElement.dataset.action;
    if (["reports-to", "search"].includes(action)) return;
    if (["set-manager", "remove-member"].includes(action)) {
      const row = actionElement.closest("[data-member-id]");
      const next = clone(library()); const nextTeam = next.teams.find(item => item.id === ui.selectedTeamId); const member = nextTeam?.members.find(item => item.id === row?.dataset.memberId);
      if (!nextTeam || !member) return;
      if (action === "set-manager") { nextTeam.managerId = member.id; delete member.reportsTo; for (const candidate of nextTeam.members) if (candidate.id !== member.id && (!candidate.reportsTo || candidate.reportsTo === candidate.id)) candidate.reportsTo = member.id; }
      else { nextTeam.members = nextTeam.members.filter(item => item.id !== member.id); for (const candidate of nextTeam.members) if (candidate.reportsTo === member.id) candidate.reportsTo = nextTeam.managerId === member.id ? undefined : nextTeam.managerId; if (nextTeam.managerId === member.id) nextTeam.managerId = ""; }
      await saveLibrary(next, action === "set-manager" ? "Manager updated. No team was launched." : "Member removed from the draft."); return;
    }
    await handleAction(action, actionElement);
  });

  panel.addEventListener("input", event => {
    if (event.target.matches('[data-action="search"]')) { ui.search = event.target.value; renderStudio(); }
  });

  panel.addEventListener("change", async event => {
    if (!event.target.matches('[data-action="reports-to"]')) return;
    const next = clone(library()); const team = next.teams.find(item => item.id === ui.selectedTeamId); const member = team?.members.find(item => item.id === event.target.closest("[data-member-id]")?.dataset.memberId);
    if (!team || !member) return;
    if (event.target.value) member.reportsTo = event.target.value; else delete member.reportsTo;
    const issues = validateTeam(team).filter(issue => issue.severity === "error");
    if (issues.length) { setNotice(issues[0].message, "error"); renderStudio(); return; }
    await saveLibrary(next, "Reporting relationship updated. No team was launched.");
  });

  panel.addEventListener("submit", async event => {
    event.preventDefault();
    await formHandlers[event.target.id]?.(event.target);
  });

  studioTab.addEventListener("click", () => { if (!ui.loaded && !ui.loading) loadStudio(); });
  renderStudio();
})();
