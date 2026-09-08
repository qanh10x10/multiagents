import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("broker persists immutable selection across snapshots/restarts and migrates existing slots", async () => {
  const directory = mkdtempSync(join(tmpdir(), "multiagents-model-db-"));
  const dbPath = join(directory, "broker.db");
  const reservation = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("test") });
  const port = reservation.port;
  reservation.stop(true);
  let proc: import("bun").Subprocess | undefined;
  async function start() {
    proc = Bun.spawn([process.execPath, fileURLToPath(new URL("../broker.ts", import.meta.url))], {
      env: { ...process.env, MULTIAGENTS_DB: dbPath, MULTIAGENTS_PORT: String(port) },
      stdin: "ignore", stdout: "ignore", stderr: "pipe",
    });
    const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
    const first = await reader.read();
    reader.releaseLock();
    expect(new TextDecoder().decode(first.value)).toContain("listening on");
  }
  async function stop() { proc?.kill(); await proc?.exited; proc = undefined; }
  async function post(endpoint: string, body: unknown) {
    const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any };
  }
  try {
    await start();
    await post("/sessions/create", { id: "persist", name: "Persistence", project_dir: directory });
    const selection = { provider: "Fixture", model: "one", catalog_path: join(directory, "models.json") };
    const created = await post("/slots/create", { session_id: "persist", agent_type: "codex", model_selection: selection });
    expect(created.status).toBe(200);
    expect(created.body.model_selection).toEqual(selection);
    const id = created.body.id;
    const legacy = await post("/slots/create", { session_id: "persist", agent_type: "claude" });
    expect(legacy.body.model_selection).toBeNull();
    await post("/slots/update", { id, context_snapshot: JSON.stringify({ codex_thread_id: "resume-this-thread", last_summary: "bootstrap" }) });
    await post("/slots/update", { id, context_snapshot: JSON.stringify({ last_summary: "overwritten" }), status: "disconnected" });
    expect(JSON.parse((await post("/slots/get", { id })).body.context_snapshot)).toEqual({ codex_thread_id: "resume-this-thread", last_summary: "overwritten" });
    expect((await post("/slots/get", { id })).body.model_selection).toEqual(selection);
    for (const invalid of [
      { ...selection, apiKey: "must-not-persist" },
      { ...selection, env: { KEY: "must-not-persist" } },
      { ...selection, catalog_path: "relative.json" },
      { ...selection, provider: 42 },
    ]) {
      const rejected = await post("/slots/create", { session_id: "persist", agent_type: "codex", model_selection: invalid });
      expect(rejected.status).not.toBe(200);
      expect(JSON.stringify(rejected.body)).not.toContain("must-not-persist");
    }
    expect((await post("/slots/create", { session_id: "persist", agent_type: "claude", model_selection: selection })).status).not.toBe(200);
    expect((await post("/slots/update", { id, model_selection: null })).status).not.toBe(200);
    expect((await post("/slots/list", { session_id: "persist" })).body).toHaveLength(2);
    // Startup runs production dead-peer cleanup before serving requests.
    const deadPeer = await post("/register", { session_id: "persist", slot_id: id, agent_type: "codex", cwd: directory, pid: 2147483647, git_root: null, tty: null, summary: "Offline fixture" });
    expect(deadPeer.status).toBe(200);
    await stop();
    const stored = new Database(dbPath);
    expect((stored.query("SELECT model_selection FROM slots WHERE id = ?").get(id) as any).model_selection).toBe(JSON.stringify(selection));
    stored.close();
    await start();
    const cleaned = (await post("/slots/get", { id })).body;
    expect(cleaned.status).toBe("disconnected");
    expect(cleaned.peer_id).toBeNull();
    expect(JSON.parse(cleaned.context_snapshot).codex_thread_id).toBe("resume-this-thread");
    expect((await post("/slots/get", { id })).body.model_selection).toEqual(selection);
    expect((await post("/slots/list", { session_id: "persist" })).body[0].model_selection).toEqual(selection);
    await stop();
    // Emulate the prior schema only in this disposable DB; verify additive upgrade retains old rows.
    const old = new Database(dbPath);
    old.run("ALTER TABLE slots DROP COLUMN model_selection");
    old.close();
    await start();
    expect((await post("/slots/list", { session_id: "persist" })).body).toHaveLength(2);
    expect((await post("/slots/get", { id })).body.model_selection).toBeNull();
    expect((await post("/slots/create", { session_id: "persist", agent_type: "codex", model_selection: selection })).body.model_selection).toEqual(selection);
  } finally {
    await stop();
    rmSync(directory, { recursive: true, force: true });
  }
}, 15000);