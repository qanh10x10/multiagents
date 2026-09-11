import { afterEach, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverSetupCatalog, mergeCopilotConfig, parseSetupOptions, setupCopilot, type SetupContext } from "../cli/setup-copilot.ts";

const checkout = fileURLToPath(new URL("..", import.meta.url));
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function put(file: string, content: string): void { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); }
function fixture(): SetupContext {
  const directory = mkdtempSync(join(tmpdir(), "multiagents setup spaces "));
  directories.push(directory);
  const projectDir = join(directory, "checkout spaces");
  const home = join(directory, "home");
  const appdata = join(home, "AppData", "Roaming");
  put(join(projectDir, "orchestrator", "orchestrator-server.ts"), "// Fixture only\n");
  put(join(projectDir, "node_modules", "@modelcontextprotocol", "sdk", "package.json"), "{}");
  put(join(appdata, "npm", "node_modules", "@openai", "codex", "bin", "codex.js"), "throw new Error('must not execute');");
  mkdirSync(home, { recursive: true });
  return { projectDir, home, executable: process.execPath, env: { PATH: "", APPDATA: appdata } };
}
function catalog(key = "${env:FIXTURE_KEY}"): string {
  return JSON.stringify([{ vendor: "customendpoint", name: "Fixture", apiType: "responses", apiKey: key, models: [
    { id: "one", name: "One", url: "https://example.invalid/v1", toolCalling: true },
    { id: "two", name: "Two", url: "https://example.invalid/v1", toolCalling: true },
  ] }]);
}
function config(context: SetupContext): string { return join(context.projectDir, ".vscode", "mcp.json"); }
const options = parseSetupOptions([]);

test("options are explicit and argument errors do not echo secrets", () => {
  expect(options).toEqual({ check: false, credentials: "prompt", help: false });
  expect(parseSetupOptions(["--credentials", "env", "--check", "--no-pause"])).toEqual({ check: true, credentials: "env", help: false });
  expect(() => parseSetupOptions(["raw-secret-123"])).toThrow("Unknown setup option");
  expect(() => parseSetupOptions(["--credentials", "raw-secret-123"])).toThrow("Use --credentials prompt or --credentials env.");
});

test("merge preserves unrelated config, inputs, server/env extras and is byte-idempotent", async () => {
  const context = fixture();
  context.env.FIXTURE_KEY = "never-copy-this-secret";
  put(join(context.projectDir, ".multiagents", "chatLanguageModels.json"), catalog());
  const original = { servers: { other: { type: "stdio", command: "unchanged" } }, inputs: [{ id: "user", type: "promptString", description: "User" }], custom: { keep: true } };
  put(config(context), JSON.stringify(original));
  await setupCopilot(options, context);
  const installed = JSON.parse(readFileSync(config(context), "utf8"));
  expect(installed.servers.other).toEqual(original.servers.other);
  expect(installed.custom).toEqual(original.custom);
  expect(installed.inputs[0]).toEqual(original.inputs[0]);
  expect(installed.inputs).toHaveLength(2);
  expect(installed.inputs[1]).toMatchObject({ type: "promptString", password: true });
  expect(installed.inputs[1]).not.toHaveProperty("default");
  expect(installed.inputs[1].description).toContain("Unused provider can leave blank");
  expect(installed.servers["multiagents-orch"]).toMatchObject({ command: process.execPath, args: [join(context.projectDir, "orchestrator", "orchestrator-server.ts")], cwd: context.projectDir, env: { MULTIAGENTS_DB: join(context.home, ".multiagents", "peers.db").replaceAll("\\", "/"), FIXTURE_KEY: "${input:multiagents-orch-key-FIXTURE_KEY}" } });
  expect(installed.servers["multiagents-orch"].env.MULTIAGENTS_MODELS_FILE).toBe(join(context.projectDir, ".multiagents", "chatLanguageModels.json"));
  expect(JSON.stringify(installed)).not.toContain("never-copy-this-secret");
  installed.servers["multiagents-orch"].env.EXTRA = "keep";
  installed.servers["multiagents-orch"].custom = true;
  put(config(context), JSON.stringify(installed, null, 4));
  const before = readFileSync(config(context), "utf8");
  await setupCopilot(options, context);
  expect(readFileSync(config(context), "utf8")).toBe(before);
  expect(existsSync(join(context.home, ".multiagents"))).toBe(false);
});

