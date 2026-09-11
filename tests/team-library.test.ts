import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  expandTemplateToTeamConfig,
  exportPortableTeamLibrary,
  importPortableTeamLibrary,
  loadTeamLibrary,
  saveTeamLibrary,
  validateTeamLibrary,
  type TeamLibraryFile,
} from "../shared/team-library.ts";

const library: TeamLibraryFile = {
  version: 1,
  agents: [
    {
      id: "agent-engineer",
      displayName: "Engineer",
      role: "Software Engineer",
      description: "Implement scoped backend work.",
      runtime: "codex",
      modelRef: { providerId: "provider-one", modelId: "model-one" },
    },
    {
      id: "agent-reviewer",
      displayName: "Reviewer",
      role: "Code Reviewer",
      description: "Review implementation.",
      runtime: "claude",
      modelRef: { providerId: "provider-two", modelId: "model-two" },
    },
  ],
  teams: [
    {
      id: "team-1",
      name: "Feature Team",
      managerId: "member-reviewer",
      members: [
        { id: "member-reviewer", agentId: "agent-reviewer", task: "Review outputs." },
        { id: "member-engineer", agentId: "agent-engineer", reportsTo: "member-reviewer", task: "Implement feature.", ownership: ["src/**"] },
      ],
    },
  ],
};

