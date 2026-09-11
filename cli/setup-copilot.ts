import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { codexCommand } from "../shared/codex-executable.ts";
import { listModels } from "../shared/model-providers.ts";
import { validateSelectedEnvironmentKey } from "../orchestrator/selected-codex-runtime.ts";

type Environment = Record<string, string | undefined>;
type JsonObject = Record<string, unknown>;
export interface SetupOptions {
  check: boolean;
  credentials: "prompt" | "env";
  help: boolean;
}
export interface SetupContext {
  projectDir: string;
  home: string;
  env: Environment;
  executable: string;
}

const SERVER = "multiagents-orch";
const INPUT_PREFIX = "multiagents-orch-key-";
const HELP = `Copilot workspace MCP setup
Usage: setup-copilot.bat [--credentials prompt|env] [--check] [--no-pause] [--help]
Default: merge only this checkout's .vscode/mcp.json; no installs or services.
--credentials prompt  Password inputs in VS Code (default); never enter keys in chat.
--credentials env     Inherit provider variables from the MCP host (Agent Host compatible).
--check               Inspect prerequisites/config without writing or starting services.
--no-pause            Skip the BAT wrapper pause for automation.
Existing conflicts and JSONC are refused; review manually, never overwrite blindly.`;

class SetupError extends Error {}
function fail(message: string): never { throw new SetupError(message); }
function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Invalid workspace MCP configuration shape; review .vscode/mcp.json manually.");
  }
  return value as JsonObject;
}
function inputFor(key: string): JsonObject {
  return {
    id: INPUT_PREFIX + key,
    type: "promptString",
    description: `multiagents: ${key}. Unused provider can leave blank. Enter only in this VS Code password prompt.`,
    password: true,
  };
}
function referenceFor(key: string): string { return `\${input:${INPUT_PREFIX}${key}}`; }

export function parseSetupOptions(args: string[]): SetupOptions {
  const options: SetupOptions = { check: false, credentials: "prompt", help: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--help": options.help = true; break;
      case "--check": options.check = true; break;
      case "--no-pause": break;
      case "--credentials": {
        const mode = args[++i];
        if (mode !== "prompt" && mode !== "env") fail("Use --credentials prompt or --credentials env.");
        options.credentials = mode;
        break;
      }
      default: fail("Unknown setup option. Use --help; never pass credentials as arguments.");
    }
  }
  return options;
}

export async function discoverSetupCatalog(context: SetupContext): Promise<{ path?: string; keys: string[] }> {
  const candidates = [
    join(context.projectDir, ".multiagents", "chatLanguageModels.json"),
    context.env.MULTIAGENTS_MODELS_FILE ? resolve(context.projectDir, context.env.MULTIAGENTS_MODELS_FILE) : undefined,
    process.platform === "win32" && context.env.APPDATA ? join(context.env.APPDATA, "Code", "User", "chatLanguageModels.json") : undefined,
  ];
  const path = candidates.find((candidate): candidate is string => !!candidate && existsSync(candidate));
  if (!path) return { keys: [] };
  try {
    const catalog = await listModels(path, context.projectDir, context.env);
    const keys = [...new Set(catalog.models.map(model => model.envKey))].sort();
    for (const key of keys) validateSelectedEnvironmentKey(key);
    if (process.platform === "win32" && new Set(keys.map(key => key.toUpperCase())).size !== keys.length) {
      fail("Ambiguous credential variable casing.");
    }
    return { path: catalog.catalog_path, keys };
  } catch {
    fail("Model catalog rejected. Use valid JSON with supported provider references, never literal API keys; use dedicated provider environment names. Catalog contents are not printed.");
  }
}

