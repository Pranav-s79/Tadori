import { CAPABILITY_FEATURES, type CapabilityMatrix } from "@tadori/core";
import { CAPABILITY_MATRIX } from "@tadori/indexer";
import { ConcurrentRefreshController } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createServerApp } from "../src/app.js";
import { buildTestDb, cleanupTestDb, type TestDb } from "./fixtures/buildTestDb.js";

let testDb: TestDb | null = null;
let refresh: ConcurrentRefreshController | null = null;
let app: FastifyInstance | null = null;

afterEach(async () => {
  if (app !== null) await app.close();
  if (refresh !== null) await refresh.stop();
  if (testDb !== null) cleanupTestDb(testDb);
  app = null;
  refresh = null;
  testDb = null;
});

describe("GET /api/v1/capabilities", () => {
  it("serves the validated matrix verbatim with every declared feature", async () => {
    testDb = buildTestDb();
    refresh = await ConcurrentRefreshController.start(testDb.db, testDb.repoRoot);
    app = await createServerApp({ db: testDb.db, repoRoot: testDb.repoRoot, refresh });
    const response = await app.inject({ method: "GET", url: "/api/v1/capabilities" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as CapabilityMatrix;
    expect(body).toEqual(CAPABILITY_MATRIX);
    expect(body.languages.map((language) => language.id)).toEqual(expect.arrayContaining([
      "typescript", "javascript", "python", "c", "cpp", "go", "rust", "java",
      "protobuf", "json", "yaml", "markdown", "dockerfile", "terraform", "toml",
      "shell", "cmake", "repository-config", "unknown"
    ]));
    expect(body.languages.every((language) =>
      Object.keys(language.features).length === CAPABILITY_FEATURES.length
    )).toBe(true);
    const schemaResponse = await app.inject({
      method: "GET",
      url: "/api/v1/multilanguage-capabilities.schema.json"
    });
    expect(schemaResponse.statusCode).toBe(200);
    expect(schemaResponse.json()).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object"
    });
  });
});
