from pathlib import Path
p = Path("tests/web-dashboard.test.ts")
t = p.read_text(encoding="utf-8")
old = '    expect(html).toContain("chat-agent-bar");'
new = '''    expect(html).toContain("agent-rail");
    expect(html).toContain("agent-rail-toggle");
    expect(html).toContain('id="conversation-agents"');'''
if old not in t:
    raise SystemExit("marker not found")
p.write_text(t.replace(old, new, 1), encoding="utf-8", newline="\n")
print("updated web-dashboard.test.ts")
