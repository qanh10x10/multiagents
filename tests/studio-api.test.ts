import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioApi } from "../dashboard/api.ts";
import { ProviderCredentialStore } from "../shared/provider-credentials.ts";

let directory: string;
let api: ReturnType<typeof createStudioApi>;
let calls: Array<{ config: any; env: Record<string, string | undefined> }>;
const origin = "http://127.0.0.1:17900";
const library = { version: 1, agents: [{
  id: "engineer", displayName: "Named Engineer", role: "Software Engineer", description: "Implement the assigned task",
  runtime: "codex", modelRef: { providerId: "local-provider", modelId: "vendor/model" },
}], teams: [{ id: "team-1", name: "Team One", managerId: "lead", members: [{ id: "lead", agentId: "engineer" }] }] };
const provider = { id: "local-provider", name: "Local provider", protocol: "responses", baseUrl: "https://example.invalid/v1",
  envKeyRef: "SYNTHETIC_STUDIO_KEY", models: [{ id: "vendor/model", name: "Declared model", capabilities: { toolCalling: true } }] };

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "studio-api-"));
  calls = [];
  ProviderCredentialStore.reset();
  api = createStudioApi({ libraryPath: join(directory, "team-library.json"), providersPath: join(directory, "providers.json"), environment: {},
    createTeam: async (config, env) => { calls.push({ config, env }); return { session_id: "new-synthetic-session" }; },
  });
});
afterEach(async () => { ProviderCredentialStore.reset(); await rm(directory, { recursive: true, force: true }); });
async function getState() {
  const res = await api.handle(new Request(`${origin}/api/studio`));
  expect(res!.status).toBe(200);
  return (await res!.json()).data;
}
async function request(path: string, body: unknown, method = "POST") {
  const state = await getState();
  return (await api.handle(new Request(origin + path, { method, headers: {
    origin, "content-type": "application/json", "x-studio-csrf": state.csrfToken,
  }, body: JSON.stringify(body) })))!;
}
async function configure() {
  let state = await getState();
  expect((await request("/api/studio/library", { baseRevision: state.revision, library }, "PUT")).status).toBe(200);
  state = await getState();
  expect((await request("/api/studio/providers", { baseRevision: state.revision, providers: [provider] }, "PUT")).status).toBe(200);
}

test("empty Studio is honest and loading does not create configuration or launch workers", async () => {
  const state = await getState();
  expect(state.library.agents).toEqual([]);
  expect(state.providers).toEqual([]);
  expect(state.credentialStorage).toBe("memory");
  expect(state.requiresReentryAfterRestart).toBe(true);
  expect(await Bun.file(join(directory, "team-library.json")).exists()).toBe(false);
  expect(calls).toHaveLength(0);
});

test("rejects hostile origin/host, missing CSRF and malformed input before writes", async () => {
  const state = await getState();
  for (const url of ["http://evil.invalid/api/studio", `${origin}/api/studio`]) {
    const result = await api.handle(new Request(url, { headers: { origin: "https://evil.invalid" } }));
    expect(result!.status).toBe(403);
  }
  const result = await api.handle(new Request(`${origin}/api/studio/library`, { method: "PUT", headers: {
    origin, "content-type": "application/json",
  }, body: JSON.stringify({ baseRevision: state.revision, library }) }));
  expect(result!.status).toBe(403);
  expect((await request("/api/studio/library", { baseRevision: state.revision, library, session_id: "OLD_SESSION" }, "PUT")).status).toBe(400);
  expect((await request("/api/studio/library", { schemaVersion: 2, baseRevision: state.revision, library }, "PUT")).status).toBe(400);
  expect(await Bun.file(join(directory, "team-library.json")).exists()).toBe(false);
});

test("persists named configuration, rejects stale writes and excludes credentials from export", async () => {
  await configure();
  const before = await getState();
  const key = "SYNTHETIC_KEY_NOT_A_REAL_CREDENTIAL";
  const credentialResult = await request("/api/studio/providers/local-provider/credential", { apiKey: key }, "PUT");
  expect(credentialResult.status).toBe(200);
  expect(await credentialResult.text()).not.toContain(key);
  expect((await request("/api/studio/library", { baseRevision: before.revision, library }, "PUT")).status).toBe(409);
  const exported = await api.handle(new Request(`${origin}/api/studio/export`));
  const serialized = await exported!.text();
  expect(serialized).toContain("Named Engineer");
  expect(serialized).toContain("vendor/model");
  expect(serialized).not.toContain(key);
  expect(serialized).not.toContain(directory.replaceAll("\\", "\\\\"));
  expect(await readFile(join(directory, "providers.json"), "utf8")).not.toContain(key);
  const state = await getState();
  expect(state.readiness[0].credentialPresent).toBe(true);
  expect(state.readiness[0].connectionVerified).toBe(false);
});

