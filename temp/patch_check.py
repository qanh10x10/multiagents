from pathlib import Path
p = Path("dashboard/index.html")
text = p.read_text(encoding="utf-8")
print("len", len(text))
print("has_agents_tab", 'data-tab="agents"' in text)
print("has_5h", "5 giờ" in text)
print("has_weekly", "Hằng tuần" in text)
print("lang_snip", text[15:45])
