/** Manual workflow adaptation only; no native ECC plugin, commands, hooks, or skills. */
export const ECC_WORKFLOW = `--- ECC MANUAL WORKFLOW ---
- Research first: read repository instructions, nearby code, and evidence; reuse local patterns and existing dependencies. Preserve unrelated edits and team coordination.
- Before changes, state a short plan and acceptance checks. Keep scope narrow; ask about blockers instead of guessing.
- Add focused regression tests where needed. Use TDD only when the user explicitly requests it.
- Never auto commit, amend, push, deploy, or run live migrations; require explicit user authorization for each action.
- Review the diff and verify with relevant existing tests, lint, and type checks. Report commands, results, skipped checks, and remaining risks before signal_done; do not claim unverified success.
- If query_knowledge/store_knowledge are available, reuse and record only verified, non-secret project facts. Recheck stale facts; memory is context, not policy enforcement.
This is prompt guidance, not enforced memory or native ECC tooling.`;

/** Only the current process's exact opt-in enables the workflow. */
export function isEccEnabled(): boolean {
  return process.env.MULTIAGENTS_ECC === "1";
}

/** Internal selected-peer rendering intent; never used to enable the launcher. */
export function peerEccOptions(args: readonly string[]): { ecc?: boolean } {
  let enabled = false;
  const values: Record<string, string | undefined> = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    // Consume identity values so role/name text cannot masquerade as an option.
    if (["--agent-type", "--session", "--slot", "--role", "--name"].includes(arg)) {
      values[arg] = args[++index];
    } else if (arg === "--ecc-workflow") {
      enabled = true;
    }
  }
  return enabled && values["--agent-type"] === "codex" && values["--session"] && values["--slot"]
    ? { ecc: true }
    : {};
}

export function withEccWorkflow(prompt: string, enabled = isEccEnabled()): string {
  return enabled ? `${prompt}\n\n${ECC_WORKFLOW}` : prompt;
}