/** Pure merge: ownership requires both our exact reference and unchanged input definition. */
export function mergeCopilotConfig(
  source: unknown, context: SetupContext, catalog: { path?: string; keys: string[] }, credentials: "prompt" | "env",
): JsonObject {
  const root = structuredClone(object(source));
  const servers = root.servers === undefined ? {} : object(root.servers);
  if (root.inputs !== undefined && !Array.isArray(root.inputs)) object(null);
  let inputs = (root.inputs ?? []) as unknown[];
  const ids = new Set<string>();
  for (const input of inputs) {
    const id = object(input).id;
    if (typeof id !== "string" || ids.has(id)) fail("Invalid or duplicate MCP input IDs; review inputs manually.");
    ids.add(id);
  }
  const previous = servers[SERVER] === undefined ? undefined : object(servers[SERVER]);
  const desired = { type: "stdio", command: resolve(context.executable), args: [join(context.projectDir, "orchestrator", "orchestrator-server.ts")], cwd: context.projectDir };
  if (previous) {
    for (const [key, value] of Object.entries(desired)) {
      if (!isDeepStrictEqual(previous[key], value)) {
        fail("Existing multiagents-orch server conflicts with this checkout. Review or rename it manually; nothing was overwritten.");
      }
    }
  }
  const env = previous?.env === undefined ? {} : object(previous.env);
  const db = join(context.home, ".multiagents", "peers.db").replaceAll("\\", "/");
  const defaults = { MULTIAGENTS_DB: db, ...(catalog.path ? { MULTIAGENTS_MODELS_FILE: catalog.path } : {}) };
  // Refuse Windows aliases before applying defaults or removing exactly owned inputs.
  if (process.platform === "win32") {
    const names = new Map<string, string>();
    for (const key of [...Object.keys(defaults), ...catalog.keys, ...Object.keys(env)]) {
      const normalized = key.toUpperCase();
      if (names.has(normalized) && names.get(normalized) !== key) {
        fail("Existing multiagents-orch environment has conflicting variable casing. Review manually; no values are printed or overwritten.");
      }
      names.set(normalized, key);
    }
  }
  for (const [key, value] of Object.entries(defaults)) {
    if (Object.hasOwn(env, key) && env[key] !== value) fail("Existing multiagents-orch environment conflicts with setup. Review manually; no values are printed or overwritten.");
    env[key] = value;
  }

  const owned = new Map<string, JsonObject>();
  for (const [key, value] of Object.entries(env)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && value === referenceFor(key)) {
      const expected = inputFor(key);
      if (inputs.some(input => isDeepStrictEqual(input, expected))) owned.set(key, expected);
    }
  }
  // Only remove unchanged entries authored by this setup, never arbitrary input references.
  for (const key of owned.keys()) {
    if (credentials === "env" || (catalog.path && !catalog.keys.includes(key))) delete env[key];
  }
  for (const key of catalog.keys) {
    if (credentials === "env") {
      if (Object.hasOwn(env, key)) fail("Provider variable already configured by the user; remove it manually to enable environment inheritance. Nothing was overwritten.");
      continue;
    }
    const input = inputFor(key);
    const collision = inputs.find(candidate => object(candidate).id === input.id);
    if ((collision && !owned.has(key)) || (Object.hasOwn(env, key) && !owned.has(key))) {
      fail("Provider credential input or environment entry conflicts with setup. Review manually; nothing was overwritten.");
    }
    if (!collision) inputs.push(input);
    env[key] = referenceFor(key);
  }
  servers[SERVER] = { ...previous, ...desired, env };
  root.servers = servers;
  // Keep generated inputs that another server/root property still references.
  const withoutInputs = { ...root };
  delete withoutInputs.inputs;
  const remaining = JSON.stringify(withoutInputs);
  for (const [key, input] of owned) {
    if (env[key] !== referenceFor(key) && !remaining.includes(referenceFor(key))) {
      inputs = inputs.filter(candidate => !isDeepStrictEqual(candidate, input));
    }
  }
  if (inputs.length || root.inputs !== undefined) root.inputs = inputs;
  return root;
}

