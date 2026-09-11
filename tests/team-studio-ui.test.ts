import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importPortableTeamLibrary } from "../shared/team-library.ts";

const root = join(import.meta.dir, "..");
const html = readFileSync(join(root, "dashboard", "index.html"), "utf8");
const css = readFileSync(join(root, "dashboard", "app.css"), "utf8");
const js = readFileSync(join(root, "dashboard", "app.js"), "utf8");

type FormValues = Record<string, string>;

async function submitStudioForm(initialLibrary: unknown, formId: string, originalId: string, values: FormValues) {
  const listeners: Record<string, (event: any) => Promise<void> | void> = {};
  const tabListeners: Record<string, () => void> = {};
  const writes: Array<{ path: string; body: any }> = [];
  const panel = {
    innerHTML: "",
    addEventListener(type: string, listener: (event: any) => Promise<void> | void) { listeners[type] = listener; },
    querySelector() { return null; },
  };
  const tab = { addEventListener(type: string, listener: () => void) { tabListeners[type] = listener; } };
  const badge = { textContent: "" };
  const form = {
    id: formId,
    dataset: { originalId },
    reportValidity: () => true,
    entries: Object.entries(values),
  };
  const document = {
    activeElement: null,
    getElementById(id: string) {
      if (id === "panel-studio") return panel;
      if (id === "badge-studio") return badge;
      if (id === formId) return form;
      return null;
    },
    querySelector(selector: string) {
      if (selector === '[data-tab="studio"]') return tab;
      return null;
    },
  };
  class TestFormData {
    constructor(private source: typeof form) {}
    entries() { return this.source.entries[Symbol.iterator](); }
  }
  const state = {
    schemaVersion: 1,
    revision: "revision-one",
    library: initialLibrary,
    providers: [],
    readiness: [],
    credentialStorage: "memory",
    requiresReentryAfterRestart: true,
    csrfToken: "csrf-token",
    capabilities: { run: false },
  };
  const fetch = async (path: string, options: any = {}) => {
    if ((options.method ?? "GET") !== "GET") writes.push({ path, body: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true, data: state }) };
  };

  new Function("document", "fetch", "FormData", js)(document, fetch, TestFormData);
  tabListeners.click();
  await Bun.sleep(0);
  const submitButton = { dataset: { submitForm: formId } };
  await listeners.click({ target: { closest: (selector: string) => selector === "[data-submit-form]" ? submitButton : null } });
  return writes.find(write => write.path === "/api/studio/library")?.body.library;
}

