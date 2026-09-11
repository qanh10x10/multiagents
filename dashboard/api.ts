import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { ProviderSettingsManager, deriveEnvKey } from "../shared/provider-settings.ts";
import { ProviderCredentialStore } from "../shared/provider-credentials.ts";
import { loadTeamLibrary, saveTeamLibrary, importPortableTeamLibrary, exportPortableTeamLibrary, expandTemplateToTeamConfig } from "../shared/team-library.ts";
import type { TeamConfig } from "../shared/types.ts";

type JsonObject = Record<string, any>;
export interface StudioOptions {
  libraryPath?: string;
  providersPath?: string;
  environment?: Record<string, string | undefined>;
  createTeam?: (config: TeamConfig, environment: Record<string, string | undefined>) => Promise<unknown>;
}

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
function fail(status: number, code: string, message: string): never { throw new ApiError(status, code, message); }
function object(value: unknown, fields: string[]): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !fields.includes(key))) fail(400, "INVALID_INPUT", "Unexpected input fields or object shape.");
  return value as JsonObject;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || /[\x00-\x1f\x7f]/.test(value)) fail(400, "INVALID_INPUT", "A non-empty text value is required.");
  return value.trim();
}
function response(data: unknown, status = 200): Response {
  return Response.json({ ok: true, data }, { status, headers: { "Cache-Control": "no-store" } });
}
function errorResponse(error: unknown): Response {
  const safe = error instanceof ApiError ? error : new ApiError(400, "INVALID_CONFIGURATION", "Configuration could not be validated or saved.");
  return Response.json({ ok: false, error: { code: safe.code, message: safe.message, retryable: false } }, {
    status: safe.status, headers: { "Cache-Control": "no-store" },
  });
}
async function readBody(req: Request): Promise<string> {
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 1_048_576) {
        await reader.cancel();
        fail(413, "INPUT_TOO_LARGE", "Configuration input exceeds 1 MiB.");
      }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await Bun.write(temporary, JSON.stringify(data, null, 2) + "\n");
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
}