describe("team library", () => {
  it("validates reusable agents, team references, and reporting cycles", () => {
    expect(validateTeamLibrary(library)).toEqual([]);
    const invalid: TeamLibraryFile = {
      version: 1,
      agents: [{ ...library.agents[0]!, id: "dup" }, { ...library.agents[1]!, id: "dup" }],
      teams: [{
        id: "bad",
        name: "Bad",
        managerId: "a",
        members: [
          { id: "a", agentId: "missing", reportsTo: "b" },
          { id: "b", agentId: "dup", reportsTo: "a" },
        ],
      }],
    };
    const codes = validateTeamLibrary(invalid).map(entry => entry.code);
    expect(codes).toContain("duplicate_id");
    expect(codes).toContain("cycle");
  });

  it("allows draft incompleteness but preflight blocks missing selected references", () => {
    const draft: TeamLibraryFile = {
      version: 1,
      agents: [{ ...library.agents[0]!, modelRef: undefined }],
      teams: [{ id: "team-draft", name: "Draft", managerId: "member-one", members: [{ id: "member-one", agentId: "agent-engineer" }] }],
    };
    expect(validateTeamLibrary(draft, { mode: "draft" })).toEqual([]);
    const codes = validateTeamLibrary(draft, { mode: "preflight" }).map(entry => entry.code);
    expect(codes).toContain("missing_model_ref");
  });

  it("allows empty draft shells but preflight blocks them", () => {
    const draft: TeamLibraryFile = {
      version: 1,
      agents: [],
      teams: [{ id: "team-new", name: "New Team", managerId: "", members: [] }],
    };
    expect(validateTeamLibrary(draft, { mode: "draft" })).toEqual([]);
    expect(validateTeamLibrary(draft, { mode: "preflight" }).map(entry => entry.code)).toContain("missing_manager");
  });

  it("rejects unknown fields and local catalog paths in portable configuration", () => {
    expect(() => importPortableTeamLibrary({
      ...library,
      agents: [{ ...library.agents[0], modelRef: { providerId: "provider-one", modelId: "model-one", catalogPath: "/tmp/local.json" }, secret: "nope" }],
      teams: [library.teams[0]],
      sessionHistory: ["must-strip"],
    })).toThrow("Unknown field");
  });

  it("exports allowlisted portable configuration and preserves slash model IDs", () => {
    const portable: TeamLibraryFile = {
      ...library,
      agents: [{ ...library.agents[0]!, modelRef: { providerId: "provider-one", modelId: "vendor/model" } }],
      teams: [{ ...library.teams[0]!, members: [{ id: "member-engineer", agentId: "agent-engineer", task: "Implement." }], managerId: "member-engineer" }],
    };
    const exported = exportPortableTeamLibrary(portable);
    expect(exported.agents[0].modelRef?.modelId).toBe("vendor/model");
    expect(JSON.stringify(exported)).not.toContain("catalogPath");
    expect(JSON.stringify(exported)).not.toContain("sessionHistory");
  });

  it("rejects absolute or traversing ownership patterns", () => {
    expect(validateTeamLibrary({
      ...library,
      teams: [{ ...library.teams[0]!, members: [{ id: "member-engineer", agentId: "agent-engineer", task: "Implement.", ownership: ["../secret"] }], managerId: "member-engineer" }],
    }).map(entry => entry.code)).toContain("unsafe_ownership");
  });

  it("persists the library through a configurable path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "team-library-"));
    try {
      const path = join(dir, "team-library.json");
      await saveTeamLibrary(library, path);
      const saved = await readFile(path, "utf8");
      expect(saved).toContain('"version": 1');
      expect(await loadTeamLibrary(path)).toEqual(library);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("expands a template to existing create_team config for preview with model resolution", async () => {
    const result = await expandTemplateToTeamConfig(library, {
      templateId: "team-1",
      projectDir: "/repo",
      sessionName: "Feature Run",
      task: "Implement login",
      requestId: "req-1",
    }, {
      resolveModel: async ref => ({ provider: ref.providerId, model: ref.modelId, catalog_path: "/runtime/catalog.json" }),
    });
    expect(result.ok).toBe(true);
    expect(result.createTeam?.session_name).toBe("Feature Run");
    expect(result.createTeam?.agents[0].model_selection?.catalog_path).toBe("/runtime/catalog.json");
    expect(result.createTeam?.agents[1].initial_task).toContain("Implement login");
    expect(result.createTeam?.agents[1].initial_task).toContain("Report to Reviewer.");
    expect(result.createTeam?.agents[1].report_to).toBe("Reviewer");
  });

  it("rejects duplicate display names in the selected launch roster", async () => {
    const result = await expandTemplateToTeamConfig({
      version: 1,
      agents: [
        library.agents[0]!,
        { ...library.agents[1]!, id: "agent-reviewer-duplicate-name", displayName: "Engineer" },
      ],
      teams: [{
        id: "ambiguous",
        name: "Ambiguous",
        managerId: "member-one",
        members: [
          { id: "member-one", agentId: "agent-engineer" },
          { id: "member-two", agentId: "agent-reviewer-duplicate-name" },
        ],
      }],
    }, {
      templateId: "ambiguous",
      projectDir: "/repo",
      task: "Implement login",
      requestId: "req-duplicate-display",
    }, {
      resolveModel: async ref => ({ provider: ref.providerId, model: ref.modelId, catalog_path: "/runtime/catalog.json" }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.map(entry => entry.code)).toContain("duplicate_display_name");
  });

  it("rejects a manager reporting to another member before launch", async () => {
    const result = await expandTemplateToTeamConfig({
      version: 1,
      agents: library.agents,
      teams: [{
        id: "bad-manager",
        name: "Bad Manager",
        managerId: "member-reviewer",
        members: [
          { id: "member-reviewer", agentId: "agent-reviewer", reportsTo: "member-engineer" },
          { id: "member-engineer", agentId: "agent-engineer" },
        ],
      }],
    }, {
      templateId: "bad-manager",
      projectDir: "/repo",
      task: "Implement login",
      requestId: "req-bad-manager",
    }, {
      resolveModel: async ref => ({ provider: ref.providerId, model: ref.modelId, catalog_path: "/runtime/catalog.json" }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.map(entry => entry.code)).toContain("manager_reports_to_member");
  });

  it("falls back to the global task when member task is omitted", async () => {
    const result = await expandTemplateToTeamConfig({
      version: 1,
      agents: [library.agents[0]!],
      teams: [{ id: "solo", name: "Solo", managerId: "member-engineer", members: [{ id: "member-engineer", agentId: "agent-engineer" }] }],
    }, {
      templateId: "solo",
      projectDir: "/repo",
      task: "Implement login",
      requestId: "req-global-task",
    }, {
      resolveModel: async ref => ({ provider: ref.providerId, model: ref.modelId, catalog_path: "/runtime/catalog.json" }),
    });
    expect(result.ok).toBe(true);
    expect(result.createTeam?.agents[0].initial_task).toBe("Implement login");
  });

  it("validates only the selected template during expansion", async () => {
    const result = await expandTemplateToTeamConfig({
      version: 1,
      agents: [library.agents[0]!],
      teams: [
        { id: "valid", name: "Valid", managerId: "member-engineer", members: [{ id: "member-engineer", agentId: "agent-engineer" }] },
        { id: "draft-broken", name: "Draft Broken", managerId: "missing", members: [] },
      ],
    }, {
      templateId: "valid",
      projectDir: "/repo",
      task: "Implement login",
      requestId: "req-selected-only",
    }, {
      resolveModel: async ref => ({ provider: ref.providerId, model: ref.modelId, catalog_path: "/runtime/catalog.json" }),
    });
    expect(result.ok).toBe(true);
  });

  it("orders manager first and defaults non-manager reporting to the manager", async () => {
    const result = await expandTemplateToTeamConfig({
      version: 1,
      agents: library.agents,
      teams: [{
        id: "default-reports",
        name: "Default Reports",
        managerId: "member-reviewer",
        members: [
          { id: "member-engineer", agentId: "agent-engineer" },
          { id: "member-reviewer", agentId: "agent-reviewer" },
        ],
      }],
    }, {
      templateId: "default-reports",
      projectDir: "/repo",
      task: "Implement login",
      requestId: "req-default-reports",
    }, {
      resolveModel: async ref => ({ provider: ref.providerId, model: ref.modelId, catalog_path: "/runtime/catalog.json" }),
    });
    expect(result.ok).toBe(true);
    expect(result.createTeam?.agents[0].name).toBe("Reviewer");
    expect(result.createTeam?.agents[1].report_to).toBe("Reviewer");
    expect(result.createTeam?.agents[1].initial_task).toContain("Report to Reviewer.");
  });

  it("blocks template expansion when a selected model cannot be resolved", async () => {
    const result = await expandTemplateToTeamConfig(library, {
      templateId: "team-1",
      projectDir: "/repo",
      task: "Implement login",
      requestId: "req-2",
    }, {
      resolveModel: async () => {
        throw new Error("Selected provider or model is not configured.");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.map(entry => entry.code)).toContain("unresolved_model");
  });

  it("blocks model references when no resolver is provided", async () => {
    const result = await expandTemplateToTeamConfig(library, {
      templateId: "team-1",
      projectDir: "/repo",
      task: "Implement login",
      requestId: "req-no-resolver",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.map(entry => entry.code)).toContain("missing_model_resolver");
  });
});
