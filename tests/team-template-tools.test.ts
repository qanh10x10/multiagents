import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makeTeamTemplateTools } from "../orchestrator/team-template-tools.ts";
import { saveTeamLibrary, type TeamLibraryFile } from "../shared/team-library.ts";
import type { TeamConfig } from "../shared/types.ts";

const file: TeamLibraryFile = {
  version: 1,
  agents: [{
    id: "agent-engineer",
    displayName: "Engineer",
    role: "Software Engineer",
    description: "Build the requested change.",
    runtime: "codex",
    modelRef: { providerId: "provider-one", modelId: "model-one" },
  }],
  teams: [{
    id: "team-1",
    name: "Team One",
    managerId: "member-engineer",
    members: [{ id: "member-engineer", agentId: "agent-engineer", task: "Implement.", ownership: ["src/**"] }],
  }],
};

async function withLibrary(test: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "team-template-tools-"));
  try {
    const path = join(dir, "team-library.json");
    await saveTeamLibrary(file, path);
    await test(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runArgs(path: string, requestId = "req-1") {
  return {
    libraryPath: path,
    templateId: "team-1",
    projectDir: "/repo",
    task: "Implement login",
    requestId,
    approvedCost: true,
    approvedTarget: true,
    approvedTask: true,
    approvedRoster: true,
  };
}

describe("team template tools", () => {
  it("lists and retrieves saved template metadata without launching", async () => {
    await withLibrary(async path => {
      const calls: TeamConfig[] = [];
      const tools = makeTeamTemplateTools({ libraryPath: path, createTeam: async config => { calls.push(config); return { ok: true }; } });
      const listed = await tools.handlers.list_team_templates();
      expect(listed.isError).toBeUndefined();
      expect(listed.content[0].text).toContain("Team One");
      const got = await tools.handlers.get_team_template({ templateId: "team-1" });
      expect(got.content[0].text).toContain("agent-engineer");
      expect(calls).toEqual([]);
    });
  });

  it("preflights expansion without calling createTeam", async () => {
    await withLibrary(async path => {
      let called = false;
      const tools = makeTeamTemplateTools({
        libraryPath: path,
        createTeam: async () => { called = true; return { ok: true }; },
        resolveModel: async ref => ({ provider: ref.providerId, model: ref.modelId, catalog_path: "/runtime/catalog.json" }),
      });
      const { approvedCost, approvedTarget, approvedTask, approvedRoster, ...previewArgs } = runArgs(path);
      const result = await tools.handlers.preflight_team_template(previewArgs);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('"createTeam"');
      expect(called).toBe(false);
    });
  });

  it("runs through injected createTeam only after approvals and preserves createTeam errors", async () => {
    await withLibrary(async path => {
      const calls: TeamConfig[] = [];
      const tools = makeTeamTemplateTools({
        libraryPath: path,
        createTeam: async config => {
          calls.push(config);
          return { isError: true, content: [{ type: "text", text: "launcher rejected" }] };
        },
        resolveModel: async ref => ({ provider: ref.providerId, model: ref.modelId, catalog_path: "/runtime/catalog.json" }),
      });
      const result = await tools.handlers.run_team_template(runArgs(path));
      expect(result.isError).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0].agents[0].model_selection?.provider).toBe("provider-one");
    });
  });

  it("blocks run without explicit approvals while preview remains side-effect free", async () => {
    await withLibrary(async path => {
      let called = false;
      const tools = makeTeamTemplateTools({
        libraryPath: path,
        createTeam: async () => { called = true; return { ok: true }; },
        resolveModel: async ref => ({ provider: ref.providerId, model: ref.modelId, catalog_path: "/runtime/catalog.json" }),
      });
      const result = await tools.handlers.run_team_template({ ...runArgs(path), approvedRoster: false });
      expect(result.isError).toBe(true);
      expect(called).toBe(false);
    });
  });

  it("deduplicates request IDs across in-flight and completed runs", async () => {
    await withLibrary(async path => {
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      let calls = 0;
      const tools = makeTeamTemplateTools({
        libraryPath: path,
        createTeam: async () => {
          calls++;
          await pending;
          return { ok: true };
        },
        resolveModel: async ref => ({ provider: ref.providerId, model: ref.modelId, catalog_path: "/runtime/catalog.json" }),
      });
      const first = tools.handlers.run_team_template(runArgs(path, "same-req"));
      const second = tools.handlers.run_team_template(runArgs(path, "same-req"));
      const rejected = await tools.handlers.run_team_template({ ...runArgs(path, "same-req"), task: "Different task" });
      expect(rejected.isError).toBe(true);
      release();
      const [a, b] = await Promise.all([first, second]);
      expect(a).toBe(b);
      expect(calls).toBe(1);
      const third = await tools.handlers.run_team_template(runArgs(path, "same-req"));
      expect(third).toBe(a);
      expect(calls).toBe(1);
    });
  });

  it("rejects capacity before preflight or createTeam side effects", async () => {
    await withLibrary(async path => {
      let calls = 0;
      const tools = makeTeamTemplateTools({
        libraryPath: path,
        maxRecordedRuns: 1,
        createTeam: async () => {
          calls++;
          return { ok: true };
        },
        resolveModel: async ref => ({ provider: ref.providerId, model: ref.modelId, catalog_path: "/runtime/catalog.json" }),
      });
      const first = await tools.handlers.run_team_template(runArgs(path, "capacity-one"));
      expect(first.isError).toBeUndefined();
      expect(calls).toBe(1);

      const second = await tools.handlers.run_team_template(runArgs(path, "capacity-two"));
      expect(second.isError).toBe(true);
      expect(second.content[0].text).toContain("Too many recorded");
      expect(calls).toBe(1);
    });
  });
});
