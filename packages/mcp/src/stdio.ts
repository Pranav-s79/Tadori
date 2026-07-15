import type { Readable, Writable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Database } from "@tadori/store";
import { EventLog } from "./events.js";
import { createTadoriMcpServer } from "./server.js";
import { GraphService } from "./service.js";
import { TadoriTools } from "./tools.js";

export interface StdioServerOptions {
  db: Database;
  repoRoot: string;
  stdin?: Readable;
  stdout?: Writable;
  agent?: string;
  description?: string;
}

export interface RunningStdioServer {
  finalize(status?: "completed" | "aborted"): void;
  close(status?: "completed" | "aborted"): Promise<void>;
}

export async function startStdioServer(options: StdioServerOptions): Promise<RunningStdioServer> {
  const service = GraphService.open(options.db, options.repoRoot);
  const eventLog = new EventLog(
    options.db,
    service,
    options.agent ?? "mcp-client",
    options.description ?? "Tadori MCP stdio session"
  );
  const server = createTadoriMcpServer(new TadoriTools(service, eventLog));
  const transport = new StdioServerTransport(options.stdin, options.stdout);
  await server.connect(transport);
  let taskEnded = false;
  let serverClosed = false;
  const finalize = (status: "completed" | "aborted" = "completed"): void => {
    if (!taskEnded) {
      taskEnded = true;
      eventLog.endTask(status);
    }
  };
  return {
    finalize,
    async close(status = "completed"): Promise<void> {
      finalize(status);
      if (serverClosed) {
        return;
      }
      serverClosed = true;
      await server.close();
    }
  };
}