test("catalog precedence, deduplication, and safe refusal of secret literals", async () => {
  const context = fixture();
  const project = join(context.projectDir, ".multiagents", "chatLanguageModels.json");
  const explicit = join(context.projectDir, "explicit.json");
  const windows = join(context.env.APPDATA!, "Code", "User", "chatLanguageModels.json");
  context.env.MULTIAGENTS_MODELS_FILE = "explicit.json";
  put(windows, catalog("${env:WINDOWS_KEY}"));
  put(explicit, catalog("${env:EXPLICIT_KEY}"));
  put(project, catalog());
  expect(await discoverSetupCatalog(context)).toEqual({ path: project, keys: ["FIXTURE_KEY"] });
  rmSync(project);
  expect(await discoverSetupCatalog(context)).toEqual({ path: explicit, keys: ["EXPLICIT_KEY"] });
  rmSync(explicit);
  if (process.platform === "win32") expect(await discoverSetupCatalog(context)).toEqual({ path: windows, keys: ["WINDOWS_KEY"] });
  put(project, catalog("literal-secret-must-not-leak"));
  await expect(setupCopilot(options, context)).rejects.toThrow("Model catalog rejected");
  expect(existsSync(config(context))).toBe(false);
  try { await discoverSetupCatalog(context); } catch (error) { expect(String(error)).not.toContain("literal-secret-must-not-leak"); }
  put(project, catalog("${env:PATH}"));
  await expect(discoverSetupCatalog(context)).rejects.toThrow("dedicated provider environment names");
});

test("check and help never mutate; missing catalog permits tool discovery config", async () => {
  const context = fixture();
  const messages = await setupCopilot({ ...options, check: true }, context);
  expect(messages.join("\n")).toContain("No model catalog found");
  expect(existsSync(join(context.projectDir, ".vscode"))).toBe(false);
  await setupCopilot({ ...options, help: true }, { ...context, executable: "missing" });
  await setupCopilot(options, context);
  expect(JSON.parse(readFileSync(config(context), "utf8"))).not.toHaveProperty("inputs");
});

test("conflicting server, DB, catalog, user credentials, and input collisions refuse untouched", async () => {
  const context = fixture();
  const modelCatalog = { path: join(context.projectDir, "catalog.json"), keys: ["FIXTURE_KEY"] };
  const clean = mergeCopilotConfig({}, context, modelCatalog, "prompt") as any;
  const cases = [
    { servers: { "multiagents-orch": { command: "other" } } },
    { ...clean, servers: { "multiagents-orch": { ...clean.servers["multiagents-orch"], env: { MULTIAGENTS_DB: "elsewhere" } } } },
    { ...clean, servers: { "multiagents-orch": { ...clean.servers["multiagents-orch"], env: { MULTIAGENTS_MODELS_FILE: "elsewhere" } } } },
    { inputs: [{ id: "multiagents-orch-key-FIXTURE_KEY", type: "promptString", password: true }] },
    { ...clean, servers: { "multiagents-orch": { ...clean.servers["multiagents-orch"], env: { FIXTURE_KEY: "user-secret-value" } } } },
  ];
  for (const candidate of cases) {
    const before = JSON.stringify(candidate);
    expect(() => mergeCopilotConfig(candidate, context, modelCatalog, "prompt")).toThrow();
    expect(JSON.stringify(candidate)).toBe(before);
  }
  put(config(context), JSON.stringify(cases[0]));
  const before = readFileSync(config(context), "utf8");
  await expect(setupCopilot(options, context)).rejects.toThrow("conflicts");
  expect(readFileSync(config(context), "utf8")).toBe(before);
});

