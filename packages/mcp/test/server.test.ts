import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations, type Database } from "@tadori/store";
import { TOOL_NAMES } from "../src/contracts.js";
import { createTadoriMcpServer } from "../src/server.js";
import { createMcpFixture, type McpFixture } from "./setup.js";

let db: Database;
let tempRoot: string;
let fixture: McpFixture;
let server: McpServer | null;
let client: Client | null;

beforeEach(() => {
  db = openDatabase(":memory:");
  runMigrations(db);
  tempRoot = mkdtempSync(path.join(tmpdir(), "tadori-mcp-server-"));
  fixture = createMcpFixture(db, tempRoot);
  server = null;
  client = null;
});

afterEach(async () => {
  await client?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
  db.close();
  rmSync(tempRoot, { recursive: true, force: true });
});

async function connect(): Promise<Client> {
  server = createTadoriMcpServer(fixture.tools);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "tadori-test", version: "0.1.0" });
  await client.connect(clientTransport);
  return client;
}

describe("Tadori MCP server", () => {
  it("publishes exactly six strict tools", async () => {
    const connected = await connect();
    const listed = await connected.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
    for (const tool of listed.tools) {
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      if (tool.name !== "repo_overview") {
        expect(tool.inputSchema).toMatchObject({ additionalProperties: false });
      }
      expect(tool.outputSchema).toMatchObject({ type: "object", additionalProperties: false });
    }
  });

  it("returns validated structured content and records all six valid calls", async () => {
    const connected = await connect();
    const calls = [
      { name: "repo_overview", arguments: {} },
      { name: "find_symbol", arguments: { query: "target", limit: 10 } },
      {
        name: "symbol_context",
        arguments: {
          anchor: fixture.nodes.target.entityKey,
          relations: ["calls"],
          depth: 1,
          tokenBudget: 5_000
        }
      },
      { name: "find_tests", arguments: { target: fixture.nodes.target.entityKey } },
      { name: "impact", arguments: { targets: [fixture.nodes.target.entityKey], depth: 1 } },
      {
        name: "path",
        arguments: {
          from: fixture.nodes.caller.entityKey,
          to: fixture.nodes.target.entityKey,
          relations: ["calls"],
          k: 1
        }
      }
    ];
    for (const call of calls) {
      const response = await connected.callTool(call);
      expect(response.isError).not.toBe(true);
      expect(response.structuredContent).toMatchObject({
        context: { snapshotId: fixture.service.snapshot.id }
      });
      expect(response.content).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "text" })])
      );
    }
    const count = db.prepare("SELECT COUNT(*) AS count FROM retrieval_events").get() as {
      count: number;
    };
    expect(count.count).toBe(6);
  });

  it("rejects unknown properties without invoking or logging a handler", async () => {
    const connected = await connect();
    const response = await connected.callTool({
      name: "find_symbol",
      arguments: { query: "target", unexpected: true }
    });
    expect(response.isError).toBe(true);
    expect(response.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text" })])
    );
    const emptyInputResponse = await connected.callTool({
      name: "repo_overview",
      arguments: { unexpected: true }
    });
    expect(emptyInputResponse.isError).toBe(true);
    const count = db.prepare("SELECT COUNT(*) AS count FROM retrieval_events").get() as {
      count: number;
    };
    expect(count.count).toBe(0);
  });
});
