import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../cli.ts", import.meta.url));
const secret = "synthetic-credential-must-not-appear";
let directory: string;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "multiagents-models-cli-"));
  // Fail closed if discovery attempts network access or launches a broker.
  await Bun.write(join(directory, "offline.ts"), `
    const blocked = () => { throw new Error("Unexpected external operation"); };
    globalThis.fetch = blocked;
    Bun.connect = blocked;
    Bun.serve = blocked;
    Bun.spawn = blocked;
    Bun.spawnSync = blocked;
  `);
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function run(args: string[]) {
  const filesBefore = readdirSync(directory).filter(name => name !== ".bun").sort();
  const child = Bun.spawnSync([
    process.execPath, "--preload", join(directory, "offline.ts"), cliPath, ...args,
  ], {
    cwd: directory,
    env: {
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: directory, USERPROFILE: directory, APPDATA: directory, LOCALAPPDATA: directory,
      CODEX_HOME: directory, TEMP: directory, TMP: directory,
      MULTIAGENTS_PORT: "1", MULTIAGENTS_DB: join(directory, "must-not-create.db"),
      MULTIAGENTS_MODELS_FILE: join(directory, "ignored-env-catalog.json"),
      HOLLOW_API_KEY: secret, ADNX_API_KEY: secret,
    },
    stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 5000,
  });
  const stdout = child.stdout.toString();
  const stderr = child.stderr.toString();
  expect(stdout + stderr).not.toContain(secret);
  // Bun creates its own cache under the isolated HOME; application writes remain forbidden.
  expect(readdirSync(directory).filter(name => name !== ".bun").sort()).toEqual(filesBefore);
  return { exitCode: child.exitCode, stdout, stderr };
}

function provider(name = "Hollow") {
  return {
    vendor: "customendpoint", name, apiType: "responses",
    apiKey: "${input:chat.lm.secret.fixture}",
    headers: { Authorization: secret }, extra: secret,
    models: [{
      id: "ag/fixture", name: "Fixture", url: "https://example.invalid/v1/responses",
      toolCalling: true, vision: true, maxInputTokens: 8192, maxOutputTokens: 2048,
      zeroDataRetentionEnabled: true, extra: secret,
    }],
  };
}

async function catalog(value: unknown) {
  const path = join(directory, "fixture catalog.json");
  await Bun.write(path, JSON.stringify(value));
  return path;
}

test("models help is discoverable and requires no broker or catalog", () => {
  for (const args of [["help"], ["help", "models"], ["models", "--help"], ["models", "-h"]]) {
    const result = run(args);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("models --file <path> [--json]");
  }
}, 15000);

test("models JSON uses a cwd-relative explicit catalog and only safe metadata", async () => {
  await catalog([provider(), provider("ADNX"), { ...provider("NoCredential"), apiKey: "${env:UNSET_FIXTURE_KEY}" }]);
  const result = run(["models", "--json", "--file", "fixture catalog.json"]);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const output = JSON.parse(result.stdout);
  expect(output.catalog_path).toBe(join(directory, "fixture catalog.json"));
  expect(output.models).toHaveLength(3);
  expect(output.models[0]).toEqual({
    provider: "Hollow", model: "ag/fixture", name: "Fixture",
    url: "https://example.invalid/v1/responses", envKey: "HOLLOW_API_KEY",
    toolCalling: true, vision: true, maxInputTokens: 8192, maxOutputTokens: 2048,
    zeroDataRetentionEnabled: true,
  });
  expect(output.models[1].envKey).toBe("ADNX_API_KEY");
  expect(output.models[2].envKey).toBe("UNSET_FIXTURE_KEY");
  expect(result.stdout).not.toContain("apiKey");
  expect(result.stdout).not.toContain("headers");
}, 15000);

test("models text shows declarations without claiming validated tool support", async () => {
  const fixture = provider();
  fixture.models[0]!.toolCalling = false;
  const path = await catalog([fixture]);
  const result = run(["models", "--file", path]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Hollow / ag/fixture (Fixture)");
  expect(result.stdout).toContain("HOLLOW_API_KEY");
  expect(result.stdout).toContain("unverified");
  expect(result.stdout).toContain("Tool calling: disabled");
  expect(result.stdout).not.toContain("example.invalid");
}, 15000);

test("models accepts an empty catalog", async () => {
  const path = await catalog([]);
  expect(run(["models", "--file", path]).stdout).toContain("No models found");
  const result = run(["models", "--file", path, "--json"]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).models).toEqual([]);
}, 15000);

test("models rejects missing, unknown, positional, and duplicate arguments without echoing input", () => {
  for (const args of [
    [], ["--json"], ["--file"], ["--file", ""], ["--file", "--json"],
    ["--file", "catalog.json", `--${secret}`], [secret],
    ["--file", "catalog.json", "--file", secret],
    ["--file", "catalog.json", "--json", "--json"], ["--help", secret],
  ]) {
    const result = run(["models", ...args]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Usage: multiagents models --file <path> [--json]");
  }
}, 15000);

test("models sanitizes missing file, malformed JSON, unsupported protocol and literal credentials", async () => {
  const missing = run(["models", "--file", join(directory, secret)]);
  expect(missing.exitCode).not.toBe(0);
  expect(missing.stdout).toBe("");
  await Bun.write(join(directory, "invalid.json"), `{${secret}`);
  const malformed = run(["models", "--file", "invalid.json", "--json"]);
  expect(malformed.exitCode).not.toBe(0);
  expect(malformed.stderr).toBe(missing.stderr);
  for (const fixture of [
    { ...provider(), apiType: "chatcompletions" },
    { ...provider(), apiKey: secret },
  ]) {
    const path = await catalog([fixture]);
    const result = run(["models", "--file", path, "--json"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(missing.stderr);
  }
  expect(missing.stderr).toContain("Cannot list models.");
}, 15000);