import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { listModels, type CatalogModel } from "./model-providers.ts";

export const SUPPORTED_PROTOCOLS = ["responses", "openai", "anthropic", "ollama", "custom"] as const;
export type ProviderProtocol = typeof SUPPORTED_PROTOCOLS[number];

export interface ModelCapability {
  toolCalling?: boolean;
  vision?: boolean;
  zeroDataRetentionEnabled?: boolean;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

export interface ModelMetadata {
  id: string;
  name: string;
  capabilities: ModelCapability;
  url?: string;
}

export interface ProviderMetadata {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  models: ModelMetadata[];
  envKeyRef?: string;
  isDiscovered?: boolean;
}

export interface ProviderExportPackage {
  version: "1.0";
  exportedAt: string;
  providers: Omit<ProviderMetadata, "isDiscovered">[];
}

export interface RemapRequirement {
  templateAgentId: string;
  missingProviderId: string;
  missingModelId: string;
  reason: "provider_missing" | "model_missing" | "tool_calling_unsupported";
}

export interface CodexRunReadiness {
  ready: boolean;
  reason?: string;
  envKey?: string;
  resolvedUrl?: string;
}

const ENV_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OS_ENV_REGEX = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|LANG|LC_ALL|TERM)$/i;

function sanitizeError(msg: string): never {
  throw new Error(msg);
}

export function validateSafeEnvironmentKey(key: string): void {
  if (typeof key !== "string" || !ENV_NAME_REGEX.test(key)) {
    sanitizeError("Environment key reference must be a valid environment variable identifier.");
  }
  if (OS_ENV_REGEX.test(key) || /^(CODEX_|MULTIAGENTS_|BUN_|NODE_|OPENAI_BASE_URL$)/i.test(key)) {
    sanitizeError("Environment key must not use reserved OS or runtime variable names.");
  }
}

export function deriveEnvKey(providerName: string): string {
  const stem = providerName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  const key = `${stem}_API_KEY`;
  if (!stem || !ENV_NAME_REGEX.test(key) || OS_ENV_REGEX.test(key)) {
    return "CUSTOM_PROVIDER_API_KEY";
  }
  return key;
}

export function validateUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== "string" || !rawUrl.trim() || /[\x00-\x1f\x7f]/.test(rawUrl)) {
    sanitizeError("Invalid provider endpoint URL.");
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    sanitizeError("Invalid model endpoint URL.");
  }
  // Reject query, fragment, credentials, and non-http(s) protocols
  if (!/^https?:\/\//i.test(rawUrl) || /[\\\s?#]/.test(rawUrl)
    || parsed.username || parsed.password || parsed.search || parsed.hash
    || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
    sanitizeError("Model endpoint must be HTTP(S) without credentials, query, or fragment.");
  }
  const authority = rawUrl.slice(rawUrl.indexOf("://") + 3).split("/")[0]!;
  if (authority.includes("@")) {
    sanitizeError("Model endpoint must not contain credentials.");
  }
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (parsed.protocol === "http:" && !isLocal) {
    sanitizeError("Remote model endpoints require HTTPS.");
  }
  return parsed.href;
}

function configurationObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    sanitizeError("Configuration must contain plain objects.");
  }
  if (Object.keys(value).some(key => !fields.includes(key))) {
    sanitizeError("Unsupported configuration fields; session memory, credentials and machine bindings cannot be imported.");
  }
  return value as Record<string, unknown>;
}

function configurationText(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || /[\x00-\x1f\x7f]/.test(value)) {
    sanitizeError("Invalid configuration text.");
  }
  return value;
}

