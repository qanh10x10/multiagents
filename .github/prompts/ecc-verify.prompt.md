---
description: "Verify existing work against acceptance criteria using focused project checks and report evidence without expanding scope."
agent: "agent"
argument-hint: "Specify the completed change and acceptance criteria to verify"
---

Read [project instructions](../../AGENTS.md) and the [local workflow](../../docs/ecc-workflow.md). Verify existing work; do not change source or configuration to make a check pass.

1. Identify acceptance criteria and changed paths from the request and relevant Git diff. Inspect applicable tests and `package.json`; choose only commands that exist and address this change.
2. Run focused existing checks with bounded execution time. Review tests for service, credential, filesystem, and network side effects first. Do not install packages or start live-provider flows without authorization. For docs-only work, inspect links, frontmatter, instructions, and whitespace rather than running the application.
3. Record each command, working directory, exit code, and meaningful result. Report unavailable or inapplicable build, lint, type, or test checks as skipped with reasons, never passed. Investigate a timeout without blindly rerunning or increasing limits.
4. Recheck acceptance criteria and the scoped diff for regressions, secret exposure, temporary artifacts, and unrelated edits. Do not print secrets while inspecting evidence.
5. Return Findings, Validation, and Remaining Risks, separating passed checks, failures, and untested claims. Stop on completion or a blocker; propose a narrow follow-up rather than silently fixing or broadening scope.

Original local adaptation; upstream sources and deliberate differences are recorded in the workflow guide.