import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { listModels, resolveModelSelection } from "../shared/model-providers.ts";
import type { ModelSelection } from "../shared/model-providers.ts";

const directories: string[] = [];
const SECRET = "synthetic-credential-never-output";

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function model(overrides: Record<string, unknown> = {}) {
  return {
    id: "route/team/gpt-model",
    name: "Model display name",
    url: "https://models.example.test/v1/responses",
    toolCalling: true,
    vision: true,
    zeroDataRetentionEnabled: true,
    maxInputTokens: 200000,
    maxOutputTokens: 32000,
    ...overrides,
  };
}

function provider(overrides: Record<string, unknown> = {}) {
  return {
    name: "Hollow",
    vendor: "customendpoint",
    apiType: "responses",
    apiKey: "${input:chat.lm.secret.hollow}",
    models: [model()],
    ...overrides,
  };
}

async function fixture(raw: unknown = [provider()]) {
  const directory = mkdtempSync(join(tmpdir(), "multiagents-model-providers-"));
  directories.push(directory);
  const file = join(directory, "catalog.json");
  await Bun.write(file, JSON.stringify(raw));
  return { directory, file };
}

async function errorMessage(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(SECRET);
    return (error as Error).message;
  }
  throw new Error("Expected operation to reject.");
}

describe("model provider registry", () => {
  test("lists safe sample-like metadata without credentials, resolves independent providers and opaque IDs", async () => {
    const { file, directory } = await fixture([
      provider({ ignoredSecret: SECRET, models: [model({ ignoredSecret: SECRET })] }),
      provider({ name: "ADNX", apiKey: "${env:ADNX_CUSTOM_KEY}", models: [model({ url: "https://adnx.example.test/v1" })] }),
    ]);
    const listed = await listModels(file, directory, {});
    expect(listed.catalog_path).toBe(resolve(file));
    expect(listed.models).toEqual([
      { provider: "Hollow", model: "route/team/gpt-model", name: "Model display name", url: "https://models.example.test/v1/responses", envKey: "HOLLOW_API_KEY", toolCalling: true, vision: true, zeroDataRetentionEnabled: true, maxInputTokens: 200000, maxOutputTokens: 32000 },
      { provider: "ADNX", model: "route/team/gpt-model", name: "Model display name", url: "https://adnx.example.test/v1", envKey: "ADNX_CUSTOM_KEY", toolCalling: true, vision: true, zeroDataRetentionEnabled: true, maxInputTokens: 200000, maxOutputTokens: 32000 },
    ]);
    expect(JSON.stringify(listed)).not.toContain(SECRET);
    expect(JSON.stringify(listed)).not.toContain("chat.lm.secret");
    const env = { HOLLOW_API_KEY: SECRET, ADNX_CUSTOM_KEY: `${SECRET}-adnx` };
    const input = { provider: "Hollow", model: "route/team/gpt-model", catalog_path: file };
    const [hollow, adnx] = await Promise.all([
      resolveModelSelection(input, directory, env),
      resolveModelSelection({ ...input, provider: "ADNX" }, directory, env),
    ]);
    expect(hollow.selection).toEqual(input);
    expect(hollow.selection).not.toBe(input);
    expect(hollow.modelId).toBe(input.model);
    expect(hollow.envKey).toBe("HOLLOW_API_KEY");
    expect(adnx.envKey).toBe("ADNX_CUSTOM_KEY");
    expect(hollow.baseUrl).toBe("https://models.example.test/v1");
    expect(adnx.baseUrl).toBe("https://adnx.example.test/v1");
    expect(hollow.providerName).toBe("Hollow");
    expect(hollow.codexArgs).toEqual([
      "-c", 'model_provider="multiagents_custom"',
      "-c", 'model="route/team/gpt-model"',
      "-c", 'model_providers.multiagents_custom={ name = "Hollow", base_url = "https://models.example.test/v1", env_key = "HOLLOW_API_KEY", wire_api = "responses", requires_openai_auth = false }',
    ]);
    for (const result of [hollow, adnx]) {
      expect(JSON.stringify(result)).not.toContain(SECRET);
      const config: Record<string, unknown> = {};
      for (let i = 0; i < result.codexArgs.length; i += 2) {
        expect(result.codexArgs[i]).toBe("-c");
        Object.assign(config, Bun.TOML.parse(result.codexArgs[i + 1]!));
      }
      expect(config.model).toBe(input.model);
      expect(config.model_provider).toBe("multiagents_custom");
      const table = (config.model_providers as Record<string, unknown>).multiagents_custom;
      expect(table).toEqual({ name: result.providerName, base_url: result.baseUrl, env_key: result.envKey, wire_api: "responses", requires_openai_auth: false });
    }
    hollow.codexArgs.push("not-shared");
    expect(adnx.codexArgs).not.toContain("not-shared");
    expect(env).toEqual({ HOLLOW_API_KEY: SECRET, ADNX_CUSTOM_KEY: `${SECRET}-adnx` });
  });

  test("derives missing/input keys and allows explicit shared keys", async () => {
    const { file } = await fixture([
      provider({ name: "ADNX", apiKey: undefined }),
      provider({ name: "Other Endpoint", apiKey: "${input:chat.lm.secret.id-123}" }),
      provider({ name: "One", apiKey: "${env:SHARED_KEY}" }),
      provider({ name: "Two", apiKey: "${env:SHARED_KEY}" }),
    ]);
    expect((await listModels(file, undefined, {})).models.map(item => item.envKey))
      .toEqual(["ADNX_API_KEY", "OTHER_ENDPOINT_API_KEY", "SHARED_KEY", "SHARED_KEY"]);
  });

  test("path precedence and normalization: explicit, environment, project default", async () => {
    const { directory, file } = await fixture();
    mkdirSync(join(directory, ".multiagents"));
    const defaultPath = join(directory, ".multiagents", "chatLanguageModels.json");
    await Bun.write(defaultPath, JSON.stringify([provider({ name: "Default" })]));
    await Bun.write(join(directory, "env.json"), JSON.stringify([provider({ name: "Environment" })]));
    const env = { MULTIAGENTS_MODELS_FILE: "env.json", HOLLOW_API_KEY: SECRET };
    expect((await listModels("./catalog.json", directory, env)).models[0]!.provider).toBe("Hollow");
    expect((await listModels(undefined, directory, env)).models[0]!.provider).toBe("Environment");
    expect((await listModels(undefined, directory, {})).catalog_path).toBe(defaultPath);
    const result = await resolveModelSelection({ provider: "Hollow", model: model().id, catalog_path: "./catalog.json" }, directory, env);
    expect(result.selection.catalog_path).toBe(file);
  });

  test("JSON/read/path failures never include raw input, filenames, or parse snippets", async () => {
    const { directory, file } = await fixture();
    await Bun.write(file, `{ "apiKey": "${SECRET}" `);
    expect(await errorMessage(listModels(file, directory, {}))).toBe("Cannot read model catalog as JSON.");
    expect(await errorMessage(listModels(join(directory, SECRET), directory, {}))).toBe("Cannot read model catalog as JSON.");
    expect(await errorMessage(listModels(directory, directory, {}))).toBe("Cannot read model catalog as JSON.");
    for (const path of ["", "\0", 23, null]) {
      await errorMessage(listModels(path as string, directory, {}));
    }
    await errorMessage(listModels(undefined, directory, { MULTIAGENTS_MODELS_FILE: "" }));
    await errorMessage(listModels(undefined, null as unknown as string, {}));
    await errorMessage(listModels(file, directory, null as unknown as Record<string, string>));
  });

  test.each([
    null, {}, "array-required", [null], [12],
    [provider({ name: "" })], [provider({ name: 1 })],
    [provider({ vendor: "openai" })], [provider({ apiType: "chatcompletions" })],
    [provider({ apiType: undefined })], [provider({ models: {} })],
    [provider({ models: [null] })], [provider({ models: [model({ id: "" })] })],
    [provider({ models: [model({ name: null })] })],
    [provider({ apiKey: SECRET })], [provider({ apiKey: null })],
    [provider({ apiKey: "${env:BAD-NAME}" })], [provider({ apiKey: "${input:unknown}" })],
    [provider({ apiKey: "${command:secret}" })],
    [provider({ apiKey: "${env:KEY}suffix" })],
    [provider(), provider()],
    [provider({ models: [model(), model()] })],
    [provider({ name: "A-B" }), provider({ name: "A B" })],
    [provider({ name: "A", apiKey: "${env:B_API_KEY}" }), provider({ name: "B" })],
    [provider({ name: "B" }), provider({ name: "A", apiKey: "${env:B_API_KEY}" })],
    [provider({ name: "123" })], [provider({ name: "!!!" })],
  ].map(raw => [raw]))("rejects malformed or ambiguous catalog %#", async raw => {
    const { file } = await fixture(raw);
    await errorMessage(listModels(file, undefined, {}));
  });

  test.each([
    "not a URL", "ftp://example.test/v1", "file:///tmp/model", "http://example.test/v1",
    "https://user:synthetic-credential-never-output@example.test/v1",
    "https://synthetic-credential-never-output@example.test/v1", "https://@example.test/v1",
    "https://example.test/v1?key=synthetic-credential-never-output", "https://example.test/v1#secret",
    "https://example.test/v1?", "https://example.test/v1#", "https:example.test",
    "https://example.test\\evil", "http://localhost.example.test/v1", "http://0.0.0.0/v1",
  ])("rejects unsafe endpoint %#", async url => {
    const { file } = await fixture([provider({ models: [model({ url })] })]);
    await errorMessage(listModels(file, undefined, {}));
  });

  test.each(["http://localhost:1234/v1/", "http://127.0.0.1:1234/v1", "http://[::1]:1234/v1", "https://example.test/v1"])("accepts safe endpoint %#", async url => {
    const { file } = await fixture([provider({ models: [model({ url })] })]);
    const result = await resolveModelSelection({ provider: "Hollow", model: model().id, catalog_path: file }, undefined, { HOLLOW_API_KEY: SECRET });
    expect(result.baseUrl).toBe(url.replace(/\/$/, ""));
  });

  test("validates all optional metadata without asserting claims", async () => {
    for (const field of ["toolCalling", "vision", "zeroDataRetentionEnabled"]) {
      for (const value of [null, 1, "true", {}]) {
        const { file } = await fixture([provider({ models: [model({ [field]: value })] })]);
        await errorMessage(listModels(file, undefined, {}));
      }
    }
    for (const field of ["maxInputTokens", "maxOutputTokens"]) {
      for (const value of [null, 0, -1, 1.5, "100", Number.MAX_SAFE_INTEGER + 1]) {
        const { file } = await fixture([provider({ models: [model({ [field]: value })] })]);
        await errorMessage(listModels(file, undefined, {}));
      }
    }
    const { file } = await fixture([provider({ models: [model({ toolCalling: undefined, vision: false, zeroDataRetentionEnabled: false, maxInputTokens: undefined, maxOutputTokens: Number.MAX_SAFE_INTEGER })] })]);
    const listed = (await listModels(file, undefined, {})).models[0]!;
    expect(listed).not.toHaveProperty("toolCalling");
    expect(listed).not.toHaveProperty("maxInputTokens");
    expect(listed.vision).toBe(false);
    expect(listed.maxOutputTokens).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("rejects missing credentials, unknown selection, and models without tool calling", async () => {
    const { file } = await fixture();
    const selection = { provider: "Hollow", model: model().id, catalog_path: file };
    for (const credential of [undefined, "", "  "]) {
      expect(await errorMessage(resolveModelSelection(selection, undefined, { HOLLOW_API_KEY: credential })))
        .toBe("Selected provider environment credential is missing.");
    }
    for (const input of [null, {}, { ...selection, provider: SECRET }, { ...selection, model: SECRET }, { ...selection, model: 12 }, { ...selection, catalog_path: null }]) {
      await errorMessage(resolveModelSelection(input as ModelSelection, undefined, {}));
    }
    for (const toolCalling of [false, undefined]) {
      await Bun.write(file, JSON.stringify([provider({ models: [model({ toolCalling })] })]));
      expect((await listModels(file, undefined, {})).models).toHaveLength(1);
      expect(await errorMessage(resolveModelSelection(selection, undefined, { HOLLOW_API_KEY: SECRET })))
        .toBe("Selected model must declare toolCalling as true.");
    }
  });

  test("TOML escaping preserves opaque routing IDs without injecting provider settings", async () => {
    const id = 'route/"quoted"/model\\name = true';
    const name = 'Provider "quoted"';
    const { file } = await fixture([provider({ name, apiKey: "${env:CUSTOM_KEY}", models: [model({ id })] })]);
    const result = await resolveModelSelection({ provider: name, model: id, catalog_path: file }, undefined, { CUSTOM_KEY: SECRET });
    expect(Bun.TOML.parse(result.codexArgs[3]!) as Record<string, unknown>).toEqual({ model: id });
    expect(Bun.TOML.parse(result.codexArgs[5]!)).toEqual({ model_providers: { multiagents_custom: {
      name, base_url: "https://models.example.test/v1", env_key: "CUSTOM_KEY", wire_api: "responses", requires_openai_auth: false,
    } } });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});