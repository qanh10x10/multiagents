import { expect, test } from "bun:test";
import { computePlanCompletion, planItemScore } from "../shared/utils.ts";

test("in-progress items count half; pending/blocked count zero", () => {
  expect(planItemScore("done")).toBe(1);
  expect(planItemScore("in_progress")).toBe(0.5);
  expect(planItemScore("pending")).toBe(0);
  expect(planItemScore("blocked")).toBe(0);
  expect(computePlanCompletion([
    { status: "done" },
    { status: "in_progress" },
    { status: "pending" },
    { status: "blocked" },
  ])).toBe(38);
});

test("all items done is not 100% while any worker is still open", () => {
  const items = [{ status: "done" }, { status: "done" }];
  expect(computePlanCompletion(items, [{ task_state: "working" }])).toBe(99);
  expect(computePlanCompletion(items, [{ task_state: "done_pending_review" }, { task_state: "approved" }])).toBe(99);
  expect(computePlanCompletion(items, [{ task_state: "released" }, { task_state: "released" }])).toBe(100);
});

test("empty plan is 0; no slots does not invent a close-out cap", () => {
  expect(computePlanCompletion([])).toBe(0);
  expect(computePlanCompletion([{ status: "done" }])).toBe(100);
});