function portableProvider(value: unknown): Omit<ProviderMetadata, "isDiscovered"> {
  const p = configurationObject(value, ["id", "name", "protocol", "baseUrl", "models", "envKeyRef"]);
  if (!Array.isArray(p.models)) sanitizeError("Provider models must be an array.");
  const models = p.models.map(value => {
    const m = configurationObject(value, ["id", "name", "capabilities", "url"]);
    const c = configurationObject(m.capabilities, ["toolCalling", "vision", "zeroDataRetentionEnabled", "maxInputTokens", "maxOutputTokens"]);
    const capabilities: ModelCapability = {};
    for (const field of ["toolCalling", "vision", "zeroDataRetentionEnabled"] as const) {
      if (c[field] !== undefined) {
        if (typeof c[field] !== "boolean") sanitizeError("Invalid model capability flag.");
        capabilities[field] = c[field];
      }
    }
    for (const field of ["maxInputTokens", "maxOutputTokens"] as const) {
      if (c[field] !== undefined) {
        if (typeof c[field] !== "number" || !Number.isSafeInteger(c[field]) || c[field] <= 0) {
          sanitizeError("Invalid model token limit.");
        }
        capabilities[field] = c[field];
      }
    }
    return {
      id: configurationText(m.id),
      name: configurationText(m.name),
      capabilities,
      url: m.url === undefined ? undefined : validateUrl(m.url),
    };
  });
  return {
    id: configurationText(p.id),
    name: configurationText(p.name),
    protocol: configurationText(p.protocol) as ProviderProtocol,
    baseUrl: validateUrl(p.baseUrl),
    models,
    envKeyRef: p.envKeyRef === undefined ? undefined : configurationText(p.envKeyRef),
  };
}

export class ProviderSettingsManager {
  private providers = new Map<string, ProviderMetadata>();

  constructor(initialProviders?: ProviderMetadata[]) {
    if (initialProviders) {
      for (const p of initialProviders) {
        this.registerProvider(p);
      }
    }
  }

  listProviders(): ProviderMetadata[] {
    return Array.from(this.providers.values()).map(p => ({
      ...p,
      models: p.models.map(m => ({ ...m, capabilities: { ...m.capabilities } })),
    }));
  }

  getProvider(providerId: string): ProviderMetadata | undefined {
    const p = this.providers.get(providerId);
    if (!p) return undefined;
    return {
      ...p,
      models: p.models.map(m => ({ ...m, capabilities: { ...m.capabilities } })),
    };
  }

  registerProvider(provider: ProviderMetadata): void {
    if (!provider || typeof provider !== "object") {
      sanitizeError("Invalid provider object.");
    }
    if (typeof provider.id !== "string" || !provider.id.trim() || !/^[A-Za-z0-9_.-]+$/.test(provider.id)) {
      sanitizeError("Provider ID must be non-empty alphanumeric with optional dashes or underscores.");
    }
    if (typeof provider.name !== "string" || !provider.name.trim()) {
      sanitizeError("Provider name must be non-empty.");
    }
    if (!provider.protocol || !SUPPORTED_PROTOCOLS.includes(provider.protocol)) {
      sanitizeError("Unsupported provider protocol.");
    }

    const validatedBaseUrl = validateUrl(provider.baseUrl);

    const envKeyRef = provider.envKeyRef !== undefined
      ? provider.envKeyRef
      : deriveEnvKey(provider.name);

    validateSafeEnvironmentKey(envKeyRef);

    if (!Array.isArray(provider.models)) {
      sanitizeError("Provider models must be an array.");
    }

    const seenModelIds = new Set<string>();
    const validatedModels: ModelMetadata[] = [];
    for (const m of provider.models) {
      if (!m || typeof m !== "object" || typeof m.id !== "string" || !m.id.trim()) {
        sanitizeError("Model metadata requires a valid non-empty id.");
      }
      if (seenModelIds.has(m.id)) {
        sanitizeError("Duplicate model ID within provider.");
      }
      seenModelIds.add(m.id);

      const caps: ModelCapability = {
        toolCalling: m.capabilities?.toolCalling === true,
        vision: m.capabilities?.vision === true,
        zeroDataRetentionEnabled: m.capabilities?.zeroDataRetentionEnabled === true,
      };
      if (m.capabilities?.maxInputTokens !== undefined) {
        if (!Number.isSafeInteger(m.capabilities.maxInputTokens) || m.capabilities.maxInputTokens <= 0) {
          sanitizeError("maxInputTokens must be a positive integer.");
        }
        caps.maxInputTokens = m.capabilities.maxInputTokens;
      }
      if (m.capabilities?.maxOutputTokens !== undefined) {
        if (!Number.isSafeInteger(m.capabilities.maxOutputTokens) || m.capabilities.maxOutputTokens <= 0) {
          sanitizeError("maxOutputTokens must be a positive integer.");
        }
        caps.maxOutputTokens = m.capabilities.maxOutputTokens;
      }

      validatedModels.push({
        id: m.id,
        name: typeof m.name === "string" && m.name.trim() ? m.name : m.id,
        capabilities: caps,
        url: m.url ? validateUrl(m.url) : undefined,
      });
    }

    this.providers.set(provider.id, {
      id: provider.id,
      name: provider.name,
      protocol: provider.protocol,
      baseUrl: validatedBaseUrl,
      models: validatedModels,
      envKeyRef,
      isDiscovered: provider.isDiscovered === true,
    });
  }

