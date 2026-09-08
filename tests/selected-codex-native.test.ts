import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CodexDriver } from "../orchestrator/codex-driver.ts";
import { selectedCodexRuntime } from "../orchestrator/selected-codex-runtime.ts";
import { resolveModelSelection } from "../shared/model-providers.ts";

// Explicit opt-in native executable; never discover a user's auth or start a turn.
const executable = process.env.MULTIAGENTS_TEST_CODEX_EXECUTABLE;
test.skipIf(!executable)("native selected config excludes synthetic global/project auth and transports", async () => {
  // Keep native process lifetime inside a bounded child; parent owns fixture cleanup.
  if (!process.env.MULTIAGENTS_NATIVE_FIXTURE) {
    const fixture = mkdtempSync(join(tmpdir(), "multiagents-native-config-"));
    try {
      const worker = Bun.spawnSync([process.execPath, "test", import.meta.path, "--timeout", "45000"], {
        env: { ...process.env, MULTIAGENTS_NATIVE_FIXTURE: fixture },
        timeout: 50000, stdout: "pipe", stderr: "pipe",
      });
      console.log(worker.stdout.toString() + worker.stderr.toString());
      expect(worker.exitCode).toBe(0);
    } finally {
      // Remove only this fixture after the child has released its native handles.
      const cleanup = Bun.spawnSync([process.execPath, "run", "-"], {
        stdin: new TextEncoder().encode(`import {rmSync} from "node:fs"; rmSync(${JSON.stringify(fixture)}, {recursive:true,force:true});`),
        timeout: 10000, stdout: "pipe", stderr: "pipe",
      });
      if (cleanup.exitCode !== 0) console.error(cleanup.stderr.toString());
      expect(cleanup.exitCode).toBe(0);
      expect(existsSync(fixture)).toBe(false);
    }
    return;
  }
  const root = process.env.MULTIAGENTS_NATIVE_FIXTURE;
  const user = join(root, "user");
  const repo = join(root, "project");
  const project = join(repo, "nested");
  let driver: CodexDriver | undefined;
  try {
    for (const folder of [user, project, join(repo, ".git"), join(user, ".codex"), join(repo, ".codex"), join(project, ".codex")]) mkdirSync(folder, { recursive: true });
    const stale = [
      'model="stale-model"', 'model_provider="multiagents_custom"',
      '[model_providers.multiagents_custom]', 'name="Stale"', 'base_url="https://stale.invalid/v1"',
      'env_key="STALE_PROVIDER_KEY"', 'wire_api="responses"', 'requires_openai_auth=true',
      'experimental_bearer_token="SYNTHETIC_STALE_TOKEN"',
      '[model_providers.multiagents_custom.http_headers]', 'Authorization="SYNTHETIC_STALE_HEADER"',
      '[model_providers.multiagents_custom.env_http_headers]', 'Authorization="STALE_HEADER_KEY"',
      '[mcp_servers.multiagents-peer]', 'url="http://127.0.0.1:1/stale"',
      'bearer_token_env_var="STALE_MCP_KEY"',
    ].join("\n") + "\n";
    const originals = [join(user, ".codex", "config.toml"), join(repo, ".codex", "config.toml"), join(project, ".codex", "config.toml")];
    for (const file of originals) await Bun.write(file, stale);
    const catalog = join(root, "catalog.json");
    await Bun.write(catalog, JSON.stringify([{
      name: "Selected", vendor: "customendpoint", apiType: "responses", apiKey: "${env:SELECTED_NATIVE_KEY}",
      models: [{ id: "selected-model", name: "Selected", url: "https://example.invalid/v1/responses", toolCalling: true }],
    }]));
    const env: Record<string, string | undefined> = {};
    for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"]) env[key] = process.env[key];
    Object.assign(env, {
      HOME: user, USERPROFILE: user, APPDATA: user, LOCALAPPDATA: user, TEMP: root, TMP: root,
      CODEX_HOME: join(user, ".codex"), CODEX_SQLITE_HOME: join(root, "must-not-use"),
      CODEX_API_KEY: "SYNTHETIC_STALE_CODEX", OPENAI_API_KEY: "SYNTHETIC_STALE_OPENAI",
      OPENAI_BASE_URL: "https://stale.invalid/v1", STALE_HEADER_KEY: "SYNTHETIC_STALE_ENV_HEADER",
      SELECTED_NATIVE_KEY: "SYNTHETIC_SELECTED_SECRET", NODE_OPTIONS: "--invalid-option",
      MULTIAGENTS_SESSION: "native-fixture", MULTIAGENTS_SLOT: "1",
    });
    const resolved = await resolveModelSelection({ provider: "Selected", model: "selected-model", catalog_path: catalog }, project, env);
    const selected = selectedCodexRuntime(resolved, env, project, ["offline-peer", "--slot", "1"]);
    const configFile = join(selected.env.CODEX_HOME!, "config.toml");
    expect(readFileSync(configFile, "utf8")).not.toContain("SYNTHETIC_");
    for (const key of ["CODEX_API_KEY", "OPENAI_API_KEY", "CODEX_SQLITE_HOME", "OPENAI_BASE_URL", "STALE_HEADER_KEY", "NODE_OPTIONS"]) expect(selected.env[key]).toBeUndefined();
    expect(selected.env.SELECTED_NATIVE_KEY).toBe("SYNTHETIC_SELECTED_SECRET");
    // Resolve only the explicitly supplied native executable, not installed shims.
    selected.env.PATH = dirname(executable!) + (process.platform === "win32" ? ";" : ":") + (selected.env.PATH ?? "");
    const version = Bun.spawnSync([executable!, "--version"], { env: selected.env, timeout: 10000 });
    expect(version.exitCode).toBe(0);
    console.log(`Native config proof: ${version.stdout.toString().trim()}; Bun ${Bun.version}`);
    driver = await CodexDriver.spawn(project, selected.env, 10000, selected.runtime);
    for (const cwd of [undefined, project, repo]) {
      const result = await (driver as any).sendRequest("config/read", { ...(cwd ? { cwd } : {}), includeLayers: true }, 10000);
      const config = result.config;
      expect(config.model).toBe("selected-model");
      expect(config.model_provider).toBe("multiagents_custom");
      const provider = config.model_providers.multiagents_custom;
      expect(provider.base_url).toBe("https://example.invalid/v1");
      expect(provider.env_key).toBe("SELECTED_NATIVE_KEY");
      expect(provider.requires_openai_auth).toBe(false);
      for (const key of ["experimental_bearer_token", "http_headers", "env_http_headers", "auth"]) expect(provider[key] ?? null).toBeNull();
      const peer = config.mcp_servers["multiagents-peer"];
      expect(peer.command).toBe(process.execPath);
      expect(peer.args).toEqual(["offline-peer", "--slot", "1"]);
      for (const key of ["url", "bearer_token_env_var", "http_headers", "env_http_headers"]) expect(peer[key]).toBeUndefined();
      expect(JSON.stringify(config)).not.toContain("SYNTHETIC_");
      expect(config.cli_auth_credentials_store).toBe("file");
      expect(config.mcp_oauth_credentials_store).toBe("file");
      expect(config.features.plugins).toBe(false);
      expect(config.features.recommended_plugins).toBe(false);
      expect(config.features.remote_plugin).toBe(false);
      expect(config.analytics.enabled).toBe(false);
      console.log(`Effective config verified: ${cwd ? "project layer" : "startup"}; selected route/envKey; stdio MCP; no stale auth/headers/url`);
    }
    driver.process.stdin.end();
    await driver.process.exited;
    driver = undefined;
    const resumed = selectedCodexRuntime(resolved, env, project, ["offline-peer", "--slot", "1"]);
    expect(resumed.env.CODEX_HOME).toBe(selected.env.CODEX_HOME);
    expect(statSync(configFile).isFile()).toBe(true);
    if (process.platform !== "win32") expect(statSync(configFile).mode & 0o777).toBe(0o600);
    for (const file of originals) expect(readFileSync(file, "utf8")).toBe(stale);
  } finally {
    if (driver) { await driver.kill(); await driver.process.exited; }
    // The parent removes only this fixture after this Bun process releases handles.
  }
}, 60000);