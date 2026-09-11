import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Run from any directory; only the extension manifest's allowlist enters VSIX.
const root = fileURLToPath(new URL("../", import.meta.url));
const extension = join(root, "extensions", "multiagents-chat");
const manifest = await Bun.file(join(extension, "package.json")).json();
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Expected a release version in extension manifest");
const output = join(root, "artifacts", `${manifest.name}-${manifest.version}.vsix`);
await mkdir(join(root, "artifacts"), { recursive: true });
const result = Bun.spawn([
  process.execPath, "x", "@vscode/vsce@3.6.2", "package", "--no-dependencies",
  "--allow-missing-repository", "--skip-license", "--no-rewrite-relative-links", "--out", output,
], { cwd: extension, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
const exit = await result.exited;
if (exit !== 0) process.exit(exit);
console.log(`Local VSIX: ${output}`);
console.log("Copy this VSIX plus readme-install.md to another machine. MCP source and credentials are separate.");