  removeProvider(providerId: string): boolean {
    return this.providers.delete(providerId);
  }

  async discoverFromCatalog(
    catalogPath?: string,
    projectDir?: string,
    env: Record<string, string | undefined> = process.env
  ): Promise<ProviderMetadata[]> {
    const catalog = await listModels(catalogPath, projectDir, env);
    const discoveredMap = new Map<string, ProviderMetadata>();
    const slugToProviderName = new Map<string, string>();

    for (const model of catalog.models) {
      const providerId = model.provider.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-");
      const existingName = slugToProviderName.get(providerId);
      if (existingName && existingName !== model.provider) {
        sanitizeError("Discovered provider name slug collision.");
      }
      slugToProviderName.set(providerId, model.provider);

      let existing = discoveredMap.get(providerId);
      if (!existing) {
        existing = {
          id: providerId,
          name: model.provider,
          protocol: "responses",
          baseUrl: model.url.replace(/\/+$/, "").replace(/\/responses$/, ""),
          models: [],
          envKeyRef: model.envKey,
          isDiscovered: true,
        };
        discoveredMap.set(providerId, existing);
      }
      existing.models.push({
        id: model.model,
        name: model.name,
        url: validateUrl(model.url),
        capabilities: {
          toolCalling: model.toolCalling === true,
          vision: model.vision === true,
          zeroDataRetentionEnabled: model.zeroDataRetentionEnabled === true,
          maxInputTokens: model.maxInputTokens,
          maxOutputTokens: model.maxOutputTokens,
        },
      });
    }

    const discoveredList = Array.from(discoveredMap.values());
    for (const p of discoveredList) {
      this.registerProvider(p);
    }
    return discoveredList;
  }

  exportCatalog(): ProviderExportPackage {
    // Enumerate configuration fields so future runtime fields never enter exports.
    const exportProviders = Array.from(this.providers.values()).map(p => portableProvider({
      id: p.id,
      name: p.name,
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      envKeyRef: p.envKeyRef,
      models: p.models.map(m => ({
        id: m.id,
        name: m.name,
        url: m.url,
        capabilities: {
          toolCalling: m.capabilities.toolCalling,
          vision: m.capabilities.vision,
          zeroDataRetentionEnabled: m.capabilities.zeroDataRetentionEnabled,
          maxInputTokens: m.capabilities.maxInputTokens,
          maxOutputTokens: m.capabilities.maxOutputTokens,
        },
      })),
    }));

    return {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      providers: exportProviders,
    };
  }

  importCatalog(input: unknown): { imported: number; errors: string[] } {
    try {
      const pkg = configurationObject(input, ["version", "exportedAt", "providers"]);
      if (pkg.version !== "1.0" || !Array.isArray(pkg.providers)
        || typeof pkg.exportedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(pkg.exportedAt)
        || !Number.isFinite(Date.parse(pkg.exportedAt))) {
        sanitizeError("Invalid catalog export format or unsupported version.");
      }
      // Validate the entire batch before changing any destination configuration.
      const staged = new ProviderSettingsManager();
      for (const entry of pkg.providers) {
        const provider = portableProvider(entry);
        if (staged.providers.has(provider.id) || this.providers.has(provider.id)) {
          sanitizeError("Provider ID conflict; existing destination configuration is preserved.");
        }
        staged.registerProvider(provider);
      }
      for (const [id, provider] of staged.providers) this.providers.set(id, provider);
      return { imported: staged.providers.size, errors: [] };
    } catch {
      // Do not echo input values, property names or exception messages containing user data.
      return { imported: 0, errors: ["Configuration import rejected: invalid schema or provider ID conflict. Destination unchanged."] };
    }
  }

