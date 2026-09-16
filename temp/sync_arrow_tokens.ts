import fs from 'node:fs';
import path from 'node:path';

const dir = 'C:/Users/PC/.codex/sessions/2026/09/13';
const files = [
  { slotId: 1, name: 'PO (Astra)', file: 'rollout-2026-09-13T12-35-01-01a09943-05ae-7681-bb7f-fb7d87c96ef8.jsonl' },
  { slotId: 2, name: 'Coder (Gemini)', file: 'rollout-2026-09-13T12-35-01-01a09943-0642-71e0-9728-128c76c2b0c9.jsonl' },
  { slotId: 3, name: 'UI/UX Designer (Gemini)', file: 'rollout-2026-09-13T12-35-02-01a09943-070c-77b3-bbcf-40c5aae44cd7.jsonl' },
  { slotId: 4, name: 'QC (Grok 4.6)', file: 'rollout-2026-09-13T12-35-02-01a09943-084a-7473-896d-5bf106e7c3f7.jsonl' },
  { slotId: 5, name: 'Coder (Grok)', file: 'rollout-2026-09-13T12-35-02-01a09943-09b3-7a33-9a53-a7fece156bfd.jsonl' },
  { slotId: 6, name: 'Coder (Sol 5.6)', file: 'rollout-2026-09-13T12-35-03-01a09943-0b48-7302-a14b-880104258f01.jsonl' },
];

for (const item of files) {
  const content = fs.readFileSync(path.join(dir, item.file), 'utf-8');
  let lastToken: any = null;
  const lines = content.trim().split('\n');
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.payload?.type === 'token_count' && obj.payload.info?.total_token_usage) {
        lastToken = obj.payload.info.total_token_usage;
      }
    } catch {}
  }

  if (lastToken) {
    const hash = 'a'.repeat(60) + String(item.slotId).padStart(4, '0');
    const body = {
      id: item.slotId,
      agent_usage: {
        kind: 'tokens',
        stream: hash,
        totals: {
          input: lastToken.input_tokens,
          cached: lastToken.cached_input_tokens,
          output: lastToken.output_tokens,
        },
      },
      context_snapshot: `Đang thực thi nhiệm vụ (${lastToken.input_tokens.toLocaleString()} tokens)`
    };
    const res = await fetch('http://127.0.0.1:7899/slots/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    console.log(`Slot ${item.slotId} (${item.name}) -> ${lastToken.input_tokens} in, ${lastToken.cached_input_tokens} cached, ${lastToken.output_tokens} out -> HTTP ${res.status}`);
  }
}

