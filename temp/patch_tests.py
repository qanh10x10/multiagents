from pathlib import Path

# Remove unused quota CSS from dashboard
p = Path("dashboard/index.html")
text = p.read_text(encoding="utf-8")
old_css = """    .usage-limit { margin-top: 12px; font-size: 13px; }
    .usage-limit progress { display: block; width: 100%; height: 8px; margin: 6px 0; accent-color: var(--cyan); }
    .usage-limit.low progress { accent-color: var(--yellow); }
    .usage-limit.expired progress { accent-color: var(--text-muted); }
"""
if old_css not in text:
    raise SystemExit("usage-limit css not found")
text = text.replace(old_css, "", 1)
p.write_text(text, encoding="utf-8", newline="\n")
print("removed unused usage-limit css")

usage = Path("tests/agent-usage-ui.test.ts")
usage.write_text("""import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

const html = await Bun.file(new URL("../dashboard/index.html", import.meta.url)).text();
const start = html.indexOf("    function usageData(slot)");
const end = html.indexOf("    function renderStats()", start);
const code = html.slice(start, end);
const escape = (value: any) => String(value).replace(/[<>&"']/g, (s) => `&#${s.charCodeAt(0)};`);
function render(slot: any) {
  return runInNewContext(`${code}\\nrenderUsage(slot)`, { slot, esc: escape, Date, Number, Object, JSON, Boolean });
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
""", encoding="utf-8", newline="\n")
print("updated agent-usage-ui.test.ts")

web = Path("tests/web-dashboard.test.ts")
web_text = web.read_text(encoding="utf-8")
old = '''  test("contains all 6 tab panels", async () => {
    const res = await fetch(DASHBOARD_URL);
    const html = await res.text();
    expect(html).toContain('data-tab="agents"');
    expect(html).toContain('data-tab="messages"');
    expect(html).toContain('data-tab="plan"');
    expect(html).toContain('data-tab="knowledge"');
    expect(html).toContain('data-tab="files"');
    expect(html).toContain('data-tab="stats"');
  });'''
new = '''  test("contains conversation tabs without standalone agents panel", async () => {
    const res = await fetch(DASHBOARD_URL);
    const html = await res.text();
    expect(html).not.toContain('data-tab="agents"');
    expect(html).toContain('data-tab="messages"');
    expect(html).toContain('data-tab="plan"');
    expect(html).toContain('data-tab="knowledge"');
    expect(html).toContain('data-tab="files"');
    expect(html).toContain('data-tab="stats"');
    expect(html).toContain("chat-agent-bar");
    expect(html).toContain('lang="vi"');
    expect(html).not.toContain("5 giờ");
    expect(html).not.toContain("Hằng tuần");
  });'''
if old not in web_text:
    raise SystemExit("web dashboard tab test not found")
web.write_text(web_text.replace(old, new, 1), encoding="utf-8", newline="\n")
print("updated web-dashboard.test.ts")
