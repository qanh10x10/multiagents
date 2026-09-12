import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AntigravityDriver, UnsupportedDriverOperationError } from "../orchestrator/antigravity-driver.ts";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "antigravity-driver-"));
});
afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

function profile(command: string, args: string[] = []) {
  return {
    command, args,
    handshake: { method: "initialize" },
    methodMap: { start: "generateContent", reply: "generateContent" },
    usagePaths: { input: "usage.promptTokenCount", output: "usage.candidatesTokenCount", cached: "usage.cachedContentTokenCount" },
    requestTimeoutMs: 500,
  };
}

test("Antigravity correlates native JSON-RPC responses and usage", async () => {
  const f = join(dir, "ok.js");
  writeFileSync(f, "const r=require('node:readline').createInterface({input:process.stdin});r.on('line',l=>{const x=JSON.parse(l);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:x.id,result:x.method==='initialize'?{}:{threadId:'g1',content:'ok',usage:{promptTokenCount:4,candidatesTokenCount:2}}})+'\\n')});");
  const d = await AntigravityDriver.spawn(dir, process.env, profile("node", [f]));
  const result = await d.startSession({ prompt: "x" });
  expect(result).toEqual({ threadId: "g1", content: "ok", usage: { input_tokens: 4, output_tokens: 2, cached_input_tokens: undefined } });
  await d.kill();
});

test("Antigravity emits no Codex wrapper methods or fields", async () => {
  const f = join(dir, "capture.js");
  const out = join(dir, "capture.txt");
  writeFileSync(f, `const fs=require('node:fs');const r=require('node:readline').createInterface({input:process.stdin});r.on('line',l=>{fs.appendFileSync(${JSON.stringify(out)},l+'\\n');const x=JSON.parse(l);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:x.id,result:x.method==='initialize'?{}:{threadId:'g2',content:'ok'}})+'\\n')});`);
  const d = await AntigravityDriver.spawn(dir, process.env, profile("node", [f]));
  await d.startSession({ prompt: "x" });
  const sent = await Bun.file(out).text();
  expect(sent).toContain('"method":"generateContent"');
  expect(sent).not.toContain("turn/start");
  expect(sent).not.toContain("expectedTurnId");
  await d.kill();
});

test("Antigravity rejects malformed handshake frames", async () => {
  const f = join(dir, "bad.js");
  writeFileSync(f, "process.stdin.once('data',()=>{process.stdout.write('bad\\n');process.exit(0)})");
  const d = await AntigravityDriver.spawn(dir, process.env, profile("node", [f])).catch(() => null);
  expect(d).toBeNull();
});

test("Antigravity handles rpc errors, unknown ids, timeouts, oversize frames, unsupported ops", async () => {
  const slow = join(dir, "slow-ag.js");
  writeFileSync(slow, "const r=require('node:readline').createInterface({input:process.stdin});let n=0;r.on('line',l=>{const x=JSON.parse(l);if(n++===0)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:x.id,result:{}})+String.fromCharCode(10))});");
  const s = await AntigravityDriver.spawn(dir, process.env, { ...profile("node", [slow]), requestTimeoutMs: 100 });
  await expect(s.startSession({ prompt: "x" })).rejects.toThrow("Request generateContent timed out");
  await s.kill();

});
