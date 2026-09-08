import { expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { codexCommand } from "../shared/codex-executable.ts";

test("native executable is passed directly without a shell", () => {
  const which = spyOn(Bun, "which").mockReturnValue(process.execPath);
  try { expect(codexCommand({ PATH: "fixture" })).toEqual([process.execPath]); }
  finally { which.mockRestore(); }
});

test.skipIf(process.platform !== "win32")("Windows npm shims resolve to their JS entry, including spaces and Path fallback", () => {
  const directory = mkdtempSync(join(tmpdir(), "multiagents-codex executable-"));
  const entry = join(directory, "node_modules", "@openai", "codex", "bin", "codex.js");
  const which = spyOn(Bun, "which");
  try {
    mkdirSync(join(directory, "node_modules", "@openai", "codex", "bin"), { recursive: true });
    writeFileSync(entry, "// Offline resolver fixture\n");
    for (const extension of ["cmd", "bat", "ps1"]) {
      which.mockReturnValue(join(directory, `codex.${extension}`));
      expect(codexCommand({ PATH: directory })).toEqual([process.execPath, entry]);
    }
    which.mockReturnValue(null);
    expect(codexCommand({ Path: `${join(directory, "absent")}${delimiter}${directory}` })).toEqual([process.execPath, entry]);
    expect(() => codexCommand({ PATH: join(directory, "missing") })).toThrow("Codex executable not found");
  } finally {
    which.mockRestore();
    rmSync(directory, { recursive: true, force: true });
  }
});