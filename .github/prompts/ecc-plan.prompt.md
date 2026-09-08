---
description: "Plan a scoped change from repository evidence without editing files or starting implementation."
agent: "agent"
argument-hint: "Describe the task, constraints, and acceptance criteria"
---

Read [project instructions](../../AGENTS.md) and the [local workflow](../../docs/ecc-workflow.md). This is a planning-only request; do not edit files, install dependencies, or launch services.

1. Restate the requested outcome, constraints, exclusions, and measurable acceptance criteria. Ask only about ambiguities that materially affect the plan.
2. Inspect Git status, relevant diffs, nearby code, callers, tests, and existing scripts. Search for a reusable implementation before proposing new code. Consult official sources only where evidence is missing; cite sources and distinguish verified facts from assumptions.
3. Propose the smallest implementation in ordered steps. Identify owned paths, patterns to follow with file references, dependencies, risks, and focused verification commands confirmed against this project. Do not introduce TDD unless explicitly requested.
4. Return Findings, Plan, Validation Strategy, and Remaining Risks. Wait for explicit implementation approval; do not treat this prompt invocation as approval to implement or perform Git or external side effects.

Original local adaptation; upstream sources and deliberate differences are recorded in the workflow guide.