describe("Team Studio UI source contract", () => {
  test("preserves six monitoring tabs and adds isolated Studio assets", () => {
    for (const tab of ["agents", "messages", "plan", "knowledge", "files", "stats"]) {
      expect(html).toContain(`data-tab="${tab}"`);
      expect(html).toContain(`id="panel-${tab}"`);
    }
    expect(html).toContain('data-tab="studio"');
    expect(html).toContain('id="panel-studio"');
    expect(html).toContain('href="./app.css"');
    expect(html).toContain('src="./app.js"');
    expect(html).toContain("new WebSocket");
    expect(html).toContain("connectWs();");
  });

  test("app.js is valid JavaScript and binds only to the Studio panel", () => {
    expect(() => new Function(js)).not.toThrow();
    expect(js).toContain('document.getElementById("panel-studio")');
    expect(js).toContain('[data-tab="studio"]');
    expect(js).not.toContain("document.body.innerHTML");
  });

  test("uses the agreed revision and CSRF protected API contract", () => {
    expect(js).toContain('request("/api/studio")');
    expect(js).toContain('headers["X-Studio-CSRF"]');
    expect(js).toContain("baseRevision: ui.data.revision");
    expect(js).toContain('request("/api/studio/library"');
    expect(js).toContain('request("/api/studio/providers"');
    expect(js).toContain('request("/api/studio/run/preview"');
    expect(js).toContain('request("/api/studio/run"');
    expect(js).toContain("ui.data.capabilities?.run");
  });

  test("keeps credentials ephemeral and separate from metadata", () => {
    expect(js).toContain('type="password"');
    expect(js).toContain('autocomplete="new-password"');
    expect(js).toContain('input.value = ""');
    expect(js).toContain("Credentials: memory only");
    expect(js).toContain("Connection not tested");
    expect(js).not.toContain("localStorage");
    expect(js).not.toContain("sessionStorage");
  });

  test("names agents prominently and validates team topology", () => {
    expect(js).toContain("agent.displayName");
    expect(js).toContain("Agent ID already exists.");
    expect(js).toContain("is already in this team.");
    expect(js).toContain("cannot report to itself");
    expect(js).toContain("Reporting cycle includes");
    expect(js).toContain("needs a reporting relationship");
    expect(js).toContain("managerId");
    expect(js).toContain("reportsTo");
  });

  test("submits a new empty template in the library's supported draft shape", async () => {
    const submitted = await submitStudioForm(
      { version: 1, agents: [], teams: [] },
      "studio-team-form",
      "",
      { id: "team-1", name: "Team 1", description: "Reusable implementation team" },
    );
    const imported = importPortableTeamLibrary(submitted);
    expect(imported.teams).toEqual([{
      id: "team-1",
      name: "Team 1",
      description: "Reusable implementation team",
      members: [],
      managerId: "",
    }]);
  });

  test("editing an agent to an unmapped model removes the previous model reference", async () => {
    const submitted = await submitStudioForm(
      {
        version: 1,
        agents: [{
          id: "agent-reviewer",
          displayName: "Reviewer",
          role: "Code reviewer",
          description: "Reviews the current diff.",
          runtime: "codex",
          modelRef: { providerId: "provider-one", modelId: "model-one" },
        }],
        teams: [],
      },
      "studio-agent-form",
      "agent-reviewer",
      {
        id: "agent-reviewer",
        displayName: "Reviewer",
        role: "Code reviewer",
        description: "Reviews the current diff.",
        runtime: "codex",
        model: "",
      },
    );
    const imported = importPortableTeamLibrary(submitted);
    expect(imported.agents[0]?.modelRef).toBeUndefined();
  });

  test("distinguishes templates, readiness, preview and explicit paid launch", () => {
    expect(js).toContain("Template, not a session");
    expect(js).toContain("Saving or editing never launches workers");
    expect(js).toContain("Needs model mapping");
    expect(js).toContain("Needs credential");
    expect(js).toContain("Connection verified");
    expect(js).toContain("Runtime unavailable");
    expect(js).toContain("status?.discovered");
    expect(js).not.toContain("provider.isDiscovered");
    expect(js).toContain("Each worker can incur provider charges");
    for (const approval of ["approvedTarget", "approvedTask", "approvedRoster", "approvedCost"]) {
      expect(js).toContain(approval);
    }
  });

  test("provides accessible dialog, status, graph and mobile list patterns", () => {
    expect(js).toContain('aria-live="polite"');
    expect(js).toContain("showModal()");
    expect(js).toContain("ui.dialogReturnFocus?.focus");
    expect(js).toContain('panel.addEventListener("submit", async event =>');
    expect(js).toContain("formHandlers[event.target.id]?.(event.target)");
    expect(js).toContain('aria-label="Named members and reporting relationships"');
    expect(js).toContain('aria-label="Topology view"');
    expect(css).toContain(".studio-dialog::backdrop");
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).toContain(".studio-member-list");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  test("preserves truthful monitoring and message reading state", () => {
    expect(html).toContain("Assigned task / active plan");
    expect(html).toContain("Latest observed step");
    expect(html).toContain("Not independently verified. See agent reports in Messages.");
    expect(html).toContain("Sự kiện hệ thống / điều khiển");
    expect(html).toContain("dataset.messageId");
    expect(html).toContain("feed.scrollTop = scroll");
  });
});
