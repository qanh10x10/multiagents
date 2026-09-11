import type { ModelSelection } from "../shared/model-providers.ts";
import {
  expandTemplateToTeamConfig,
  loadTeamLibrary,
  type ExpandedTeamConfigResult,
  type ModelReference,
  type TemplateRunRequest,
  type TemplateRuntime,
  type TeamLibraryFile,
} from "../shared/team-library.ts";
import type { TeamConfig } from "../shared/types.ts";

export interface TeamTemplateToolDeps {
  libraryPath?: string;
  createTeam?: (config: TeamConfig) => Promise<unknown>;
  resolveModel?: (ref: ModelReference, runtime: TemplateRuntime) => Promise<ModelSelection>;
  maxRecordedRuns?: number;
}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

interface ToolBundle {
  tools: unknown[];
  handlers: {
    list_team_templates(args?: { libraryPath?: string }): Promise<ToolResult>;
    get_team_template(args: { templateId: string; libraryPath?: string }): Promise<ToolResult>;
    preflight_team_template(args: TemplateRunRequest & { libraryPath?: string }): Promise<ToolResult>;
    run_team_template(args: TemplateRunRequest & { libraryPath?: string }): Promise<ToolResult>;
  };
}

const DEFAULT_MAX_RECORDED_RUNS = 100;

function textResult(value: unknown, isError = false): ToolResult {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function toolError(err: unknown): ToolResult {
  return textResult(err instanceof Error ? err.message : "Team template operation failed.", true);
}

function publicTemplateSummary(file: TeamLibraryFile) {
  return {
    version: file.version,
    agents: file.agents.map(agent => ({
      id: agent.id,
      displayName: agent.displayName,
      role: agent.role,
      runtime: agent.runtime,
      modelRef: agent.modelRef,
    })),
    teams: file.teams.map(team => ({
      id: team.id,
      name: team.name,
      description: team.description,
      managerId: team.managerId,
      memberCount: team.members.length,
    })),
  };
}

function requestPayload(args: TemplateRunRequest & { libraryPath?: string }): string {
  return JSON.stringify({
    ...args,
    libraryPath: args.libraryPath ?? null,
  });
}

function createToolDefinitions() {
  const modelRefSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      providerId: { type: "string" },
      modelId: { type: "string" },
    },
    required: ["providerId", "modelId"],
  };
  const runSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      libraryPath: { type: "string" },
      templateId: { type: "string" },
      projectDir: { type: "string" },
      sessionName: { type: "string" },
      task: { type: "string" },
      requestId: { type: "string" },
      approvedCost: { type: "boolean" },
      approvedTarget: { type: "boolean" },
      approvedTask: { type: "boolean" },
      approvedRoster: { type: "boolean" },
      memberOverrides: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            memberId: { type: "string" },
            task: { type: "string" },
            ownership: { type: "array", items: { type: "string" } },
            modelRef: modelRefSchema,
          },
          required: ["memberId"],
        },
      },
    },
    required: ["templateId", "projectDir", "task", "requestId"],
  };
  return [
    {
      name: "list_team_templates",
      description: "List saved reusable team templates and named agent definitions. Returns configuration metadata only; never launches workers.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { libraryPath: { type: "string" } },
      },
    },
    {
      name: "get_team_template",
      description: "Get one saved team template with its referenced agent definitions. Returns configuration metadata only.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          libraryPath: { type: "string" },
          templateId: { type: "string" },
        },
        required: ["templateId"],
      },
    },
    {
      name: "preflight_team_template",
      description: "Validate and expand a saved team template to create_team config without launching workers.",
      inputSchema: runSchema,
    },
    {
      name: "run_team_template",
      description: "Run a saved team template through an injected create_team pipeline after explicit approvals. Does not implement launcher logic.",
      inputSchema: runSchema,
    },
  ];
}

export function makeTeamTemplateTools(deps: TeamTemplateToolDeps): ToolBundle {
  const maxRecordedRuns = deps.maxRecordedRuns ?? DEFAULT_MAX_RECORDED_RUNS;
  const runRequests = new Map<string, { payload: string; promise: Promise<ToolResult> }>();
  const load = (path?: string) => loadTeamLibrary(path ?? deps.libraryPath);
  const preflight = async (args: TemplateRunRequest & { libraryPath?: string }): Promise<ExpandedTeamConfigResult> => {
    const file = await load(args.libraryPath);
    return expandTemplateToTeamConfig(file, args, { resolveModel: deps.resolveModel });
  };

  return {
    tools: createToolDefinitions(),
    handlers: {
      async list_team_templates(args = {}) {
        try {
          return textResult(publicTemplateSummary(await load(args.libraryPath)));
        } catch (err) {
          return toolError(err);
        }
      },
      async get_team_template(args) {
        try {
          const file = await load(args.libraryPath);
          const template = file.teams.find(candidate => candidate.id === args.templateId);
          if (!template) return textResult(`Template '${args.templateId}' was not found.`, true);
          const agentIds = new Set(template.members.map(member => member.agentId));
          return textResult({
            template,
            agents: file.agents.filter(agent => agentIds.has(agent.id)),
          });
        } catch (err) {
          return toolError(err);
        }
      },
      async preflight_team_template(args) {
        try {
          const result = await preflight(args);
          return textResult(result, !result.ok);
        } catch (err) {
          return toolError(err);
        }
      },
      async run_team_template(args) {
        for (const key of ["approvedCost", "approvedTarget", "approvedTask", "approvedRoster"] as const) {
          if (args[key] !== true) {
            return textResult(`${key} must be true before running a team template.`, true);
          }
        }
        const payload = requestPayload(args);
        const existing = runRequests.get(args.requestId);
        if (existing) {
          if (existing.payload !== payload) {
            return textResult("requestId is already in use for a different team template run payload.", true);
          }
          return existing.promise;
        }
        if (runRequests.size >= maxRecordedRuns) {
          return textResult("Too many recorded team template run request IDs; restart the host process or use fewer concurrent requests.", true);
        }
        const promise = (async () => {
          try {
            if (!deps.createTeam) return textResult("createTeam dependency is required to run a team template.", true);
            const result = await preflight(args);
            if (!result.ok || !result.createTeam) return textResult(result, true);
            const createResult = await deps.createTeam(result.createTeam);
            if (createResult && typeof createResult === "object" && "isError" in createResult && createResult.isError === true) {
              return textResult(createResult, true);
            }
            return textResult(createResult ?? { ok: true });
          } catch (err) {
            return toolError(err);
          }
        })();
        runRequests.set(args.requestId, { payload, promise });
        return promise;
      },
    },
  };
}
