import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import type { TeamConfig } from "../shared/types.ts";

// A run keeps its orchestrator alive: closing the transport would stop its workers.
export class DashboardOrchestratorClient {
  private clients: Array<{ client: Client; transport: StdioClientTransport }> = [];

  async createTeam(config: TeamConfig, environment: Record<string, string | undefined>): Promise<unknown> {
    const env = Object.fromEntries(Object.entries(environment).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    const client = new Client({ name: "multiagents-studio", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("../orchestrator/orchestrator-server.ts", import.meta.url))],
      cwd: config.project_dir,
      env,
      stderr: "ignore",
    });
    try {
      await client.connect(transport, { timeout: 15_000 });
      this.clients.push({ client, transport });
      const result = await client.callTool({ name: "create_team", arguments: { ...config } }, undefined, { timeout: 300_000 });
      if (result.isError) throw new Error("Orchestrator rejected the run. Check the session monitor before retrying.");
      return result;
    } catch {
      // A request timeout may follow a partial launch. Do not kill workers or retry it automatically.
      if (!this.clients.some(entry => entry.client === client)) {
        await client.close().catch(() => {});
        await transport.close().catch(() => {});
      }
      throw new Error("Run result unavailable. Check the session monitor before starting another run.");
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.clients.map(async ({ client, transport }) => {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
    }));
    this.clients = [];
  }
}