  /**
   * Projects registered providers using 'responses' protocol to the VS Code custom endpoint
   * JSON structure expected by model-providers.ts listModels and launcher.ts.
   * Preserves per-model URLs. Does NOT write secrets; uses deterministic ${env:ENV_KEY} references.
   */
  buildRuntimeCatalog(providerIds?: string[]): any[] {
    const targetProviders = providerIds
      ? providerIds.map(id => this.providers.get(id)).filter(Boolean) as ProviderMetadata[]
      : Array.from(this.providers.values());

    const catalogEntries = [];
    for (const provider of targetProviders) {
      if (provider.protocol !== "responses") continue;
      const envKey = provider.envKeyRef || deriveEnvKey(provider.name);
      catalogEntries.push({
        name: provider.id,
        vendor: "customendpoint",
        apiType: "responses",
        apiKey: `\${env:${envKey}}`,
        models: provider.models.map(m => ({
          id: m.id,
          name: m.name,
          url: m.url || (provider.baseUrl.endsWith("/responses") ? provider.baseUrl : `${provider.baseUrl.replace(/\/+$/, "")}/responses`),
          toolCalling: m.capabilities.toolCalling === true,
          vision: m.capabilities.vision === true,
          zeroDataRetentionEnabled: m.capabilities.zeroDataRetentionEnabled === true,
          maxInputTokens: m.capabilities.maxInputTokens,
          maxOutputTokens: m.capabilities.maxOutputTokens,
        })),
      });
    }

    return catalogEntries;
  }

  /**
   * Alias for buildRuntimeCatalog.
   */
  projectToCatalogFileFormat(providerIds?: string[]): any[] {
    return this.buildRuntimeCatalog(providerIds);
  }

  async saveToFile(filePath: string): Promise<void> {
    const targetPath = resolve(filePath);
    await mkdir(dirname(targetPath), { recursive: true });
    const pkg = this.exportCatalog();
    await Bun.write(targetPath, JSON.stringify(pkg, null, 2) + "\n");
  }

  async loadFromFile(filePath: string): Promise<{ loaded: number; errors: string[] }> {
    const targetPath = resolve(filePath);
    let raw: unknown;
    try {
      raw = await Bun.file(targetPath).json();
    } catch {
      sanitizeError("Cannot read provider settings file as JSON.");
    }
    const res = this.importCatalog(raw); return { loaded: res.imported, errors: res.errors };
  }

  validateCodexRunReadiness(
    providerId: string,
    modelId: string,
    hasCredentialCheck: (envKey: string, providerId: string) => boolean
  ): CodexRunReadiness {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return { ready: false, reason: `Provider '${providerId}' not found in catalog.` };
    }
    if (provider.protocol !== "responses") {
      return {
        ready: false,
        reason: `Launcher constraint: Codex workers require protocol 'responses', but '${providerId}' declares '${provider.protocol}'.`,
      };
    }

    const model = provider.models.find(m => m.id === modelId);
    if (!model) {
      return { ready: false, reason: `Model '${modelId}' not found in provider '${providerId}'.` };
    }
    if (model.capabilities.toolCalling !== true) {
      return {
        ready: false,
        reason: `Launcher constraint: Model '${modelId}' does not support toolCalling, which is required for Codex workers.`,
      };
    }

    const envKey = provider.envKeyRef || deriveEnvKey(provider.name);
    if (!hasCredentialCheck(envKey, providerId)) {
      return {
        ready: false,
        reason: `Credential missing for provider '${providerId}' (${envKey}).`,
        envKey,
      };
    }

    const resolvedUrl = model.url || (provider.baseUrl.endsWith("/responses") ? provider.baseUrl : `${provider.baseUrl.replace(/\/+$/, "")}/responses`);
    return {
      ready: true,
      envKey,
      resolvedUrl,
    };
  }

  checkTemplateCompatibility(requirements: {
    agentId: string;
    providerId: string;
    modelId: string;
    requireToolCalling?: boolean;
  }[]): RemapRequirement[] {
    const unmapped: RemapRequirement[] = [];

    for (const req of requirements) {
      const provider = this.providers.get(req.providerId);
      if (!provider) {
        unmapped.push({
          templateAgentId: req.agentId,
          missingProviderId: req.providerId,
          missingModelId: req.modelId,
          reason: "provider_missing",
        });
        continue;
      }

      const model = provider.models.find(m => m.id === req.modelId);
      if (!model) {
        unmapped.push({
          templateAgentId: req.agentId,
          missingProviderId: req.providerId,
          missingModelId: req.modelId,
          reason: "model_missing",
        });
        continue;
      }

      if (req.requireToolCalling && model.capabilities.toolCalling !== true) {
        unmapped.push({
          templateAgentId: req.agentId,
          missingProviderId: req.providerId,
          missingModelId: req.modelId,
          reason: "tool_calling_unsupported",
        });
      }
    }

    return unmapped;
  }
}
