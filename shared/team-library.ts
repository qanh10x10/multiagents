import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { mkdir, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { AgentType, AgentLaunchConfig, TeamConfig } from "./types.ts";
import type { ModelSelection } from "./model-providers.ts";

export type TemplateRuntime = Exclude<AgentType, "custom">;

export interface ModelReference {
  providerId: string;
  modelId: string;
}

export interface AgentDefinition {
  id: string;
  displayName: string;
  role: string;
  description: string;
  runtime: TemplateRuntime;
  modelRef?: ModelReference;
}

export interface TeamTemplateMember {
  id: string;
  agentId: string;
  reportsTo?: string;
  task?: string;
  ownership?: string[];
}

export interface TeamTemplate {
  id: string;
  name: string;
  members: TeamTemplateMember[];
  managerId: string;
  description?: string;
}

export interface TeamLibraryFile {
  version: 1;
  agents: AgentDefinition[];
  teams: TeamTemplate[];
}

export type ValidationSeverity = "error" | "warning";
export type ValidationMode = "draft" | "preflight";

export interface ValidationIssue {
  code: string;
  message: string;
  path: string;
  severity: ValidationSeverity;
}

export interface TemplateMemberOverride {
  memberId: string;
  task?: string;
  ownership?: string[];
  modelRef?: ModelReference;
}

export interface TemplateRunRequest {
  templateId: string;
  projectDir: string;
  sessionName?: string;
  task: string;
  requestId: string;
  approvedCost?: boolean;
  approvedTarget?: boolean;
  approvedTask?: boolean;
  approvedRoster?: boolean;
  memberOverrides?: TemplateMemberOverride[];
}

export interface ExpandedTeamConfigResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  template?: TeamTemplate;
  agents?: AgentDefinition[];
  createTeam?: TeamConfig;
}

export interface ExpandTemplateDeps {
  resolveModel?: (ref: ModelReference, runtime: TemplateRuntime) => Promise<ModelSelection>;
}

const EMPTY_LIBRARY: TeamLibraryFile = { version: 1, agents: [], teams: [] };
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const RUNTIMES = new Set<TemplateRuntime>(["claude", "codex", "gemini"]);

function issue(code: string, message: string, path: string, severity: ValidationSeverity = "error"): ValidationIssue {
  return { code, message, path, severity };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownKeys(value: Record<string, unknown>, path: string, allowed: readonly string[], issues: ValidationIssue[]): void {
  const accepted = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!accepted.has(key)) {
      issues.push(issue("unknown_field", `Unknown field '${key}' is not allowed in portable team configuration.`, `${path}.${key}`));
    }
  }
}

function asString(value: unknown, path: string, issues: ValidationIssue[], required = true): string | undefined {
  if (value === undefined) {
    if (required) issues.push(issue("missing_field", "Required string field is missing.", path));
    return undefined;
  }
  if (typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value) || !value.isWellFormed()) {
    issues.push(issue("invalid_string", "Field must be a valid string without control characters.", path));
    return undefined;
  }
  return value;
}

function asId(value: unknown, path: string, issues: ValidationIssue[], required = true): string | undefined {
  const text = asString(value, path, issues, required);
  if (text === undefined) return undefined;
  if (!ID_PATTERN.test(text)) {
    issues.push(issue("unsafe_id", "ID must be alphanumeric with optional dot, underscore, or dash.", path));
    return undefined;
  }
  return text;
}

function asStringArray(value: unknown, path: string, issues: ValidationIssue[]): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    issues.push(issue("invalid_array", "Field must be an array of strings.", path));
    return undefined;
  }
  const result: string[] = [];
  value.forEach((entry, index) => {
    const text = asString(entry, `${path}[${index}]`, issues);
    if (text !== undefined) result.push(text);
  });
  return result;
}

