import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ResolvedModelSelection } from "../shared/model-providers.ts";
import type { CodexRuntimeConfig } from "./codex-driver.ts";

type Environment = Record<string, string | undefined>;
const OS_ENV = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|LANG|LC_ALL|TERM)$/i;

export function validateSelectedEnvironmentKey(key: string): void {
  if (OS_ENV.test(key) || /^(CODEX_|MULTIAGENTS_|BUN_|NODE_|OPENAI_BASE_URL$)/i.test(key)) {
    throw new Error("Selected credential must use a dedicated provider environment variable.");
  }
}

/** Private durable state, not a temporary config overlay: crash/resume needs its threads. */
export function selectedCodexRuntime(
  resolved: ResolvedModelSelection,
  sourceEnv: Environment,
  projectDir: string,
  peerArgs: string[],
): { runtime: CodexRuntimeConfig; env: Environment } {
  validateSelectedEnvironmentKey(resolved.envKey);
  try {
    const project = realpathSync(projectDir);
    const userHome = resolve(sourceEnv[process.platform === "win32" ? "USERPROFILE" : "HOME"] ?? homedir());
    const root = join(userHome, ".multiagents", "codex-workers");
    const location = relative(project, root);
    // Reject state inside the task workspace, including when the task is the user home.
    if (!location || (location !== ".." && !location.startsWith(`..${sep}`) && !isAbsolute(location))) {
      throw new Error("Private state must be outside the task workspace");
    }
    const identity = createHash("sha256").update(JSON.stringify([
      project, sourceEnv.MULTIAGENTS_SESSION, sourceEnv.MULTIAGENTS_SLOT,
    ])).digest("hex");
    const home = join(root, identity);
    for (const directory of [join(userHome, ".multiagents"), root, home]) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (lstatSync(directory).isSymbolicLink()) throw new Error("Linked private directory");
      if (process.platform !== "win32") chmodSync(directory, 0o700);
    }
    if (process.platform === "win32") {
      const identity = Bun.spawnSync(["whoami.exe", "/user", "/fo", "csv", "/nh"], { stdout: "pipe", stderr: "pipe", timeout: 5000 });
      const sid = identity.stdout.toString().match(/S-1-\d+(?:-\d+)+/)?.[0];
      if (identity.exitCode !== 0 || !sid) throw new Error("Cannot identify private state owner");
      const permissions = Bun.spawnSync(["icacls.exe", home, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`], { stdout: "pipe", stderr: "pipe", timeout: 5000 });
      if (permissions.exitCode !== 0) throw new Error("Cannot protect private state");
    }
    const env: Environment = {};
    for (const [key, value] of Object.entries(sourceEnv)) {
      if (OS_ENV.test(key) || /^MULTIAGENTS_(SESSION|SLOT|ROLE|NAME|PORT|DRIVER_MODE)$/.test(key)) env[key] = value;
    }
    env[resolved.envKey] = sourceEnv[resolved.envKey];
    env.CODEX_HOME = home;
    const allowAll = sourceEnv.MULTIAGENTS_CODEX_ALLOW_ALL === "1";
    const config = [
      ...resolved.codexArgs.filter((_, index) => index % 2 === 1),
      'cli_auth_credentials_store="file"',
      'mcp_oauth_credentials_store="file"',
      'check_for_update_on_startup=false',
      'features.remote_plugin=false',
      'features.plugins=false',
      'features.recommended_plugins=false',
      'features.skip_host_skill_discovery=true',
      'analytics.enabled=false',
      'mcp_servers.multiagents-peer={ command = ' + JSON.stringify(process.execPath)
        + ', args = ' + JSON.stringify(peerArgs) + ', env = { MULTIAGENTS_DRIVER_MODE = "1" }'
        + (allowAll ? ', default_tools_approval_mode = "approve"' : '') + ' }',
    ];
    // Untrusted project layers are ignored by native Codex. Cover ancestors too,
    // including a parent repository when the selected working directory is nested.
    for (let directory = project;; directory = dirname(directory)) {
      config.push(`projects.${JSON.stringify(directory)}.trust_level="untrusted"`);
      if (dirname(directory) === directory) break;
    }
    const file = join(home, "config.toml");
    try { if (lstatSync(file).isSymbolicLink()) throw new Error("Linked private config"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    writeFileSync(file, config.join("\n") + "\n", { mode: 0o600 });
    if (process.platform !== "win32") chmodSync(file, 0o600);
    return { env, runtime: { allowAll, model: resolved.modelId, modelProvider: "multiagents_custom", processCwd: home, threadCwd: project } };
  } catch {
    throw new Error("Cannot prepare private Codex worker configuration outside the project with owner-only access.");
  }
}