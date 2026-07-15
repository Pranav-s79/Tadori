import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "@tadori/store";
import { createMcpFixture } from "./setup.js";

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
const tsxCli = path.join(workspaceRoot, "node_modules", "tsx", "dist", "cli.mjs");
const mcpCli = path.join(workspaceRoot, "packages", "mcp", "src", "cli.ts");

let tempRoot: string;
let dbPath: string;

beforeEach(() => {
  tempRoot = mkdtempSync(path.join(tmpdir(), "tadori-mcp-stdio-"));
  dbPath = path.join(tempRoot, "tadori.db");
  const db = openDatabase(dbPath);
  runMigrations(db);
  const fixture = createMcpFixture(db, tempRoot);
  fixture.eventLog.endTask();
  db.close();
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function serverArguments(): string[] {
  return [tsxCli, mcpCli, "--db", dbPath, "--repo", tempRoot];
}

async function runClientSession(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: serverArguments(),
    cwd: workspaceRoot,
    stderr: "pipe"
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const client = new Client({ name: "stdio-contract-test", version: "0.1.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(6);
    const result = await client.callTool({ name: "repo_overview", arguments: {} });
    expect(result.isError).not.toBe(true);
  } finally {
    await client.close();
  }
  expect(stderr).toBe("");
}

describe("MCP stdio transport", () => {
  it("restarts cleanly and keeps stdout protocol-only", async () => {
    await runClientSession();
    await runClientSession();

    const db = openDatabase(dbPath);
    const rows = db
      .prepare(
        "SELECT status FROM tasks WHERE description = 'Tadori MCP stdio session' ORDER BY id"
      )
      .all() as Array<{ status: string }>;
    db.close();
    expect(rows).toEqual([{ status: "completed" }, { status: "completed" }]);
  });

  it("survives a malformed line and emits only valid JSON-RPC on stdout", async () => {
    const child = spawn(process.execPath, serverArguments(), {
      cwd: workspaceRoot,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.stdin.write("not-json\n");
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "malformed-line-test", version: "0.1.0" }
        }
      })}\n`
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("stdio initialize response timed out")), 10_000);
      const check = (): void => {
        if (stdout.includes("\n")) {
          clearTimeout(timeout);
          resolve();
        }
      };
      child.stdout.on("data", check);
      check();
    });
    child.stdin.end();
    const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual(
      expect.arrayContaining([expect.objectContaining({ jsonrpc: "2.0", id: 1 })])
    );
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
  });
});
