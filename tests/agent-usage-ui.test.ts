import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

const html = await Bun.file(new URL("../dashboard/index.html", import.meta.url)).text();
const start = html.indexOf("    function usageData(slot)");
const end = html.indexOf("    function renderStats()", start);
const code = html.slice(start, end);
const escape = (value: any) => String(value).replace(/[<>&"']/g, (s) => `&#${s.charCodeAt(0)};`);
function render(slot: any) {
  return runInNewContext(`${code}\nrenderUsage(slot)`, { slot, esc: escape, Date, Number, Object, JSON, Boolean });
}
test("missing usage is not zero; measured zero is retained", () => {
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
  const missing = render({ input_tokens: 0, output_tokens: 0 });
  expect(missing).toContain("Không phải số 0 đo được");
  expect(missing).not.toContain("<progress");
  expect(missing).not.toContain("5 giờ");
  expect(missing).not.toContain("Hằng tuần");
  const measured = render({ input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, agent_usage: JSON.stringify({ tokensObservedAt: Date.now(), quotas: {} }) });
  expect(measured).toContain("<dd>0</dd>");
  expect(measured).toContain("cached đã nằm trong input");
});
test("5h/weekly quota windows are not rendered", () => {
  const output = render({ status: "disconnected", input_tokens: 100, output_tokens: 10, cache_read_tokens: 25,
    agent_usage: JSON.stringify({ tokensObservedAt: 1000, quotas: { bucket: {
      primary: { windowMinutes: 10080, usedPercent: 50, observedAt: 1000, resetsAt: 2000 },
      secondary: { windowMinutes: 300, usedPercent: 80, observedAt: 1000, resetsAt: null },
    } } }) });
  expect(output).not.toContain("Hằng tuần");
  expect(output).not.toContain("5 giờ");
  expect(output).not.toContain("<progress");
  expect(output).toContain("cached đã nằm trong input");
});
