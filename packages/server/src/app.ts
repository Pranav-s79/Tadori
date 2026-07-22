import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { ConcurrentRefreshController } from "@tadori/mcp";
import type { Database } from "@tadori/store";
import { GraphState } from "./graphState.js";
import { registerDerivedRoutes } from "./routes/derived.js";
import { registerGraphRoutes } from "./routes/graph.js";
import { registerLayoutRoutes } from "./routes/layout.js";
import { registerObservationRoutes } from "./routes/observations.js";
import { registerPathRoutes } from "./routes/path.js";
import { registerRefreshRoutes } from "./routes/refresh.js";
import { registerReviewRoutes } from "./routes/review.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerSnapshotRoutes } from "./routes/snapshots.js";
import { registerSourceRoutes } from "./routes/source.js";
import { registerStoryRoutes } from "./routes/story.js";
import { registerWebSocket } from "./ws.js";

export interface ServerAppOptions {
  /** @tadori/store Database, already migrated. */
  db: Database;
  /** Absolute path, already resolved. */
  repoRoot: string;
  /** Caller-owned lifecycle (07-02 owns start/stop). */
  refresh: ConcurrentRefreshController;
  /** Optional immutable snapshot selection for `tadori serve --snapshot`. */
  snapshotId?: number;
}

declare module "fastify" {
  interface FastifyInstance {
    graphState: GraphState;
  }
}

/**
 * Builds the Fastify instance, registers @fastify/websocket, registers all
 * route modules. Never calls `.listen()` — that is the caller's job (07-02
 * and this package's own tests both call `.listen()`/`.inject()` on the
 * returned instance).
 */
export async function createServerApp(options: ServerAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const graphState = new GraphState({
    db: options.db,
    repoRoot: options.repoRoot,
    refresh: options.refresh,
    ...(options.snapshotId === undefined ? {} : { snapshotId: options.snapshotId })
  });
  app.decorate("graphState", graphState);
  app.addHook("onClose", async () => {
    await graphState.close();
  });

  await app.register(fastifyWebsocket);

  await app.register(registerSnapshotRoutes, { prefix: "/api/v1" });
  await app.register(registerGraphRoutes, { prefix: "/api/v1" });
  await app.register(registerSourceRoutes, { prefix: "/api/v1" });
  await app.register(registerSearchRoutes, { prefix: "/api/v1" });
  await app.register(registerPathRoutes, { prefix: "/api/v1" });
  await app.register(registerDerivedRoutes, { prefix: "/api/v1" });
  await app.register(registerRefreshRoutes, { prefix: "/api/v1" });
  await app.register(registerLayoutRoutes, { prefix: "/api/v1" });
  await app.register(registerReviewRoutes, { prefix: "/api/v1" });
  await app.register(registerStoryRoutes, { prefix: "/api/v1" });
  await app.register(registerObservationRoutes, { prefix: "/api/v1" });
  await app.register(registerWebSocket, { prefix: "/api/v1" });

  return app;
}
