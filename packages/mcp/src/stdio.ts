import type { Readable, Writable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Database } from "@tadori/store";
import { ConcurrentRefreshController } from "./concurrentRefresh.js";
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
  const refresh = await ConcurrentRefreshController.start(options.db, options.repoRoot, {
    onError: (error) => process.stderr.write(`Tadori refresh worker failed: ${error.message}\n`)
  });
  let server: ReturnType<typeof createTadoriMcpServer> | null = null;
  let eventLog: EventLog | null = null;
  try {
    const service = GraphService.open(options.db, options.repoRoot, refresh, "working_tree");
    eventLog = new EventLog(
      options.db,
      service,
      options.agent ?? "mcp-client",
      options.description ?? "Tadori MCP stdio session"
    );
    server = createTadoriMcpServer(new TadoriTools(service, eventLog));
    const transport = new StdioServerTransport(options.stdin, options.stdout);
    await server.connect(transport);
  } catch (error) {
    const failures: unknown[] = [error];
    try {
      eventLog?.endTask("aborted");
    } catch (taskError) {
      failures.push(taskError);
    }
    try {
      await server?.close();
    } catch (closeError) {
      failures.push(closeError);
    }
    try {
      await refresh.stop();
    } catch (stopError) {
      failures.push(stopError);
    }
    if (failures.length === 1) {
      throw error;
    }
    throw new AggregateError(failures, "MCP startup and cleanup both failed");
  }
  if (!server || !eventLog) {
    throw new Error("MCP startup completed without initialized runtime components");
  }
  let taskEnded = false;
  let serverClosed = false;
  let closePromise: Promise<void> | null = null;
  const finalize = (status: "completed" | "aborted" = "completed"): void => {
    if (!taskEnded) {
      taskEnded = true;
      eventLog.endTask(status);
    }
  };
  return {
    finalize,
    close(status = "completed"): Promise<void> {
      closePromise ??= (async (): Promise<void> => {
        const failures: unknown[] = [];
        try {
          finalize(status);
        } catch (error) {
          failures.push(error);
        }
        if (!serverClosed) {
          serverClosed = true;
          try {
            await server.close();
          } catch (error) {
            failures.push(error);
          }
        }
        try {
          await refresh.stop();
        } catch (error) {
          failures.push(error);
        }
        if (failures.length === 1) {
          throw failures[0];
        }
        if (failures.length > 1) {
          throw new AggregateError(failures, "MCP shutdown encountered multiple failures");
        }
      })();
      return closePromise;
    }
  };
}