function asModelRef(value: unknown, path: string, issues: ValidationIssue[]): ModelReference | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.push(issue("invalid_model_ref", "modelRef must be an object.", path));
    return undefined;
  }
  rejectUnknownKeys(value, path, ["providerId", "modelId"], issues);
  if ("catalogPath" in value || "catalog_path" in value) {
    issues.push(issue("local_catalog_path", "Portable model references must not contain catalog paths.", path));
  }
  const providerId = asId(value.providerId, `${path}.providerId`, issues);
  const modelId = asString(value.modelId, `${path}.modelId`, issues);
  if (!providerId || !modelId) return undefined;
  return { providerId, modelId };
}

function sanitizeAgent(value: unknown, path: string, issues: ValidationIssue[]): AgentDefinition | undefined {
  if (!isRecord(value)) {
    issues.push(issue("invalid_agent", "Agent definition must be an object.", path));
    return undefined;
  }
  rejectUnknownKeys(value, path, ["id", "displayName", "role", "description", "runtime", "modelRef"], issues);
  const id = asId(value.id, `${path}.id`, issues);
  const displayName = asString(value.displayName, `${path}.displayName`, issues);
  const role = asString(value.role, `${path}.role`, issues);
  const description = asString(value.description, `${path}.description`, issues);
  const runtime = asString(value.runtime, `${path}.runtime`, issues) as TemplateRuntime | undefined;
  if (runtime && !RUNTIMES.has(runtime)) {
    issues.push(issue("unsupported_runtime", "Runtime must be claude, codex, or gemini.", `${path}.runtime`));
  }
  const modelRef = asModelRef(value.modelRef, `${path}.modelRef`, issues);
  if (!id || displayName === undefined || role === undefined || description === undefined || !runtime || !RUNTIMES.has(runtime)) {
    return undefined;
  }
  return modelRef ? { id, displayName, role, description, runtime, modelRef } : { id, displayName, role, description, runtime };
}

function sanitizeMember(value: unknown, path: string, issues: ValidationIssue[]): TeamTemplateMember | undefined {
  if (!isRecord(value)) {
    issues.push(issue("invalid_member", "Team member must be an object.", path));
    return undefined;
  }
  rejectUnknownKeys(value, path, ["id", "agentId", "reportsTo", "task", "ownership"], issues);
  const id = asId(value.id, `${path}.id`, issues);
  const agentId = asId(value.agentId, `${path}.agentId`, issues);
  const reportsTo = asId(value.reportsTo, `${path}.reportsTo`, issues, false);
  const task = asString(value.task, `${path}.task`, issues, false);
  const ownership = asStringArray(value.ownership, `${path}.ownership`, issues);
  if (ownership) {
    ownership.forEach((pattern, index) => {
      if (isUnsafeOwnership(pattern)) {
        issues.push(issue("unsafe_ownership", "Ownership patterns must be relative and must not traverse parent directories.", `${path}.ownership[${index}]`));
      }
    });
  }
  if (!id || !agentId) return undefined;
  const member: TeamTemplateMember = { id, agentId };
  if (reportsTo !== undefined) member.reportsTo = reportsTo;
  if (task !== undefined) member.task = task;
  if (ownership !== undefined) member.ownership = ownership;
  return member;
}

function sanitizeTeam(value: unknown, path: string, issues: ValidationIssue[]): TeamTemplate | undefined {
  if (!isRecord(value)) {
    issues.push(issue("invalid_team", "Team template must be an object.", path));
    return undefined;
  }
  rejectUnknownKeys(value, path, ["id", "name", "members", "managerId", "description"], issues);
  const id = asId(value.id, `${path}.id`, issues);
  const name = asString(value.name, `${path}.name`, issues);
  const description = asString(value.description, `${path}.description`, issues, false);
  const managerId = value.managerId === ""
    ? ""
    : asId(value.managerId, `${path}.managerId`, issues);
  if (!Array.isArray(value.members)) {
    issues.push(issue("invalid_members", "Team members must be an array.", `${path}.members`));
    return undefined;
  }
  const members = value.members
    .map((member, index) => sanitizeMember(member, `${path}.members[${index}]`, issues))
    .filter((member): member is TeamTemplateMember => member !== undefined);
  if (!id || name === undefined || managerId === undefined) return undefined;
  const team: TeamTemplate = { id, name, members, managerId };
  if (description !== undefined) team.description = description;
  return team;
}

