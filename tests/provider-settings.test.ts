import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ProviderSettingsManager,
  deriveEnvKey,
  validateUrl,
  validateSafeEnvironmentKey,
  type ProviderMetadata,
  type ProviderExportPackage,
} from "../shared/provider-settings.ts";

describe("ProviderSettingsManager", () => {
  let manager: ProviderSettingsManager;
  let tempDir: string;

  const validProvider: ProviderMetadata = {
    id: "provider-custom",
    name: "Custom LLM Provider",
    protocol: "responses",
    baseUrl: "https://api.example.com/v1",
    models: [
      {
        id: "model-reasoning",
        name: "Reasoning Model v1",
        capabilities: {
          toolCalling: true,
          vision: false,
          maxInputTokens: 128000,
          maxOutputTokens: 4096,
        },
      },
      {
        id: "model-fast",
        name: "Fast Model",
        capabilities: {
          toolCalling: false,
        },
      },
    ],
    envKeyRef: "CUSTOM_API_KEY",
  };

  beforeEach(async () => {
    manager = new ProviderSettingsManager();
    tempDir = await mkdtemp(join(tmpdir(), "provider-settings-test-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("registers and lists providers with intact capability metadata and derived env key", () => {
    manager.registerProvider(validProvider);
    const providers = manager.listProviders();
    expect(providers.length).toBe(1);
    expect(providers[0].id).toBe("provider-custom");
    expect(providers[0].models.length).toBe(2);
    expect(providers[0].models[0].capabilities.toolCalling).toBe(true);

    const retrieved = manager.getProvider("provider-custom");
    expect(retrieved?.name).toBe("Custom LLM Provider");

    expect(deriveEnvKey("My Custom Provider")).toBe("MY_CUSTOM_PROVIDER_API_KEY");
  });

  it("rejects invalid provider IDs, URLs, and duplicate model IDs", () => {
    expect(() => {
      manager.registerProvider({ ...validProvider, id: "invalid spaces" });
    }).toThrow("Provider ID must be non-empty alphanumeric");

    expect(() => {
      manager.registerProvider({ ...validProvider, baseUrl: "ftp://example.com" });
    }).toThrow("Model endpoint must be HTTP(S)");

    expect(() => {
      manager.registerProvider({ ...validProvider, baseUrl: "http://remote-site.com" });
    }).toThrow("Remote model endpoints require HTTPS.");

    expect(() => {
      manager.registerProvider({
        ...validProvider,
        models: [
          { id: "dup", name: "D1", capabilities: {} },
          { id: "dup", name: "D2", capabilities: {} },
        ],
      });
    }).toThrow("Duplicate model ID within provider.");

    expect(() => {
      manager.registerProvider({ ...validProvider, envKeyRef: "INVALID-KEY-NAME!" });
    }).toThrow("Environment key reference must be a valid environment variable identifier.");
  });

  it("rejects token-bearing URLs with query or fragment parameters", () => {
    expect(() => {
      validateUrl("https://api.example.com/v1?token=secret123");
    }).toThrow("Model endpoint must be HTTP(S) without credentials, query, or fragment.");

    expect(() => {
      validateUrl("https://api.example.com/v1#fragment");
    }).toThrow("Model endpoint must be HTTP(S) without credentials, query, or fragment.");

    expect(() => {
      validateUrl("https://user:pass@api.example.com/v1");
    }).toThrow("Model endpoint must be HTTP(S) without credentials, query, or fragment.");
  });

  it("rejects unsupported protocols and reserved OS environment variables", () => {
    expect(() => {
      manager.registerProvider({
        ...validProvider,
        protocol: "arbitrary-protocol" as any,
      });
    }).toThrow("Unsupported provider protocol.");

    expect(() => {
      validateSafeEnvironmentKey("PATH");
    }).toThrow("Environment key must not use reserved OS or runtime variable names.");

    expect(() => {
      validateSafeEnvironmentKey("CODEX_API_KEY");
    }).toThrow("Environment key must not use reserved OS or runtime variable names.");
  });

  it("exports safe, allowlisted metadata stripped of runtime discovery flags", () => {
    manager.registerProvider({
      ...validProvider,
      isDiscovered: true,
    });

    const exported = manager.exportCatalog();
    expect(exported.version).toBe("1.0");
    expect(typeof exported.exportedAt).toBe("string");
    expect(exported.providers.length).toBe(1);
    expect(exported.providers[0].id).toBe("provider-custom");
    expect((exported.providers[0] as any).isDiscovered).toBeUndefined();
    expect(exported.providers[0].envKeyRef).toBe("CUSTOM_API_KEY");
  });

  it("imports valid catalog packages and reports errors cleanly", () => {
    const pkg: ProviderExportPackage = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      providers: [
        {
          id: "imported-provider",
          name: "Imported Service",
          protocol: "responses",
          baseUrl: "https://imported.example.com",
          models: [{ id: "m1", name: "M1", capabilities: { toolCalling: true } }],
          envKeyRef: "IMPORTED_KEY",
        },
      ],
    };

    const result = manager.importCatalog(pkg);
    expect(result.imported).toBe(1);
    expect(result.errors.length).toBe(0);

    const imported = manager.getProvider("imported-provider");
    expect(imported).toBeDefined();
    expect(imported?.baseUrl).toBe("https://imported.example.com/");
    expect(imported?.isDiscovered).toBe(false);

    // Invalid package rejection
    const invalidResult = manager.importCatalog({} as any);
    expect(invalidResult.imported).toBe(0);
    expect(invalidResult.errors.length).toBe(1);
  });

  it("rejects unknown memory, session, key, and path fields at all 4 schema levels", () => {
    const basePkg: ProviderExportPackage = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      providers: [
        {
          id: "clean-provider",
          name: "Clean Provider",
          protocol: "responses",
          baseUrl: "https://clean.example.com",
          models: [
            {
              id: "clean-model",
              name: "Clean Model",
              capabilities: { toolCalling: true },
              url: "https://clean.example.com/responses",
            },
          ],
          envKeyRef: "CLEAN_API_KEY",
        },
      ],
    };

    // Level 1: Root level unknown fields (session, local path, memory)
    const rootUnknown1 = { ...basePkg, session_id: "sess-1234" };
    expect(manager.importCatalog(rootUnknown1).imported).toBe(0);

    const rootUnknown2 = { ...basePkg, local_path: "/home/user/repo" };
    expect(manager.importCatalog(rootUnknown2).imported).toBe(0);

    const rootUnknown3 = { ...basePkg, memory: { conversation: "history" } };
    expect(manager.importCatalog(rootUnknown3).imported).toBe(0);

    // Level 2: Provider level unknown fields (api key, machine path, secret)
    const providerUnknown1 = {
      ...basePkg,
      providers: [
        {
          ...basePkg.providers[0],
          apiKey: "sk-plain-secret-key",
        },
      ],
    };
    expect(manager.importCatalog(providerUnknown1).imported).toBe(0);

    const providerUnknown2 = {
      ...basePkg,
      providers: [
        {
          ...basePkg.providers[0],
          machine_path: "C:\\Users\\admin",
        },
      ],
    };
    expect(manager.importCatalog(providerUnknown2).imported).toBe(0);

    // Level 3: Model level unknown fields (weights path, session history, credentials)
    const modelUnknown = {
      ...basePkg,
      providers: [
        {
          ...basePkg.providers[0],
          models: [
            {
              ...basePkg.providers[0].models[0],
              weights_path: "/opt/models/weights.bin",
              session_history: "prompt transcript",
            },
          ],
        },
      ],
    };
    expect(manager.importCatalog(modelUnknown).imported).toBe(0);

    // Level 4: Capabilities level unknown fields (memory limit, custom parameters)
    const capUnknown = {
      ...basePkg,
      providers: [
        {
          ...basePkg.providers[0],
          models: [
            {
              ...basePkg.providers[0].models[0],
              capabilities: {
                toolCalling: true,
                memory_limit_mb: 8192,
                auth_token: "leaked_token",
              } as any,
            },
          ],
        },
      ],
    };
    expect(manager.importCatalog(capUnknown).imported).toBe(0);

    // Ensure destination remained completely empty across all rejections
    expect(manager.listProviders().length).toBe(0);
  });

  it("preserves destination atomically when trailing record is malformed or has ID conflict", () => {
    // Register initial provider in destination
    manager.registerProvider(validProvider);
    expect(manager.listProviders().length).toBe(1);

    const timestamp = new Date().toISOString();

    // Batch where Record 1 is valid, but Record 2 has an unknown field
    const batchWithTrailingMalformed = {
      version: "1.0" as const,
      exportedAt: timestamp,
      providers: [
        {
          id: "valid-staged-provider",
          name: "Valid Staged",
          protocol: "responses" as const,
          baseUrl: "https://staged.example.com",
          models: [{ id: "m-staged", name: "M", capabilities: { toolCalling: true } }],
        },
        {
          id: "invalid-trailing-provider",
          name: "Invalid Trailing",
          protocol: "responses" as const,
          baseUrl: "https://invalid.example.com",
          models: [{ id: "m-inv", name: "M", capabilities: {} }],
          unknown_trailing_leak: "should fail batch",
        },
      ],
    };

    const res1 = manager.importCatalog(batchWithTrailingMalformed);
    expect(res1.imported).toBe(0);
    expect(res1.errors.length).toBeGreaterThan(0);
    // Destination remains strictly 1 provider (valid-staged-provider was rolled back)
    expect(manager.listProviders().length).toBe(1);
    expect(manager.getProvider("valid-staged-provider")).toBeUndefined();
    expect(manager.getProvider("provider-custom")).toBeDefined();

    // Batch with ID conflict against existing destination provider
    const batchWithIdConflict = {
      version: "1.0" as const,
      exportedAt: timestamp,
      providers: [
        {
          id: "provider-custom", // Collides with existing ID
          name: "Colliding Provider Name",
          protocol: "responses" as const,
          baseUrl: "https://collision.example.com",
          models: [{ id: "m-col", name: "M", capabilities: {} }],
        },
      ],
    };

    const res2 = manager.importCatalog(batchWithIdConflict);
    expect(res2.imported).toBe(0);
    expect(res2.errors[0]).toContain("conflict");
    // Existing provider metadata was untouched
    expect(manager.getProvider("provider-custom")?.name).toBe("Custom LLM Provider");
  });

  it("accepts and preserves model IDs containing slashes across export, import, and catalog projection", () => {
    const slashProvider: ProviderMetadata = {
      id: "slash-provider",
      name: "Slash Models Provider",
      protocol: "responses",
      baseUrl: "https://slash.example.com",
      models: [
        {
          id: "meta-llama/Llama-3-70b-instruct",
          name: "Llama 3 70B",
          capabilities: { toolCalling: true, vision: true },
        },
        {
          id: "anthropic/claude-3-5-sonnet",
          name: "Claude 3.5 Sonnet",
          capabilities: { toolCalling: true },
        },
        {
          id: "deepseek-ai/DeepSeek-R1",
          name: "DeepSeek R1",
          capabilities: { toolCalling: true },
        },
      ],
      envKeyRef: "SLASH_API_KEY",
    };

    manager.registerProvider(slashProvider);
    const retrieved = manager.getProvider("slash-provider");
    expect(retrieved?.models.length).toBe(3);
    expect(retrieved?.models[0].id).toBe("meta-llama/Llama-3-70b-instruct");
    expect(retrieved?.models[1].id).toBe("anthropic/claude-3-5-sonnet");
    expect(retrieved?.models[2].id).toBe("deepseek-ai/DeepSeek-R1");

    // Export retains slash model IDs
    const pkg = manager.exportCatalog();
    expect(pkg.providers[0].models[0].id).toBe("meta-llama/Llama-3-70b-instruct");

    // Fresh manager imports slash model IDs cleanly
    const freshManager = new ProviderSettingsManager();
    const importRes = freshManager.importCatalog(pkg);
    expect(importRes.imported).toBe(1);
    expect(freshManager.getProvider("slash-provider")?.models[0].id).toBe("meta-llama/Llama-3-70b-instruct");

    // buildRuntimeCatalog retains slash model IDs
    const runtimeEntries = freshManager.buildRuntimeCatalog();
    expect(runtimeEntries[0].models[0].id).toBe("meta-llama/Llama-3-70b-instruct");
    expect(runtimeEntries[0].models[1].id).toBe("anthropic/claude-3-5-sonnet");
  });

  it("strictly excludes synthetic runtime markers and unallowlisted properties from exportCatalog", () => {
    manager.registerProvider({
      ...validProvider,
      isDiscovered: true,
    });

    // Artificially attach synthetic runtime properties to internal map
    const internalProv = (manager as any).providers.get("provider-custom");
    internalProv.syntheticMarker = "leak_marker";
    internalProv.cachedAuthStatus = "active";
    internalProv.models[0].temporarySessionId = "sess-abc";

    const exported = manager.exportCatalog();
    const jsonStr = JSON.stringify(exported);

    expect(jsonStr.includes("isDiscovered")).toBe(false);
    expect(jsonStr.includes("syntheticMarker")).toBe(false);
    expect(jsonStr.includes("cachedAuthStatus")).toBe(false);
    expect(jsonStr.includes("temporarySessionId")).toBe(false);

    // Exact key allowlists
    expect(Object.keys(exported.providers[0]).sort()).toEqual([
      "baseUrl",
      "envKeyRef",
      "id",
      "models",
      "name",
      "protocol",
    ]);
    expect(Object.keys(exported.providers[0].models[0]).sort()).toEqual([
      "capabilities",
      "id",
      "name",
      "url",
    ]);
  });

  it("discovers providers from local catalog files preserving per-model URLs and detecting slug collisions", async () => {
    const catalogPath = join(tempDir, "chatLanguageModels.json");
    const rawCatalog = [
      {
        name: "Provider Alpha",
        vendor: "customendpoint",
        apiType: "responses",
        apiKey: "${env:ALPHA_KEY}",
        models: [
          {
            id: "alpha-chat",
            name: "Alpha Chat Model",
            url: "https://alpha.example.com/v1/responses",
            toolCalling: true,
          },
        ],
      },
      {
        name: "Provider Beta",
        vendor: "customendpoint",
        apiType: "responses",
        apiKey: "${env:BETA_KEY}",
        models: [
          {
            id: "beta-reasoning",
            name: "Beta Model",
            url: "https://beta.example.com/api/responses",
            toolCalling: true,
          },
        ],
      },
    ];
    await Bun.write(catalogPath, JSON.stringify(rawCatalog));

    const discovered = await manager.discoverFromCatalog(catalogPath, tempDir, {
      ALPHA_KEY: "alpha-secret",
      BETA_KEY: "beta-secret",
    });

    expect(discovered.length).toBe(2);
    expect(discovered[0].models[0].url).toBe("https://alpha.example.com/v1/responses");
    expect(discovered[1].models[0].url).toBe("https://beta.example.com/api/responses");

    // Slug collision test
    const collidingCatalogPath = join(tempDir, "colliding.json");
    const collidingCatalog = [
      {
        name: "Provider Custom",
        vendor: "customendpoint",
        apiType: "responses",
        apiKey: "${env:K1}",
        models: [{ id: "m1", name: "M1", url: "https://p1.example.com/responses" }],
      },
      {
        name: "Provider-Custom", // Different name, same slug "provider-custom"
        vendor: "customendpoint",
        apiType: "responses",
        apiKey: "${env:K2}",
        models: [{ id: "m2", name: "M2", url: "https://p2.example.com/responses" }],
      },
    ];
    await Bun.write(collidingCatalogPath, JSON.stringify(collidingCatalog));

    const collisionManager = new ProviderSettingsManager();
    expect(
      collisionManager.discoverFromCatalog(collidingCatalogPath, tempDir, { K1: "v1", K2: "v2" })
    ).rejects.toThrow("Discovered provider name slug collision.");
  });

  it("saves to file and reloads cleanly", async () => {
    manager.registerProvider(validProvider);
    const savePath = join(tempDir, "sub", "saved-providers.json");

    await manager.saveToFile(savePath);

    const reloadedManager = new ProviderSettingsManager();
    const result = await reloadedManager.loadFromFile(savePath);

    expect(result.loaded).toBe(1);
    expect(result.errors.length).toBe(0);
    expect(reloadedManager.getProvider("provider-custom")?.name).toBe("Custom LLM Provider");
  });

  it("builds launcher-compatible runtime catalog format preserving model URLs without secrets", () => {
    manager.registerProvider(validProvider);
    const catalogFormat = manager.buildRuntimeCatalog();
    expect(catalogFormat.length).toBe(1);
    expect(catalogFormat[0].name).toBe("provider-custom");
    expect(catalogFormat[0].vendor).toBe("customendpoint");
    expect(catalogFormat[0].apiType).toBe("responses");
    expect(catalogFormat[0].apiKey).toBe("${env:CUSTOM_API_KEY}");
    expect(catalogFormat[0].models[0].url).toBe("https://api.example.com/v1/responses");
    expect(catalogFormat[0].models[0].toolCalling).toBe(true);
  });

  it("validates codex run readiness enforcing responses protocol, toolCalling, and credentials", () => {
    manager.registerProvider(validProvider);
    manager.registerProvider({
      ...validProvider,
      id: "provider-anthropic",
      protocol: "anthropic",
      name: "Anthropic Native",
      envKeyRef: "ANTHROPIC_CUSTOM_KEY",
    });

    // Valid case
    const ok = manager.validateCodexRunReadiness("provider-custom", "model-reasoning", () => true);
    expect(ok.ready).toBe(true);
    expect(ok.envKey).toBe("CUSTOM_API_KEY");
    expect(ok.resolvedUrl).toBe("https://api.example.com/v1/responses");

    // Unsupported protocol for launcher
    const badProto = manager.validateCodexRunReadiness("provider-anthropic", "model-reasoning", () => true);
    expect(badProto.ready).toBe(false);
    expect(badProto.reason).toContain("Codex workers require protocol 'responses'");

    // Missing toolCalling
    const noTools = manager.validateCodexRunReadiness("provider-custom", "model-fast", () => true);
    expect(noTools.ready).toBe(false);
    expect(noTools.reason).toContain("does not support toolCalling");

    // Missing credential
    const noCred = manager.validateCodexRunReadiness("provider-custom", "model-reasoning", () => false);
    expect(noCred.ready).toBe(false);
    expect(noCred.reason).toContain("Credential missing");
  });

  it("checks template compatibility and flags missing providers, models, or toolCalling support", () => {
    manager.registerProvider(validProvider);

    const checks = manager.checkTemplateCompatibility([
      { agentId: "agent-ok", providerId: "provider-custom", modelId: "model-reasoning", requireToolCalling: true },
      { agentId: "agent-missing-provider", providerId: "missing-prov", modelId: "any-model" },
      { agentId: "agent-missing-model", providerId: "provider-custom", modelId: "unknown-model" },
      { agentId: "agent-tool-call-failed", providerId: "provider-custom", modelId: "model-fast", requireToolCalling: true },
    ]);

    expect(checks.length).toBe(3);
    expect(checks.find(c => c.templateAgentId === "agent-missing-provider")?.reason).toBe("provider_missing");
    expect(checks.find(c => c.templateAgentId === "agent-missing-model")?.reason).toBe("model_missing");
    expect(checks.find(c => c.templateAgentId === "agent-tool-call-failed")?.reason).toBe("tool_calling_unsupported");
  });
});
