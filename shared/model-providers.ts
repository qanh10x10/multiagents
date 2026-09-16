import { resolve } from "node:path";

export interface ModelSelection {
  provider: string;
  model: string;
  catalog_path?: string;
}

export interface ResolvedModelSelection {
  selection: ModelSelection & { catalog_path: string };
  envKey: string;
  modelId: string;
  baseUrl: string;
  providerName: string;
  codexArgs: string[];
}

/** Safe, flattened catalog entry. Optional metadata is claimed, not verified. */
export interface CatalogModel {
  provider: string;
  model: string;
  name: string;
  url: string;
  envKey: string;
  toolCalling?: boolean;
  vision?: boolean;
  zeroDataRetentionEnabled?: boolean;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

export interface ModelCatalog {
  catalog_path: string;
  models: CatalogModel[];
}

type Environment = Record<string, string | undefined>;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function invalid(message: string): never {
  // Messages must be constants: catalog input and filesystem errors may contain secrets.
  throw new Error(message);
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid("Invalid model catalog object.");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || /[\x00-\x1f\x7f]/.test(value)
    || !value.isWellFormed()) {
    invalid("Invalid model catalog text field.");
  }
  return value;
}

function environmentKey(provider: Record<string, unknown>, name: string): {
  key: string;
  derived: boolean;
} {
  if (provider.apiKey !== undefined) {
    const reference = text(provider.apiKey);
    const match = /^\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(reference);
    if (match) return { key: match[1]!, derived: false };
    if (!/^\$\{input:chat\.lm\.secret\.[A-Za-z0-9_.-]+\}$/.test(reference)) {
      invalid("Provider API key must be a supported environment or VS Code input reference; literal keys are not allowed.");
    }
  }
  const stem = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  const key = `${stem}_API_KEY`;
  if (!stem || !ENV_NAME.test(key)) invalid("Cannot derive provider environment key; use an explicit environment reference.");
  return { key, derived: true };
}

function modelUrl(value: unknown): string {
  const raw = text(value);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    invalid("Invalid model endpoint URL.");
  }
  if (!/^https?:\/\//i.test(raw) || /[\\\s?#]/.test(raw)
    || url.username || url.password || url.search || url.hash
    || (url.protocol !== "https:" && url.protocol !== "http:")) {
    invalid("Model endpoint must be HTTP(S) without credentials, query, or fragment.");
  }
  // Check the authority too: URL normalizes empty userinfo and unusual loopback spellings.
  const authority = raw.slice(raw.indexOf("://") + 3).split("/")[0]!;
  if (authority.includes("@")) invalid("Model endpoint must not contain credentials.");
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1"
    || url.hostname === "[::1]";
  if (url.protocol === "http:" && !local) invalid("Remote model endpoints require HTTPS.");
  return url.href;
}

function catalogFile(catalogPath: unknown, projectDir: unknown, env: Environment): string {
  const directory = projectDir === undefined ? process.cwd() : text(projectDir);
  const file = catalogPath !== undefined ? text(catalogPath)
    : env.MULTIAGENTS_MODELS_FILE !== undefined ? text(env.MULTIAGENTS_MODELS_FILE)
    : ".multiagents/chatLanguageModels.json";
  try {
    return resolve(directory, file);
  } catch {
    invalid("Invalid model catalog path.");
  }
}

/**
 * Read JSON only; no VS Code secret storage or network access.
 * Paths resolve against projectDir (or cwd), in order: explicit, environment, project default.
 * Returns { catalog_path, models }, with only allowlisted metadata and environment key names.
 * Missing credentials do not prevent listing; malformed or unsupported entries reject the catalog.
 */
