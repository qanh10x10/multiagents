import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeDriver, UnsupportedDriverOperationError } from "../orchestrator/claude-driver.ts";

let dir = "";
let fixture = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "claude-driver-"));
  fixture = join(dir, "fixture.js");
  writeFileSync(fixture, [
    "const rl=require('node:readline').createInterface({input:process.stdin});",
    "rl.on('line',l=>{const f=JSON.parse(l);",
    "if(f.type==='user'){const a=JSON.stringify({type:'assistant',session_id:'s1',turn_id:'t1',delta:'hel'})+'\\n';process.stdout.write(a.slice(0,7));setTimeout(()=>process.stdout.write(a.slice(7)),2);",
    "setTimeout(()=>process.stdout.write(JSON.stringify({type:'assistant',session_id:'s1',turn_id:'t1',delta:'lo'})+'\\n'),5);",
    "setTimeout(()=>process.stdout.write(JSON.stringify({type:'result',session_id:'s1',turn_id:'t1',result:'hello',usage:{input_tokens:3,output_tokens:2}})+'\\n'),10);}});",
  ].join(""));
});
afterAll(async () => {
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {
      await new Promise(r => setTimeout(r, 100));
    }
  }
});

test("ClaudeDriver parses chunked JSONL, emits notifications, normalizes usage", async () => {
  const d = await ClaudeDriver.spawn(dir, process.env, 1000, { command: process.execPath, args: [fixture] });
  const methods: string[] = [];
  d.onNotification((n) => methods.push(n.method));
  const result = await d.startSession({ prompt: "hi" });
  expect(result).toEqual({ threadId: "s1", content: "hello", usage: { input_tokens: 3, output_tokens: 2, cached_input_tokens: undefined } });
  expect(methods).toContain("item/agentMessage/delta");
  expect(methods).toContain("turn/completed");
  await d.kill();
});

test("ClaudeDriver rejects unsupported negotiated operations", async () => {
  const d = await ClaudeDriver.spawn(dir, process.env, 1000, { command: process.execPath, args: [fixture] });
  await expect(d.steer("s1", "x")).rejects.toBeInstanceOf(UnsupportedDriverOperationError);
  await expect(d.interrupt("s1")).rejects.toBeInstanceOf(UnsupportedDriverOperationError);
  await expect(d.resumeThread("s1")).rejects.toBeInstanceOf(UnsupportedDriverOperationError);
  await d.kill();
});

test("ClaudeDriver rejects malformed JSONL protocol frames", async () => {
  const bad = join(dir, "bad.js");
  writeFileSync(bad, "process.stdin.once('data',()=>{process.stdout.write('not-json\\n');process.exit(0);});");
  const d = await ClaudeDriver.spawn(dir, process.env, 1000, { command: process.execPath, args: [bad] });
  await expect(d.startSession({ prompt: "x" })).rejects.toThrow("Malformed Claude JSONL frame");
  await d.kill();
});

test("ClaudeDriver uses configured timeout and clears pending turn", async () => {
  const slow = join(dir, "slow.js");
  writeFileSync(slow, [
    "let n=0;const rl=require('node:readline').createInterface({input:process.stdin});",
    "rl.on('line',()=>{n++;if(n===2)process.stdout.write(JSON.stringify({type:'result',session_id:'s2',turn_id:'t2',result:'ok'})+'\\n');});",
  ].join(""));
  const d = await ClaudeDriver.spawn(dir, process.env, 25, { command: process.execPath, args: [slow] });
  await expect(d.startSession({ prompt: "timeout" })).rejects.toThrow("Claude turn timed out after 25ms");
  await expect(d.startSession({ prompt: "after timeout" })).resolves.toMatchObject({ threadId: "s2", content: "ok" });
  await d.kill();
});

test("ClaudeDriver handles immediate result and propagates instructions", async () => {
  const fast = join(dir, "fast.js");
  writeFileSync(fast, [
    "let seen='';const rl=require('node:readline').createInterface({input:process.stdin});",
    "rl.on('line',l=>{const f=JSON.parse(l);seen=f.message.content[0].text;",
    "process.stdout.write(JSON.stringify({type:'result',session_id:'s3',turn_id:'t3',result:seen})+'\\n');});",
  ].join(""));
  const d = await ClaudeDriver.spawn(dir, process.env, 1000, { command: process.execPath, args: [fast] });
  await expect(d.startSession({ prompt: "body", baseInstructions: "base", developerInstructions: "dev" }))
    .resolves.toMatchObject({ threadId: "s3", content: "base\n\ndev\n\nbody" });
  await d.kill();
});