export function createStudioApi(options: StudioOptions = {}) {
  const libraryPath = options.libraryPath ?? join(homedir(), ".multiagents", "team-library.json");
  const providersPath = options.providersPath ?? join(dirname(libraryPath), "provider-settings.json");
  const environment = options.environment ?? process.env;
  const csrfToken = randomUUID();
  const discoveredProviders = new Set<string>();
  let credentialRevision = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const previews = new Map<string, { revision: string; expiresAt: number; config: TeamConfig; used: boolean }>();
  const requests = new Map<string, { token: string; result: Promise<unknown> }>();

  async function state() {
    const library = await loadTeamLibrary(libraryPath);
    const providers = new ProviderSettingsManager();
    if (await Bun.file(providersPath).exists()) {
      const loaded = await providers.loadFromFile(providersPath);
      if (loaded.errors.length) fail(409, "INVALID_STORED_CONFIGURATION", "Stored provider configuration needs repair before editing.");
    }
    const revision = createHash("sha256").update(JSON.stringify([library, providers.listProviders(), credentialRevision])).digest("hex");
    return { library, providers, revision };
  }
  function readiness(providers: ProviderSettingsManager) {
    return providers.listProviders().map(p => ({
      providerId: p.id, discovered: discoveredProviders.has(p.id), configured: true,
      // Studio does not inspect ambient credentials. Keys are entered explicitly here.
      credentialPresent: ProviderCredentialStore.hasKey(p.id, undefined, {}),
      connectionVerified: false,
      models: p.models.map(m => ({ modelId: m.id, ...providers.validateCodexRunReadiness(p.id, m.id,
        (_key, id) => ProviderCredentialStore.hasKey(id, undefined, {})) })),
    }));
  }
  function assertRevision(actual: string, requested: unknown) {
    if (requested !== actual) fail(409, "STALE_REVISION", "Configuration changed. Reload before saving or running.");
  }
  function importedProviders(value: unknown, initial: ProviderSettingsManager = new ProviderSettingsManager()) {
    const staged = new ProviderSettingsManager(initial.listProviders());
    const result = staged.importCatalog(value);
    if (result.errors.length) fail(400, "INVALID_IMPORT", "Provider import rejected. Existing configuration is unchanged.");
    return staged;
  }
  async function handle(req: Request): Promise<Response | null | { runResult: Promise<unknown> }> {
    const url = new URL(req.url);
    if (url.pathname !== "/api/studio" && !url.pathname.startsWith("/api/studio/")) return null;
    try {
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
        || (req.headers.get("host") && req.headers.get("host") !== url.host)
        || (req.headers.get("origin") && req.headers.get("origin") !== url.origin)
        || req.headers.get("sec-fetch-site") === "cross-site") fail(403, "LOCAL_ORIGIN_REQUIRED", "Use the local Studio page.");
      const mutation = req.method !== "GET";
      if (mutation && (req.headers.get("origin") !== url.origin || req.headers.get("x-studio-csrf") !== csrfToken)) {
        fail(403, "CSRF_REQUIRED", "Reload the local Studio page before changing configuration.");
      }
      let body: JsonObject = {};
      if (mutation) {
        if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) fail(415, "JSON_REQUIRED", "JSON input required.");
        if (Number(req.headers.get("content-length")) > 1_048_576) fail(413, "INPUT_TOO_LARGE", "Configuration input exceeds 1 MiB.");
        const raw = await readBody(req);
        try { body = JSON.parse(raw); } catch { fail(400, "INVALID_JSON", "Input must be valid JSON."); }
      }
      const current = await state();
      const { library, providers, revision } = current;
      const path = url.pathname;
      if (path === "/api/studio" && req.method === "GET") return response({
        schemaVersion: 1, revision, library, providers: providers.listProviders(), readiness: readiness(providers),
        credentialStorage: "memory", requiresReentryAfterRestart: true, csrfToken,
        capabilities: { catalogImport: true, credentialEntry: true, runPreview: true, run: !!options.createTeam },
      });
      if (path === "/api/studio/library" && req.method === "PUT") {
        object(body, ["schemaVersion", "baseRevision", "library"]);
        if (body.schemaVersion !== undefined && body.schemaVersion !== 1) fail(400, "UNSUPPORTED_SCHEMA", "Unsupported Studio schema version.");
        assertRevision(revision, body.baseRevision);
        const next = importPortableTeamLibrary(body.library);
        await saveTeamLibrary(next, libraryPath);
        return response({ revision: (await state()).revision, library: next });
      }
      if (path === "/api/studio/providers" && req.method === "PUT") {
        object(body, ["baseRevision", "providers"]);
        assertRevision(revision, body.baseRevision);
        const next = importedProviders({ version: "1.0", exportedAt: new Date().toISOString(), providers: body.providers });
        await writeJson(providersPath, next.exportCatalog());
        for (const old of providers.listProviders()) {
          if (JSON.stringify(old) !== JSON.stringify(next.getProvider(old.id))) {
            ProviderCredentialStore.clearKey(old.id);
            discoveredProviders.delete(old.id);
          }
        }
        credentialRevision++;
        return response({ revision: (await state()).revision, providers: next.listProviders() });
      }
      const credential = /^\/api\/studio\/providers\/([A-Za-z0-9_.-]+)\/credential$/.exec(path);
      if (credential && ["PUT", "DELETE"].includes(req.method)) {
        object(body, req.method === "PUT" ? ["apiKey"] : []);
        if (!providers.getProvider(credential[1]!)) fail(404, "PROVIDER_NOT_FOUND", "Configure the provider first.");
        if (req.method === "PUT") ProviderCredentialStore.setKey(credential[1]!, body.apiKey);
        else ProviderCredentialStore.clearKey(credential[1]!);
        credentialRevision++;
        return response({ credentialPresent: req.method === "PUT", requiresReentryAfterRestart: true, revision: (await state()).revision });
      }
      if (path === "/api/studio/catalog/import" && req.method === "POST") {
        object(body, ["catalogPath", "baseRevision"]);
        if (body.baseRevision !== undefined) assertRevision(revision, body.baseRevision);
        const catalogPath = text(body.catalogPath);
        if ((await stat(catalogPath)).size > 1_048_576) fail(413, "INPUT_TOO_LARGE", "Catalog exceeds 1 MiB.");
        const discovered = new ProviderSettingsManager();
        await discovered.discoverFromCatalog(catalogPath, undefined, {});
        const next = importedProviders(discovered.exportCatalog(), providers);
        await writeJson(providersPath, next.exportCatalog());
        for (const p of discovered.listProviders()) discoveredProviders.add(p.id);
        return response({ revision: (await state()).revision, providers: next.listProviders(), warnings: ["Metadata imported. Enter credentials on this machine; capability declarations are not verified."] });
      }
      if (path === "/api/studio/export" && req.method === "GET") {
        return response({ schemaVersion: 1, library: exportPortableTeamLibrary(library), providers: providers.exportCatalog() });
      }
      if (path === "/api/studio/import" && req.method === "POST") {
        object(body, ["bundle", "apply", "baseRevision", "confirmed"]);
        const bundle = object(body.bundle, ["schemaVersion", "library", "providers"]);
        if (bundle.schemaVersion !== 1 || typeof body.apply !== "boolean") fail(400, "INVALID_IMPORT", "Unsupported configuration bundle.");
        const incoming = importPortableTeamLibrary(bundle.library);
        const merged = importPortableTeamLibrary({ version: 1, agents: [...library.agents, ...incoming.agents], teams: [...library.teams, ...incoming.teams] });
        const next = importedProviders(bundle.providers, providers);
        if (body.apply) {
          assertRevision(revision, body.baseRevision);
          if (body.confirmed !== true) fail(400, "CONFIRMATION_REQUIRED", "Review the import preview before applying.");
          // Both packages have been validated; no broker/session storage is involved.
          await saveTeamLibrary(merged, libraryPath);
          try { await writeJson(providersPath, next.exportCatalog()); }
          catch (error) { await saveTeamLibrary(library, libraryPath); throw error; }
        }
        return response({ applied: body.apply, revision: (await state()).revision, library: merged, providers: next.listProviders(),
          warnings: ["Configuration only. Review user-authored text and map local models explicitly. No sessions or credentials restored."] });
      }
      if (path === "/api/studio/run/preview" && req.method === "POST") {
        object(body, ["libraryRevision", "templateId", "target", "task"]);
        assertRevision(revision, body.libraryRevision);
        const projectDir = text(body.target);
        if (!isAbsolute(projectDir) || !(await stat(projectDir).catch(() => null))?.isDirectory()) fail(400, "INVALID_TARGET", "Choose an existing absolute project directory.");
        const result = await expandTemplateToTeamConfig(library, {
          templateId: text(body.templateId), projectDir, task: text(body.task), requestId: randomUUID(),
          approvedCost: false, approvedTarget: false, approvedTask: false, approvedRoster: false,
        }, { resolveModel: async (ref, runtime) => {
          if (runtime !== "codex") throw new Error("Configured models currently require Codex workers.");
          const ready = providers.validateCodexRunReadiness(ref.providerId, ref.modelId, (_key, id) => ProviderCredentialStore.hasKey(id, undefined, {}));
          if (!ready.ready) throw new Error(ready.reason ?? "Model setup required.");
          return { provider: ref.providerId, model: ref.modelId };
        } });
        const blockers: unknown[] = [...(result.errors ?? [])];
        const config = result.createTeam;
        if (config) for (const agent of config.agents) {
          const selection = agent.model_selection;
          if (!selection || agent.agent_type !== "codex") { blockers.push({ message: "Select an explicitly configured Codex provider/model for every member." }); continue; }
          const ready = providers.validateCodexRunReadiness(selection.provider, selection.model, (_key, id) => ProviderCredentialStore.hasKey(id, undefined, {}));
          if (!ready.ready) blockers.push({ message: ready.reason });
        }
        const valid = !!config && blockers.length === 0;
        const previewToken = valid ? randomUUID() : undefined;
        const expiresAt = Date.now() + 300_000;
        for (const [key, preview] of previews) if (preview.expiresAt < Date.now()) previews.delete(key);
        if (previewToken) previews.set(previewToken, { revision, expiresAt, config: config!, used: false });
        return response({ valid, blockers, warnings: result.warnings ?? [], previewToken, expiresAt, resolvedRoster: config?.agents ?? [],
          costDisclosure: "Each worker can incur provider charges. Catalog labels and tool support are declarations, not verified capabilities." });
      }
      if (path === "/api/studio/run" && req.method === "POST") {
        object(body, ["previewToken", "requestId", "approvedTarget", "approvedTask", "approvedRoster", "approvedCost"]);
        if (!options.createTeam) fail(503, "RUN_UNAVAILABLE", "Run integration is unavailable.");
        for (const key of ["approvedTarget", "approvedTask", "approvedRoster", "approvedCost"]) if (body[key] !== true) fail(400, "CONFIRMATION_REQUIRED", "Confirm target, task, roster and potential cost.");
        const token = text(body.previewToken), requestId = text(body.requestId);
        const existing = requests.get(requestId);
        if (existing) {
          if (existing.token !== token) fail(409, "REQUEST_ID_CONFLICT", "Request ID already belongs to another run.");
          return { runResult: existing.result };
        }
        const preview = previews.get(token);
        if (!preview || preview.used || preview.expiresAt < Date.now()) fail(409, "INVALID_PREVIEW", "Preview expired or already used. Preview again.");
        assertRevision(revision, preview.revision);
        preview.used = true;
        const selected = [...new Set(preview.config.agents.map(agent => agent.model_selection!.provider))];
        const catalogPath = join(dirname(libraryPath), `runtime-catalog-${randomUUID()}.json`);
        await writeJson(catalogPath, providers.buildRuntimeCatalog(selected));
        const envKeys: Record<string, string> = {};
        for (const id of selected) {
          const provider = providers.getProvider(id)!;
          envKeys[id] = provider.envKeyRef ?? deriveEnvKey(provider.name);
        }
        if (new Set(Object.values(envKeys)).size !== selected.length) fail(409, "AMBIGUOUS_CREDENTIAL", "Providers must use distinct credential references.");
        const config = structuredClone(preview.config);
        for (const agent of config.agents) agent.model_selection!.catalog_path = catalogPath;
        const launchEnvironment = ProviderCredentialStore.buildProcessEnv(environment, envKeys);
        const result = Promise.resolve().then(() => options.createTeam!(config, launchEnvironment)).then(value => {
          if (value && typeof value === "object" && "isError" in value && value.isError === true) {
            fail(502, "RUN_FAILED", "Orchestrator rejected the run. Inspect the session monitor before starting another run.");
          }
          return value;
        });
        requests.set(requestId, { token, result });
        return { runResult: result };
      }
      fail(404, "NOT_FOUND", "Studio endpoint not found.");
    } catch (error) { return errorResponse(error); }
  }
  return {
    handle(req: Request): Promise<Response | null> {
      // Serialize local updates and run acceptance; callers cannot race a revision check.
      const pending = queue.then(() => handle(req));
      queue = pending.catch(() => {});
      // Launch completion must not hold the configuration queue, including for retries.
      return pending.then(async result => {
        if (result === null || result instanceof Response) return result;
        try { return response(await result.runResult); }
        catch (error) { return errorResponse(error); }
      });
    },
  };
}