function sanitizeLibrary(raw: unknown): { file: TeamLibraryFile; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (!isRecord(raw)) {
    return { file: { ...EMPTY_LIBRARY }, issues: [issue("invalid_library", "Team library must be an object.", "$")] };
  }
  rejectUnknownKeys(raw, "$", ["version", "agents", "teams"], issues);
  if (raw.version !== 1) {
    issues.push(issue("unsupported_version", "Team library version must be 1.", "$.version"));
  }
  if (!Array.isArray(raw.agents)) {
    issues.push(issue("invalid_agents", "agents must be an array.", "$.agents"));
  }
  if (!Array.isArray(raw.teams)) {
    issues.push(issue("invalid_teams", "teams must be an array.", "$.teams"));
  }
  const agents = Array.isArray(raw.agents)
    ? raw.agents.map((agent, index) => sanitizeAgent(agent, `$.agents[${index}]`, issues)).filter((agent): agent is AgentDefinition => agent !== undefined)
    : [];
  const teams = Array.isArray(raw.teams)
    ? raw.teams.map((team, index) => sanitizeTeam(team, `$.teams[${index}]`, issues)).filter((team): team is TeamTemplate => team !== undefined)
    : [];
  return { file: { version: 1, agents, teams }, issues };
}

function duplicateIssues(values: { id: string }[], path: string, label: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      issues.push(issue("duplicate_id", `Duplicate ${label} ID '${value.id}'.`, `${path}[${index}].id`));
    }
    seen.add(value.id);
  });
  return issues;
}

function isUnsafeOwnership(pattern: string): boolean {
  const normalized = pattern.replace(/\\/g, "/");
  return !normalized.trim()
    || normalized.startsWith("/")
    || normalized.startsWith("~")
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.split("/").includes("..");
}

function validateTeamTopology(team: TeamTemplate, agentIds: Set<string>, teamIndex: number, mode: ValidationMode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const memberIds = new Set<string>();
  issues.push(...duplicateIssues(team.members, `$.teams[${teamIndex}].members`, "member"));
  for (const member of team.members) memberIds.add(member.id);
  if (mode === "preflight" && !memberIds.has(team.managerId)) {
    issues.push(issue("missing_manager", `Manager '${team.managerId}' is not a team member.`, `$.teams[${teamIndex}].managerId`));
  }
  team.members.forEach((member, memberIndex) => {
    if (mode === "preflight" && !agentIds.has(member.agentId)) {
      issues.push(issue("missing_agent", `Member references missing agent '${member.agentId}'.`, `$.teams[${teamIndex}].members[${memberIndex}].agentId`));
    }
    if (mode === "preflight" && member.reportsTo !== undefined && !memberIds.has(member.reportsTo)) {
      issues.push(issue("missing_report_target", `reportsTo references missing member '${member.reportsTo}'.`, `$.teams[${teamIndex}].members[${memberIndex}].reportsTo`));
    }
    if (mode === "preflight" && member.id === team.managerId && member.reportsTo !== undefined) {
      issues.push(issue("manager_reports_to_member", "Team manager must not report to another member.", `$.teams[${teamIndex}].members[${memberIndex}].reportsTo`));
    }
  });
  const reports = new Map(team.members.map(member => [member.id, member.reportsTo]));
  for (const member of team.members) {
    const visiting = new Set<string>();
    let current: string | undefined = member.id;
    while (current !== undefined) {
      if (visiting.has(current)) {
        issues.push(issue("cycle", `Reporting cycle includes member '${current}'.`, `$.teams[${teamIndex}].members`));
        break;
      }
      visiting.add(current);
      current = reports.get(current);
    }
  }
  return issues;
}

function localPath(value: string | undefined, fallback: string): string {
  const path = value ?? fallback;
  if (typeof path !== "string" || !path.trim() || /[\x00-\x1f\x7f]/.test(path)) {
    throw new Error("Invalid team library path.");
  }
  return resolve(path);
}

export function defaultTeamLibraryPath(root = homedir()): string {
  return resolve(root, ".multiagents", "team-library.json");
}

