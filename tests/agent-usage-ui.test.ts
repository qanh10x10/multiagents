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
test("missing usage is not zero or assumed quota; measured zero is retained", () => {
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
  const missing = render({ input_tokens: 0, output_tokens: 0 });
  expect(missing).toContain("Không phải số 0 đo được");
  expect(missing).toContain("Provider chưa báo cáo");
  expect(missing).not.toContain("<progress");
  const measured = render({ input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, agent_usage: JSON.stringify({ tokensObservedAt: Date.now(), quotas: {} }) });
  expect(measured).toContain("<dd>0</dd>");
  expect(measured).toContain("cached đã nằm trong input");
});
test("quota windows are labelled by actual duration with remaining/reset and stale state", () => {
  const output = render({ status: "disconnected", input_tokens: 100, output_tokens: 10, cache_read_tokens: 25,
    agent_usage: JSON.stringify({ tokensObservedAt: 1000, quotas: { bucket: {
      primary: { windowMinutes: 10080, usedPercent: 50, observedAt: 1000, resetsAt: 2000 },
      secondary: { windowMinutes: 300, usedPercent: 80, observedAt: 1000, resetsAt: null },
    } } }) });
  expect(output).toContain("Hằng tuần: 50% còn lại (báo cáo gần nhất)");
  expect(output).toContain("5 giờ: 20% còn lại (báo cáo gần nhất)");
  expect(output).toContain("đang chờ cập nhật");
  expect(output).toContain('aria-label="5 giờ còn lại: 20%, báo cáo gần nhất"');
  expect(output).toContain("dùng chung với worker khác");
});
