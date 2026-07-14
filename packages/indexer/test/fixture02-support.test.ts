import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { GraphNode } from "@tadori/core";
import { indexRepository, type IndexResult } from "@tadori/indexer";

const FIXTURE_ROOT = path.resolve(__dirname, "../../fixtures/02-express-routes/repo");

let result: IndexResult;
let nodeByKey: Map<string, GraphNode>;

beforeAll(() => {
  result = indexRepository(FIXTURE_ROOT, { kind: "commit" });
  nodeByKey = new Map(result.graph.nodes.map((n) => [n.entityKey, n]));
});

describe("fixture 02 support files and external deps", () => {
  it("treats the express .d.ts shim as a support file, not a graph file node", () => {
    expect(
      result.scan.supportFiles.map((f) => f.normalizedPath)
    ).toContain("types/express.d.ts");
    expect(result.graph.files.map((f) => f.normalizedPath)).not.toContain(
      "types/express.d.ts"
    );
    expect(
      result.graph.nodes.some((n) => n.qualifiedName === "types/express.d.ts")
    ).toBe(false);
  });

  it("still resolves express through the shim to an external_dep node", () => {
    const external = result.graph.nodes.filter((n) => n.kind === "external_dep");
    expect(external.map((n) => n.qualifiedName)).toEqual(["npm:express"]);
    expect(external[0]?.displayName).toBe("express");
    expect(external[0]?.file).toBeNull();

    const importsToExpress = result.graph.edges.filter(
      (e) =>
        e.relation === "imports" &&
        nodeByKey.get(e.dstEntityKey)?.qualifiedName === "npm:express"
    );
    const sources = importsToExpress
      .map((e) => nodeByKey.get(e.srcEntityKey)?.qualifiedName)
      .sort();
    expect(sources).toEqual([
      "src/app.ts",
      "src/controllers/admin-controller.ts",
      "src/controllers/user-controller.ts",
      "src/routes/admin.ts",
      "src/routes/users.ts"
    ]);
  });

  it("extracts function-valued class properties as method nodes", () => {
    const getUser = result.graph.nodes.find(
      (n) => n.qualifiedName === "src/controllers/user-controller.ts.UserController.getUser"
    );
    expect(getUser?.kind).toBe("method");
    expect(getUser?.lineStart).toBe(8);
  });

  it("excludes exported router/app variables from nodes and exports edges", () => {
    expect(result.graph.nodes.some((n) => n.displayName === "usersRouter")).toBe(false);
    expect(result.graph.nodes.some((n) => n.displayName === "app")).toBe(false);
    // The exclusions are reported, never silent.
    const reported = result.diagnostics.map((d) => d.message).join("\n");
    expect(reported).toContain("usersRouter");
    expect(reported).toContain("app");
  });
});