export function validateTeamLibrary(file: TeamLibraryFile, options: { mode?: ValidationMode; templateId?: string } = {}): ValidationIssue[] {
  const mode = options.mode ?? "draft";
  const { file: sanitized, issues } = sanitizeLibrary(file);
  const agentIds = new Set<string>();
  const agentsById = new Map<string, AgentDefinition>();
  issues.push(...duplicateIssues(sanitized.agents, "$.agents", "agent"));
  sanitized.agents.forEach(agent => {
    agentIds.add(agent.id);
    agentsById.set(agent.id, agent);
  });
  issues.push(...duplicateIssues(sanitized.teams, "$.teams", "team"));
  sanitized.teams.forEach((team, index) => {
    if (options.templateId !== undefined && team.id !== options.templateId) return;
    issues.push(...validateTeamTopology(team, agentIds, index, mode));
    if (mode === "preflight") {
      team.members.forEach((member, memberIndex) => {
        const agent = agentsById.get(member.agentId);
        if (agent && !agent.modelRef) {
          issues.push(issue("missing_model_ref", `Agent '${agent.id}' needs a modelRef before execution.`, `$.teams[${index}].members[${memberIndex}].agentId`));
        }
      });
    }
  });
  return issues;
}

export function exportPortableTeamLibrary(file: TeamLibraryFile): TeamLibraryFile {
  const { file: sanitized, issues } = sanitizeLibrary(file);
  const structural = validateTeamLibrary(sanitized, { mode: "draft" });
  const errors = [...issues, ...structural].filter(entry => entry.severity === "error");
  if (errors.length > 0) {
    throw new Error(errors[0]!.message);
  }
  return sanitized;
}

export function importPortableTeamLibrary(raw: unknown): TeamLibraryFile {
  const { file, issues } = sanitizeLibrary(raw);
  const validation = validateTeamLibrary(file, { mode: "draft" });
  const errors = [...issues, ...validation].filter(entry => entry.severity === "error");
  if (errors.length > 0) {
    throw new Error(errors[0]!.message);
  }
  return file;
}

export async function loadTeamLibrary(path?: string): Promise<TeamLibraryFile> {
  const filePath = localPath(path, defaultTeamLibraryPath());
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return { ...EMPTY_LIBRARY, agents: [], teams: [] };
  }
  let raw: unknown;
  try {
    raw = await file.json();
  } catch {
    throw new Error("Cannot read team library as JSON.");
  }
  return importPortableTeamLibrary(raw);
}

