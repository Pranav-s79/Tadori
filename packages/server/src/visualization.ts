import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

export interface VisualizationRoutesOptions {
  /** Absolute path to the completed Vite build output. */
  distRoot: string;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function sendFile(
  reply: FastifyReply,
  root: string,
  relativePath: string,
  cacheControl: string
): Promise<FastifyReply> {
  const candidate = path.resolve(root, relativePath);
  if (!isWithin(root, candidate)) {
    return reply.code(404).send({ code: "not_found" });
  }

  let resolved: string;
  try {
    resolved = await realpath(candidate);
    if (!isWithin(root, resolved) || !(await stat(resolved)).isFile()) {
      return reply.code(404).send({ code: "not_found" });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return reply.code(404).send({ code: "not_found" });
    }
    throw error;
  }

  const contentType = CONTENT_TYPES[path.extname(resolved).toLowerCase()] ??
    "application/octet-stream";
  return reply
    .header("Cache-Control", cacheControl)
    .type(contentType)
    .send(await readFile(resolved));
}

/**
 * Serves the offline Vite application and its assets. Unknown UI locations
 * receive index.html for client-side routing; the API namespace never does.
 */
export async function registerVisualizationRoutes(
  app: FastifyInstance,
  options: VisualizationRoutesOptions
): Promise<void> {
  const root = await realpath(options.distRoot);
  const indexPath = path.join(root, "index.html");
  if (!(await stat(indexPath)).isFile()) {
    throw new Error(`Tadori visualization build is missing index.html in ${root}`);
  }
  const assetsRoot = path.join(root, "assets");

  app.get("/assets/*", async (request, reply) => {
    const asset = (request.params as { "*": string })["*"];
    return sendFile(reply, assetsRoot, asset, "public, max-age=31536000, immutable");
  });

  app.get("/*", async (request, reply) => {
    const requestPath = request.url.split("?", 1)[0] ?? request.url;
    if (requestPath === "/api/v1" || requestPath.startsWith("/api/v1/")) {
      return reply.code(404).send({ code: "not_found" });
    }
    return sendFile(reply, root, "index.html", "no-cache");
  });
}
