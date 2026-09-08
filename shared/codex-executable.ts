import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

/** Resolve npm's Windows shim without invoking a shell or interpolating arguments. */
export function codexCommand(env: Record<string, string | undefined>): string[] {
  const searchPath = env.PATH ?? env.Path ?? process.env.PATH ?? "";
  const found = Bun.which("codex", { PATH: searchPath });
  if (found && !/\.(?:cmd|bat|ps1)$/i.test(found)) return [found];
  if (process.platform === "win32") {
    const dirs = found ? [dirname(found), ...searchPath.split(delimiter)] : searchPath.split(delimiter);
    for (const dir of dirs) {
      if (!dir) continue;
      const entry = join(dir, "node_modules", "@openai", "codex", "bin", "codex.js");
      if (existsSync(entry)) return [process.execPath, entry];
    }
  }
  throw new Error("Codex executable not found. Install Codex CLI and add its binary or npm directory to PATH.");
}