test.skipIf(process.platform !== "win32")("Windows environment aliases refuse both modes without writing or leaking values", async () => {
  const context = fixture();
  const path = join(context.projectDir, ".multiagents", "chatLanguageModels.json");
  put(path, catalog());
  for (const credentials of ["prompt", "env"] as const) {
    for (const key of ["FIXTURE_KEY", "MULTIAGENTS_DB", "MULTIAGENTS_MODELS_FILE"]) {
      for (const keepCanonical of [false, true]) {
        const candidate = mergeCopilotConfig({}, context, { path, keys: ["FIXTURE_KEY"] }, "prompt") as any;
        const env = candidate.servers["multiagents-orch"].env;
        if (!keepCanonical) delete env[key];
        env[key.toLowerCase()] = "alias-value-must-not-leak";
        const before = JSON.stringify(candidate, null, 4);
        put(config(context), before);
        expect(() => mergeCopilotConfig(candidate, context, { path, keys: ["FIXTURE_KEY"] }, credentials)).toThrow("conflicting variable casing");
        expect(JSON.stringify(candidate, null, 4)).toBe(before);
        await expect(setupCopilot({ ...options, credentials }, context)).rejects.toThrow("conflicting variable casing");
        try { await setupCopilot({ ...options, credentials }, context); }
        catch (error) { expect(String(error)).not.toContain("alias-value-must-not-leak"); }
        expect(readFileSync(config(context), "utf8")).toBe(before);
      }
    }
  }
});

test.skipIf(process.platform !== "win32")("Windows alias checks do not silently reassign owned or unrelated keys", () => {
  const context = fixture();
  const path = join(context.projectDir, "catalog.json");
  const initial = mergeCopilotConfig({}, context, { path, keys: ["fixture_key"] }, "prompt") as any;
  for (const credentials of ["prompt", "env"] as const) {
    const before = JSON.stringify(initial);
    expect(() => mergeCopilotConfig(initial, context, { path, keys: ["FIXTURE_KEY"] }, credentials)).toThrow("conflicting variable casing");
    expect(JSON.stringify(initial)).toBe(before);
  }
});

test.skipIf(process.platform !== "win32")("Windows same-case reruns in both modes preserve bytes and unrelated ownership", async () => {
  const context = fixture();
  const path = join(context.projectDir, ".multiagents", "chatLanguageModels.json");
  put(path, catalog());
  for (const credentials of ["prompt", "env"] as const) {
    const initial = mergeCopilotConfig({}, context, { path, keys: ["FIXTURE_KEY"] }, credentials) as any;
    initial.servers["multiagents-orch"].env.unrelated_key = "${input:user-owned}";
    initial.inputs ??= [];
    initial.inputs.push({ id: "user-owned", type: "promptString", password: true });
    const before = JSON.stringify(initial, null, 4);
    put(config(context), before);
    for (let rerun = 0; rerun < 2; rerun++) {
      expect((await setupCopilot({ ...options, credentials }, context)).join("\n")).toContain("already current");
      expect(readFileSync(config(context), "utf8")).toBe(before);
    }
  }
});

test("JSONC, malformed JSON, and invalid shapes are refused without leaking content or writing", async () => {
  const context = fixture();
  for (const source of ['{ // secret-marker\n"servers": {}}', '{"servers":{},}', '{"secret-marker"', '[]', '{"inputs":{}}']) {
    put(config(context), source);
    await expect(setupCopilot(options, context)).rejects.toThrow();
    try { await setupCopilot(options, context); } catch (error) { expect(String(error)).not.toContain("secret-marker"); }
    expect(readFileSync(config(context), "utf8")).toBe(source);
  }
});