export async function setupCopilot(options: SetupOptions, context: SetupContext): Promise<string[]> {
  if (options.help) return [HELP];
  try {
    context = { ...context, projectDir: resolve(context.projectDir), home: resolve(context.home) };
    if (!existsSync(context.executable)) fail("Bun executable missing. Install Bun manually, then rerun setup.");
    if (!existsSync(join(context.projectDir, "orchestrator", "orchestrator-server.ts"))) fail("Incomplete checkout: orchestrator server is missing.");
    if (!existsSync(join(context.projectDir, "node_modules", "@modelcontextprotocol", "sdk", "package.json"))) {
      fail("Dependencies missing. Run bun install in this checkout, then rerun setup. Setup never installs packages.");
    }
    const searchPath = [context.env.PATH ?? context.env.Path ?? "", join(context.home, ".bun", "bin"), join(context.home, ".local", "bin"), join(context.home, ".cargo", "bin"), join(context.home, ".volta", "bin"), join(context.home, "bin"), ...(process.platform === "win32" ? [join(context.env.APPDATA ?? join(context.home, "AppData", "Roaming"), "npm")] : [])].join(delimiter);
    try { codexCommand({ PATH: searchPath }); }
    catch { fail("Codex CLI missing. Install it manually and expose its binary or npm shim on PATH, then rerun setup. No CLI was launched."); }
    const catalog = await discoverSetupCatalog(context);
    const file = join(context.projectDir, ".vscode", "mcp.json");
    const before = existsSync(file) ? readFileSync(file, "utf8") : undefined;
    let source: unknown = {};
    if (before !== undefined) {
      try { source = JSON.parse(before); }
      catch { fail("Cannot parse .vscode/mcp.json as strict JSON. Comments, trailing commas, and malformed JSON are not edited. Back up and convert it manually to strict JSON, then rerun."); }
    }
    const merged = mergeCopilotConfig(source, context, catalog, options.credentials);
    const changed = !isDeepStrictEqual(source, merged);
    if (changed && !options.check) {
      mkdirSync(dirname(file), { recursive: true });
      if (before === undefined) writeFileSync(file, JSON.stringify(merged, null, 2) + "\n", { flag: "wx" });
      else {
        if (readFileSync(file, "utf8") !== before) fail("Workspace MCP configuration changed during setup. Retry after reviewing concurrent edits.");
        writeFileSync(file, JSON.stringify(merged, null, 2) + "\n");
      }
    }
    return [
      "Prerequisites OK: Bun, MCP SDK, Codex (detected only; not launched).",
      options.check ? `Check only: ${changed ? "workspace configuration needs setup" : "workspace configuration is current"}; no files written.` : changed ? "Workspace .vscode/mcp.json configured." : "Workspace .vscode/mcp.json already current; no changes.",
      catalog.path ? `Model catalog validated; ${catalog.keys.length} unique provider credential variable(s).` : "No model catalog found. Tools can still be discovered. Add .multiagents/chatLanguageModels.json or set MULTIAGENTS_MODELS_FILE and rerun before selecting a model.",
      options.credentials === "prompt" ? "Credentials: VS Code password prompts; unused providers can leave blank. Never send keys to chat or terminal." : "Credentials: inherited provider environment variables. Start/restart the MCP host from an environment containing them; no password inputs are generated.",
      "Next: open this checkout in trusted VS Code, run MCP: List Servers, select multiagents-orch and start/restart it. Ask for list_models and get_guide before confirming a target and paid worker task.",
      "Setup did not start a broker, dashboard, or worker, and did not change global settings.",
    ];
  } catch (error) {
    // Only our constant, actionable messages are safe to surface; OS errors can include data.
    if (error instanceof SetupError) throw error;
    fail("Setup failed while inspecting or writing workspace configuration. Check file permissions and checkout paths; no raw error details are printed.");
  }
}

if (import.meta.main) {
  try {
    const options = parseSetupOptions(process.argv.slice(2));
    const messages = await setupCopilot(options, {
      projectDir: fileURLToPath(new URL("..", import.meta.url)), home: homedir(), env: process.env, executable: process.execPath,
    });
    for (const message of messages) console.log(message);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Setup failed.");
    process.exitCode = 1;
  }
}