test("rejects memory-bearing imports without altering configuration or synthetic DB/WAL/SHM files", async () => {
  await configure();
  const paths = ["peers.db", "peers.db-wal", "peers.db-shm", "history.jsonl"];
  for (const path of paths) await writeFile(join(directory, path), `SYNTHETIC_PRESERVE_${path}`);
  const beforeLibrary = await readFile(join(directory, "team-library.json"));
  const beforeProviders = await readFile(join(directory, "providers.json"));
  for (const key of ["messages", "knowledge", "plans", "session_id", "context_snapshot", "codex_thread_id", "CODEX_HOME", "credentials"]) {
    const bundle = { schemaVersion: 1, library: { version: 1, agents: [], teams: [] }, providers: {
      version: "1.0", exportedAt: new Date().toISOString(), providers: [],
    }, [key]: "SYNTHETIC_MEMORY_FORBIDDEN" };
    const result = await request("/api/studio/import", { bundle, apply: true, confirmed: true, baseRevision: (await getState()).revision });
    expect(result.status).toBe(400);
    expect(await result.text()).not.toContain("SYNTHETIC_MEMORY_FORBIDDEN");
  }
  expect(await readFile(join(directory, "team-library.json"))).toEqual(beforeLibrary);
  expect(await readFile(join(directory, "providers.json"))).toEqual(beforeProviders);
  for (const path of paths) expect(await readFile(join(directory, path), "utf8")).toBe(`SYNTHETIC_PRESERVE_${path}`);
});

test("configuration import previews then applies once without replacing destination providers", async () => {
  const bundle = { schemaVersion: 1, library, providers: { version: "1.0", exportedAt: new Date().toISOString(), providers: [provider] } };
  const before = await getState();
  const preview = await request("/api/studio/import", { bundle, apply: false });
  expect(preview.status).toBe(200);
  expect((await preview.json()).data.applied).toBe(false);
  expect((await getState()).revision).toBe(before.revision);
  expect(await Bun.file(join(directory, "team-library.json")).exists()).toBe(false);
  const applied = await request("/api/studio/import", { bundle, apply: true, confirmed: true, baseRevision: before.revision });
  expect(applied.status).toBe(200);
  expect((await getState()).library.agents[0].displayName).toBe("Named Engineer");
  const stored = await readFile(join(directory, "providers.json"));
  const rejected = await request("/api/studio/import", { bundle, apply: true, confirmed: true, baseRevision: (await getState()).revision });
  expect(rejected.status).toBe(400);
  expect(await readFile(join(directory, "providers.json"))).toEqual(stored);
});

test("catalog discovery records metadata separately from credentials and connection verification", async () => {
  const catalogPath = join(directory, "chatLanguageModels.json");
  await Bun.write(catalogPath, JSON.stringify([{ name: "Discovered", vendor: "customendpoint", apiType: "responses",
    apiKey: "${env:SYNTHETIC_DISCOVERY_KEY}", models: [{ id: "vendor/model", name: "Model", url: "https://example.invalid/responses", toolCalling: true }],
  }]));
  expect((await request("/api/studio/catalog/import", { catalogPath })).status).toBe(200);
  const state = await getState();
  expect(state.readiness[0]).toMatchObject({ discovered: true, configured: true, credentialPresent: false, connectionVerified: false });
  expect(calls).toHaveLength(0);
});

test("credential changes invalidate preview tokens and failed runs are not automatically retried", async () => {
  await configure();
  await request("/api/studio/providers/local-provider/credential", { apiKey: "SYNTHETIC_FIRST_KEY" }, "PUT");
  const preview = await request("/api/studio/run/preview", { libraryRevision: (await getState()).revision, templateId: "team-1", target: directory, task: "Synthetic" });
  const token = (await preview.json()).data.previewToken;
  await request("/api/studio/providers/local-provider/credential", { apiKey: "SYNTHETIC_REPLACEMENT_KEY" }, "PUT");
  expect((await request("/api/studio/run", { previewToken: token, requestId: "stale", approvedTarget: true, approvedTask: true, approvedRoster: true, approvedCost: true })).status).toBe(409);
  expect(calls).toHaveLength(0);
  let attempts = 0;
  api = createStudioApi({ libraryPath: join(directory, "team-library.json"), providersPath: join(directory, "providers.json"), environment: {},
    createTeam: async () => { attempts++; return { isError: true, content: [{ type: "text", text: "SYNTHETIC_PRIVATE_ERROR" }] }; },
  });
  const next = await request("/api/studio/run/preview", { libraryRevision: (await getState()).revision, templateId: "team-1", target: directory, task: "Synthetic" });
  const run = { previewToken: (await next.json()).data.previewToken, requestId: "failed-once", approvedTarget: true, approvedTask: true, approvedRoster: true, approvedCost: true };
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await request("/api/studio/run", run);
    expect(result.status).toBe(502);
    expect(await result.text()).not.toContain("SYNTHETIC_PRIVATE_ERROR");
  }
  expect(attempts).toBe(1);
});