test("env mode removes only exact owned credentials, keeps shared/unrelated inputs and refuses edited ownership", () => {
  const context = fixture();
  const catalog = { path: join(context.projectDir, "catalog.json"), keys: ["FIXTURE_KEY", "SHARED_KEY"] };
  const initial = mergeCopilotConfig({ inputs: [{ id: "unrelated", type: "promptString" }] }, context, catalog, "prompt") as any;
  initial.servers.other = { env: { KEY: "${input:multiagents-orch-key-SHARED_KEY}" } };
  initial.servers["multiagents-orch"].env.EXTRA = "keep";
  const inherited = mergeCopilotConfig(initial, context, catalog, "env") as any;
  expect(inherited.servers["multiagents-orch"].env).not.toHaveProperty("FIXTURE_KEY");
  expect(inherited.servers["multiagents-orch"].env).not.toHaveProperty("SHARED_KEY");
  expect(inherited.servers["multiagents-orch"].env.EXTRA).toBe("keep");
  expect(inherited.inputs.map((input: any) => input.id)).toEqual(["unrelated", "multiagents-orch-key-SHARED_KEY"]);
  expect(mergeCopilotConfig(inherited, context, catalog, "env")).toEqual(inherited);
  initial.inputs[1].description = "User changed";
  expect(() => mergeCopilotConfig(initial, context, catalog, "env")).toThrow("configured by the user");
  const standalone = mergeCopilotConfig({}, context, { keys: ["FIXTURE_KEY"] }, "prompt");
  const envOnly = mergeCopilotConfig(standalone, context, { keys: [] }, "env") as any;
  expect(envOnly.inputs).toEqual([]);
  expect(JSON.stringify(envOnly)).not.toContain("${input:");
});

test("missing prerequisites fail without installation or workspace writes", async () => {
  const context = fixture();
  await expect(setupCopilot(options, { ...context, executable: join(context.home, "absent") })).rejects.toThrow("Bun executable missing");
  rmSync(join(context.projectDir, "node_modules"), { recursive: true });
  await expect(setupCopilot(options, context)).rejects.toThrow("Dependencies missing");
  expect(existsSync(config(context))).toBe(false);
});

test.skipIf(process.platform !== "win32")("BAT supports spaces, check/no-pause, failure exit codes and missing Bun", () => {
  const context = fixture();
  copyFileSync(join(checkout, "setup-copilot.bat"), join(context.projectDir, "setup-copilot.bat"));
  for (const path of ["cli/setup-copilot.ts", "shared/model-providers.ts", "shared/codex-executable.ts", "orchestrator/selected-codex-runtime.ts"]) {
    put(join(context.projectDir, path), readFileSync(join(checkout, path), "utf8"));
  }
  const bun = join(context.home, ".bun", "bin", "bun.exe");
  mkdirSync(dirname(bun), { recursive: true });
  copyFileSync(process.execPath, bun);
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const env = { SystemRoot: systemRoot, PATH: "", USERPROFILE: context.home, HOME: context.home, APPDATA: context.env.APPDATA!, TEMP: tmpdir(), TMP: tmpdir(), PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  const run = (args: string) => Bun.spawnSync([join(systemRoot, "System32", "cmd.exe"), "/d", "/s", "/c", `""${join(context.projectDir, "setup-copilot.bat")}" ${args}"`], { cwd: context.home, env, windowsVerbatimArguments: true, timeout: 15000, stdout: "pipe", stderr: "pipe" });
  const checked = run("--check --no-pause");
  expect(checked.stdout.toString() + checked.stderr.toString()).toContain("Check only");
  expect(checked.exitCode).toBe(0);
  expect(checked.stdout.toString()).toContain("Check only");
  expect(existsSync(config(context))).toBe(false);
  const bad = run("--bad --no-pause");
  expect(bad.exitCode).toBe(1);
  rmSync(bun);
  const missing = run("--check --no-pause");
  expect(missing.exitCode).toBe(1);
  expect(missing.stdout.toString()).toContain("Bun not found");
  expect(existsSync(config(context))).toBe(false);
}, 45000);