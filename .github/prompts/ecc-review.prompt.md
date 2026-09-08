---
description: "Review a specified diff for evidenced bugs, security risks, regressions, and missing regression tests without changing files."
agent: "agent"
argument-hint: "Specify files, a diff, or the comparison base to review"
---

Read [project instructions](../../AGENTS.md) and the [local workflow](../../docs/ecc-workflow.md). Review only; do not fix, stage, commit, or modify files.

1. Confirm the review scope. Inspect Git status and the requested diff, including relevant staged and unstaged changes. Inspect untracked files only when they belong to the requested change. Do not attribute unrelated dirty edits to this task.
2. Read surrounding code, callers, guards, and tests before reporting an issue. Prioritize concrete behavioral failures, security boundaries, lifecycle/recovery regressions, and missing regression coverage. Avoid speculative findings and unrelated style cleanup.
3. For each finding, give severity, exact path and line, triggering input or state, user-visible consequence, and a narrow correction. State assumptions and verification gaps. Never reproduce credential values in findings.
4. Return Findings first, then Open Questions and Validation/Gaps. Explicitly state when there are no findings; absence of findings is not proof of correctness. Recommend only safe, relevant checks; do not launch live-provider tests or services without authorization.

Original local adaptation; upstream sources and deliberate differences are recorded in the workflow guide.