import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerVisualizationRoutes } from "../src/visualization.js";

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir !== null) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

function buildFixture(): string {
  tempDir = mkdtempSync(path.join(tmpdir(), "tadori-viz-routes-"));
  mkdirSync(path.join(tempDir, "assets"));
  writeFileSync(path.join(tempDir, "index.html"), "<!doctype html><title>Tadori</title>");
  writeFileSync(path.join(tempDir, "assets", "app.js"), "globalThis.tadori = true;");
  return tempDir;
}

describe("visualization routes", () => {
  it("serves the built entry point, immutable assets, and SPA locations", async () => {
    const app = Fastify();
    await registerVisualizationRoutes(app, { distRoot: buildFixture() });

    const root = await app.inject({ method: "GET", url: "/" });
    expect(root.statusCode).toBe(200);
    expect(root.headers["content-type"]).toContain("text/html");
    expect(root.headers["cache-control"]).toBe("no-cache");
    expect(root.body).toContain("<title>Tadori</title>");

    const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toContain("text/javascript");
    expect(asset.headers["cache-control"]).toContain("immutable");
    expect(asset.body).toContain("globalThis.tadori");

    const spa = await app.inject({ method: "GET", url: "/review/42" });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain("<title>Tadori</title>");

    await app.close();
  });

  it("does not turn unknown API or asset paths into the SPA", async () => {
    const app = Fastify();
    await registerVisualizationRoutes(app, { distRoot: buildFixture() });

    const api = await app.inject({ method: "GET", url: "/api/v1/not-a-route" });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ code: "not_found" });

    const asset = await app.inject({ method: "GET", url: "/assets/missing.js" });
    expect(asset.statusCode).toBe(404);
    expect(asset.json()).toEqual({ code: "not_found" });

    await app.close();
  });
});