test("preview never launches, missing setup blocks, confirmed run is deduplicated and new", async () => {
  await configure();
  let state = await getState();
  let preview = await request("/api/studio/run/preview", { libraryRevision: state.revision, templateId: "team-1", target: directory, task: "Synthetic task" });
  expect(preview.status).toBe(200);
  expect((await preview.json()).data.valid).toBe(false);
  expect(calls).toHaveLength(0);
  await request("/api/studio/providers/local-provider/credential", { apiKey: "SYNTHETIC_TEST_KEY" }, "PUT");
  state = await getState();
  preview = await request("/api/studio/run/preview", { libraryRevision: state.revision, templateId: "team-1", target: directory, task: "Synthetic task" });
  const data = (await preview.json()).data;
  expect(data.valid).toBe(true);
  expect(calls).toHaveLength(0);
  const run = { previewToken: data.previewToken, requestId: "synthetic-once", approvedTarget: true, approvedTask: true, approvedRoster: true, approvedCost: true };
  expect((await request("/api/studio/run", { ...run, approvedCost: false })).status).toBe(400);
  expect((await request("/api/studio/run", run)).status).toBe(200);
  expect((await request("/api/studio/run", run)).status).toBe(200);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.config.agents[0].name).toBe("Named Engineer");
  expect(calls[0]!.env.SYNTHETIC_STUDIO_KEY).toBe("SYNTHETIC_TEST_KEY");
  expect(JSON.stringify(calls[0]!.config)).not.toContain("SYNTHETIC_TEST_KEY");
  expect(calls[0]!.config.session_id).toBeUndefined();
  expect(await readFile(calls[0]!.config.agents[0].model_selection.catalog_path, "utf8")).not.toContain("SYNTHETIC_TEST_KEY");
});

for (const fails of [false, true]) {
  test(`pending ${fails ? "failed" : "successful"} launch allows Studio operations and deduplicates retries`, async () => {
    await configure();
    await request("/api/studio/providers/local-provider/credential", { apiKey: "SYNTHETIC_ORIGINAL_KEY" }, "PUT");
    const launchGate = Promise.withResolvers<void>();
    const launchStarted = Promise.withResolvers<void>();
    api = createStudioApi({
      libraryPath: join(directory, "team-library.json"), providersPath: join(directory, "providers.json"), environment: {},
      createTeam: async (config, env) => {
        calls.push({ config, env });
        launchStarted.resolve();
        await launchGate.promise;
        if (fails) throw new Error("SYNTHETIC_PRIVATE_LAUNCH_ERROR");
        return { session_id: "synthetic-deferred-session" };
      },
    });
    const preview = await request("/api/studio/run/preview", {
      libraryRevision: (await getState()).revision, templateId: "team-1", target: directory, task: "Synthetic task",
    });
    const run = {
      previewToken: (await preview.json()).data.previewToken, requestId: "deferred-once",
      approvedTarget: true, approvedTask: true, approvedRoster: true, approvedCost: true,
    };
    const first = request("/api/studio/run", run);
    let duplicate: Promise<Response> | undefined;
    let unrelated: Promise<void> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await launchStarted.promise;
      duplicate = request("/api/studio/run", run);
      unrelated = (async () => {
        const state = await getState();
        expect((await api.handle(new Request(`${origin}/api/studio/export`)))!.status).toBe(200);
        const nextPreview = await request("/api/studio/run/preview", {
          libraryRevision: state.revision, templateId: "team-1", target: directory, task: "Another synthetic task",
        });
        expect(nextPreview.status).toBe(200);
        expect((await nextPreview.json()).data.valid).toBe(true);
        expect((await request("/api/studio/providers/local-provider/credential", { apiKey: "SYNTHETIC_REPLACEMENT_KEY" }, "PUT")).status).toBe(200);
        expect((await request("/api/studio/library", { baseRevision: (await getState()).revision, library }, "PUT")).status).toBe(200);
        expect((await request("/api/studio/run", { ...run, requestId: "different-request" })).status).toBe(409);
      })();
      await Promise.race([
        unrelated,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Studio operations blocked behind launch")), 1000); }),
      ]);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.env.SYNTHETIC_STUDIO_KEY).toBe("SYNTHETIC_ORIGINAL_KEY");
    } finally {
      clearTimeout(timer);
      launchGate.resolve();
      await Promise.allSettled([first, ...(duplicate ? [duplicate] : []), ...(unrelated ? [unrelated] : [])]);
    }
    const firstResponse = await first;
    const duplicateResponse = await duplicate!;
    expect(firstResponse.status).toBe(fails ? 400 : 200);
    expect(duplicateResponse.status).toBe(firstResponse.status);
    const body = await firstResponse.text();
    expect(await duplicateResponse.text()).toBe(body);
    expect(body).not.toContain("SYNTHETIC_PRIVATE_LAUNCH_ERROR");
    expect(calls).toHaveLength(1);
  });
}
