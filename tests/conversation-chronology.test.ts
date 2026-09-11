import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

const html = await Bun.file(new URL("../dashboard/index.html", import.meta.url)).text();
const code = html.slice(html.indexOf("    function patchTimeline("), html.indexOf("    // --- Plan panel ---"));

// Minimal DOM for executing the actual renderer; browser fixtures cover layout/scroll clamping.
class Element {
  children: Element[] = [];
  parent: Element | null = null;
  dataset: Record<string, string> = {};
  textContent = "";
  className = "";
  open = false;
  hidden = false;
  value = "";
  scrollTop = 0;
  scrollHeight = 5000;
  writes = 0;
  selectors = new Map<string, Element>();
  constructor(readonly tag = "div") {}
  remove() {
    if (this.parent) {
      this.parent.writes++;
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null;
    }
  }
  insertBefore(row: Element, before: Element | null) {
    if (row === before) return row;
    row.remove();
    const index = before ? this.children.indexOf(before) : this.children.length;
    if (index < 0) throw new Error("Reference node not found");
    this.children.splice(index, 0, row);
    row.parent = this;
    this.writes++;
    return row;
  }
  append(...rows: Element[]) { rows.forEach(row => this.insertBefore(row, null)); }
  replaceChildren(...rows: Element[]) {
    [...this.children].forEach(row => row.remove());
    this.writes++;
    this.append(...rows);
  }
  querySelector(selector: string): Element | null {
    return this.selectors.get(selector) || this.children.find(row => row.tag === selector)
      || this.children.map(row => row.querySelector(selector)).find(Boolean) || null;
  }
  querySelectorAll() { return []; }
}

function harness() {
  const panel = new Element();
  panel.dataset.session = "fixture";
  for (const selector of [".feed-toolbar", "#conversation-sessions", "#message-agent", "#message-count",
    "#message-timeline", "#message-latest", "#message-events", "#conversation-agents"]) {
    panel.selectors.set(selector, new Element());
  }
  const messages = Array.from({ length: 45 }, (_, id) => ({ id, from_id: "fixture", to_id: "team",
    msg_type: id === 2 ? "system" : "chat", sent_at: "2026-09-09T01:00:00Z",
    text: `[Fixture ${id}] ` + (id === 4 || id === 10 ? "details ".repeat(100) : "message") }));
  const context = { document: { createElement: (tag: string) => new Element(tag), getElementById: () => panel },
    state: { sessionId: "fixture", slots: [], messages, brokerAlive: true, plan: null },
    allSessions: [], messageAgent: "", messageQuery: "", autoScroll: false };
  const api = runInNewContext(`${code}; ({ patchTimeline, renderMessages })`, context);
  const feed = panel.selectors.get("#message-timeline")!;
  const ids = () => feed.children.map(row => Number(row.dataset.messageId));
  const expected = messages.filter(m => m.msg_type === "chat").map(m => m.id);
  return { ...api, context, feed, ids, expected, panel };
}

for (const id of [4, 10]) test(`filter shrink/expand retains row ${id} and open details in chronological order`, () => {
  const h = harness();
  h.renderMessages(true);
  const row = h.feed.children.find((r: Element) => r.dataset.messageId === String(id))!;
  const details = row.querySelector("details")!;
  details.open = true;
  h.context.messageQuery = `[Fixture ${id}]`;
  h.renderMessages(true);
  expect(h.ids()).toEqual([id]);
  h.context.messageQuery = "";
  h.renderMessages(true);
  expect(h.ids()).toEqual(h.expected);
  expect(h.feed.children.find((r: Element) => r.dataset.messageId === String(id))).toBe(row);
  expect(row.querySelector("details")).toBe(details);
  expect(details.open).toBe(true);
});

test("identical updates do not reconstruct or move timeline nodes", () => {
  const h = harness();
  h.renderMessages(true);
  const nodes = [...h.feed.children];
  const writes = nodes.map(row => row.writes);
  const feedWrites = h.feed.writes;
  h.renderMessages(true);
  expect(h.feed.writes).toBe(feedWrites);
  nodes.forEach((row, index) => {
    expect(h.feed.children[index]).toBe(row);
    expect(row.writes).toBe(writes[index]);
  });
});

test("existing out-of-order rows move without replacing their details", () => {
  const h = harness();
  h.renderMessages(true);
  const row = h.feed.children[9]!;
  const details = row.querySelector("details")!;
  details.open = true;
  h.feed.insertBefore(row, h.feed.children[0]!);
  h.renderMessages(true);
  expect(h.ids()).toEqual(h.expected);
  expect(h.feed.children[9]).toBe(row);
  expect(row.querySelector("details")).toBe(details);
  expect(details.open).toBe(true);
});

test("reading offset is preserved on forced updates and new history stays pending", () => {
  const h = harness();
  h.renderMessages(true);
  h.feed.scrollTop = 230;
  h.renderMessages(true);
  expect(h.feed.scrollTop).toBe(230);
  const writes = h.feed.writes;
  h.context.state.messages.push({ ...h.context.state.messages[1]!, id: 45 });
  h.renderMessages();
  expect(h.feed.writes).toBe(writes);
  expect(h.feed.scrollTop).toBe(230);
  expect(h.panel.selectors.get("#message-latest")!.hidden).toBe(false);
  h.renderMessages(true);
  expect(h.ids()).toEqual([...h.expected, 45]);
  expect(h.feed.scrollTop).toBe(230);
});