export async function saveTeamLibrary(file: TeamLibraryFile, path?: string): Promise<void> {
  const portable = exportPortableTeamLibrary(file);
  const target = localPath(path, defaultTeamLibraryPath());
  const dir = dirname(target);
  await mkdir(dir, { recursive: true });
  const tmp = resolve(dir, `.team-library.${randomUUID()}.tmp`);
  await Bun.write(tmp, JSON.stringify(portable, null, 2) + "\n");
  try {
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

function withOverride<T extends keyof TemplateMemberOverride>(
  member: TeamTemplateMember,
  override: TemplateMemberOverride | undefined,
  key: T,
): TemplateMemberOverride[T] | undefined {
  return override && override[key] !== undefined ? override[key] : undefined;
}

function sessionNameFor(template: TeamTemplate, request: TemplateRunRequest): string {
  return request.sessionName?.trim() || template.name;
}

export async function expandTemplateToTeamConfig(
  file: TeamLibraryFile,
  request: TemplateRunRequest,
  deps: ExpandTemplateDeps = {},
): Promise<ExpandedTeamConfigResult> {
  const warnings: ValidationIssue[] = [];
  const errors = validateTeamLibrary(file, { mode: "preflight", templateId: request.templateId });
  if (!request.projectDir?.trim()) errors.push(issue("missing_project_dir", "projectDir is required.", "$.projectDir"));
  if (!request.task?.trim()) errors.push(issue("missing_task", "task is required.", "$.task"));
  if (!request.requestId?.trim()) errors.push(issue("missing_request_id", "requestId is required.", "$.requestId"));
  const template = file.teams.find(candidate => candidate.id === request.templateId);
  if (!template) errors.push(issue("missing_template", `Template '${request.templateId}' was not found.`, "$.templateId"));
  const overrides = new Map((request.memberOverrides ?? []).map(override => [override.memberId, override]));
  for (const override of request.memberOverrides ?? []) {
    if (!template?.members.some(member => member.id === override.memberId)) {
      errors.push(issue("unknown_override", `Override references missing member '${override.memberId}'.`, "$.memberOverrides"));
    }
  }
  if (errors.length > 0 || !template) return { ok: false, errors, warnings };

  const agentsById = new Map(file.agents.map(agent => [agent.id, agent]));
  const membersById = new Map(template.members.map(member => [member.id, member]));
  const selectedAgents: AgentDefinition[] = [];
  const launchAgents: AgentLaunchConfig[] = [];
  const selectedDisplayNames = new Map<string, string>();
  const orderedMembers = [
    ...template.members.filter(member => member.id === template.managerId),
    ...template.members.filter(member => member.id !== template.managerId),
  ];
  for (const member of orderedMembers) {
    const agent = agentsById.get(member.agentId);
    if (!agent) continue;
    selectedAgents.push(agent);
    const existingMember = selectedDisplayNames.get(agent.displayName);
    if (existingMember && existingMember !== member.id) {
      errors.push(issue("duplicate_display_name", `Selected roster has duplicate display name '${agent.displayName}'.`, `$.teams.${template.id}.members.${member.id}.agentId`));
      continue;
    }
    selectedDisplayNames.set(agent.displayName, member.id);
    const override = overrides.get(member.id);
    const modelRef = override?.modelRef ?? agent.modelRef;
    if (!modelRef) {
      errors.push(issue("missing_model_ref", `Agent '${agent.id}' needs a modelRef before execution.`, `$.agents.${agent.id}.modelRef`));
      continue;
    }
    let resolvedModel: ModelSelection | undefined;
    try {
      if (!deps.resolveModel) {
        errors.push(issue("missing_model_resolver", "resolveModel is required when a template uses modelRef.", `$.agents.${agent.id}.modelRef`));
        continue;
      }
      resolvedModel = await deps.resolveModel(modelRef, agent.runtime);
    } catch (err) {
      errors.push(issue("unresolved_model", err instanceof Error ? err.message : "Model reference could not be resolved.", `$.agents.${agent.id}.modelRef`));
      continue;
    }
    const task = withOverride(member, override, "task") ?? member.task;
    const ownership = withOverride(member, override, "ownership") ?? member.ownership;
    const effectiveReportsTo = member.id === template.managerId ? undefined : (member.reportsTo ?? template.managerId);
    const reportTarget = effectiveReportsTo ? agentsById.get(membersById.get(effectiveReportsTo)?.agentId ?? "") : undefined;
    const memberTask = task?.trim();
    const reportingInstruction = reportTarget ? `Report to ${reportTarget.displayName}.` : undefined;
    const initialTask = [
      request.task.trim(),
      reportingInstruction,
      memberTask ? `Template member task: ${memberTask}` : undefined,
    ].filter((part): part is string => part !== undefined).join("\n\n");
    launchAgents.push({
      agent_type: agent.runtime,
      name: agent.displayName,
      role: agent.role,
      role_description: reportingInstruction ? `${agent.description}\n\n${reportingInstruction}` : agent.description,
      initial_task: initialTask,
      ...(ownership ? { file_ownership: ownership } : {}),
      ...(resolvedModel ? { model_selection: resolvedModel } : {}),
      ...(reportTarget ? { report_to: reportTarget.displayName } : {}),
    });
  }
  if (errors.length > 0) return { ok: false, errors, warnings, template, agents: selectedAgents };
  return {
    ok: true,
    errors: [],
    warnings,
    template,
    agents: selectedAgents,
    createTeam: {
      project_dir: request.projectDir,
      session_name: sessionNameFor(template, request),
      agents: launchAgents,
    },
  };
}