export async function listModels(
  catalogPath?: string,
  projectDir?: string,
  env: Environment = process.env,
): Promise<ModelCatalog> {
  record(env);
  const catalog_path = catalogFile(catalogPath, projectDir, env);
  let raw: unknown;
  try {
    raw = await Bun.file(catalog_path).json();
  } catch {
    invalid("Cannot read model catalog as JSON.");
  }
  if (!Array.isArray(raw)) invalid("Model catalog must be a JSON array.");
  const models: CatalogModel[] = [];
  const names = new Set<string>();
  const keys = new Map<string, boolean>();
  for (const entry of raw) {
    const provider = record(entry);
    // Skip built-in editor providers like Copilot in VS Code chatLanguageModels.json
    if (provider.vendor === "copilot") continue;
    const name = text(provider.name);
    if (names.has(name)) invalid("Duplicate provider name in model catalog.");
    names.add(name);
    if (provider.vendor !== "customendpoint") invalid("Unsupported model provider vendor.");
    if (provider.apiType !== "responses") invalid("Model provider must use the responses protocol.");
    const { key, derived } = environmentKey(provider, name);
    if (keys.has(key) && (derived || keys.get(key))) {
      invalid("Ambiguous provider environment keys; use distinct explicit environment references.");
    }
    keys.set(key, derived);
    if (!Array.isArray(provider.models)) invalid("Provider models must be an array.");
    const ids = new Set<string>();
    for (const entry of provider.models) {
      const model = record(entry);
      const id = text(model.id);
      if (ids.has(id)) invalid("Duplicate model ID within provider.");
      ids.add(id);
      const safe: CatalogModel = {
        provider: name,
        model: id,
        name: text(model.name),
        url: modelUrl(model.url),
        envKey: key,
      };
      for (const field of ["toolCalling", "vision", "zeroDataRetentionEnabled"] as const) {
        if (model[field] !== undefined) {
          if (typeof model[field] !== "boolean") invalid("Invalid boolean model metadata.");
          safe[field] = model[field];
        }
      }
      for (const field of ["maxInputTokens", "maxOutputTokens"] as const) {
        if (model[field] !== undefined) {
          if (typeof model[field] !== "number" || !Number.isSafeInteger(model[field]) || model[field] <= 0) {
            invalid("Model token metadata must be a positive safe integer.");
          }
          safe[field] = model[field];
        }
      }
      models.push(safe);
    }
  }
  return { catalog_path, models };
}

export async function resolveModelSelection(
  selection: ModelSelection,
  projectDir?: string,
  env: Environment = process.env,
): Promise<ResolvedModelSelection> {
  const input = record(selection);
  const provider = text(input.provider);
  const modelId = text(input.model);
  const catalogPath = input.catalog_path === undefined ? undefined : text(input.catalog_path);
  const catalog = await listModels(catalogPath, projectDir, env);
  const model = catalog.models.find(candidate => candidate.provider === provider && candidate.model === modelId);
  if (!model) invalid("Selected provider or model does not exist in model catalog.");
  if (model.toolCalling !== true) invalid("Selected model must declare toolCalling as true.");
  if (typeof env[model.envKey] !== "string" || !env[model.envKey]!.trim()) {
    invalid("Selected provider environment credential is missing.");
  }
  // Codex appends /responses itself; accept either a base URL or a full Responses endpoint.
  const baseUrl = model.url.replace(/\/+$/, "").replace(/\/responses$/, "");
  const quote = (value: string): string => JSON.stringify(value);
  // Codex recursively merges -c tables. Callers must isolate configuration layers;
  // these arguments alone cannot remove inherited authentication or headers.
  const table = `{ name = ${quote(provider)}, base_url = ${quote(baseUrl)}, env_key = ${quote(model.envKey)}, wire_api = "responses", requires_openai_auth = false }`;
  return {
    selection: { provider, model: modelId, catalog_path: catalog.catalog_path },
    envKey: model.envKey,
    modelId,
    baseUrl,
    providerName: provider,
    codexArgs: [
      "-c", 'model_provider="multiagents_custom"',
      "-c", `model=${quote(modelId)}`,
      "-c", `model_providers.multiagents_custom=${table}`,
    ],
  };
}