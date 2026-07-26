import { afterEach, describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "@tadori/core";
import { sha256Hex } from "@tadori/core";
import { ConcurrentRefreshController } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import type { ToolNode } from "@tadori/mcp";
import { createServerApp } from "../src/app.js";
import { selectLodScope } from "../src/lodScope.js";
import { getPackageProjection } from "../src/packageProjection.js";
import type { Page } from "../src/types.js";
import { buildTestDb, cleanupTestDb, type TestDb } from "./fixtures/buildTestDb.js";

let testDb: TestDb | null = null;
let refresh: ConcurrentRefreshController | null = null;
let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
  await refresh?.stop();
  refresh = null;
  if (testDb) cleanupTestDb(testDb);
  testDb = null;
});

async function setup(): Promise<FastifyInstance> {
  testDb = buildTestDb();
  refresh = await ConcurrentRefreshController.start(testDb.db, testDb.repoRoot);
  app = await createServerApp({ db: testDb.db, repoRoot: testDb.repoRoot, refresh });
  return app;
}

describe("authoritative server LOD response caps", () => {
  it("clamps oversized package, file, symbol, and edge requests with explicit omission accounting", async () => {
    const instance = await setup();
    const service = instance.graphState.current();
    const packageTemplate = service.graph.nodes.find((node) => node.kind === "package");
    const fileTemplate = service.graph.nodes.find((node) => node.kind === "file");
    const symbolTemplate = service.graph.nodes.find((node) => node.kind !== "package" && node.kind !== "file");
    const edgeTemplate = service.graph.edges[0];
    expect(packageTemplate).toBeDefined();
    expect(fileTemplate).toBeDefined();
    expect(symbolTemplate).toBeDefined();
    expect(edgeTemplate).toBeDefined();

    for (let index = 0; index < 550; index += 1) {
      const key = sha256Hex(`large-package-${String(index)}`);
      const synthetic: GraphNode = {
        ...packageTemplate!,
        qualifiedName: `large-package-${String(index)}`,
        displayName: `large-package-${String(index)}`,
        canonicalIdentity: `node|package|large-package-${String(index)}`,
        entityKey: key
      };
      service.graph.nodes.push(synthetic);
      service.nodesByKey.set(key, synthetic);
    }
    const sortedPackages = service.graph.nodes
      .filter((node) => node.kind === "package")
      .sort((left, right) => left.entityKey.localeCompare(right.entityKey));
    const insideA = sortedPackages[0]!;
    const insideB = sortedPackages[1]!;
    const outside = sortedPackages[500]!;
    const insideEdgeKey = sha256Hex("large-package-edge-inside");
    const outsideEdgeKey = sha256Hex("large-package-edge-outside");
    const insideEdgeSecondKey = sha256Hex("large-package-edge-inside-second");
    service.graph.edges.push({
      ...edgeTemplate!,
      canonicalIdentity: "edge|large-package-inside",
      entityKey: insideEdgeKey,
      relation: "imports",
      srcEntityKey: insideA.entityKey,
      dstEntityKey: insideB.entityKey
    }, {
      ...edgeTemplate!,
      canonicalIdentity: "edge|large-package-outside",
      entityKey: outsideEdgeKey,
      relation: "imports",
      srcEntityKey: insideA.entityKey,
      dstEntityKey: outside.entityKey
    }, {
      ...edgeTemplate!,
      canonicalIdentity: "edge|large-package-inside-second",
      entityKey: insideEdgeSecondKey,
      relation: "imports",
      srcEntityKey: insideA.entityKey,
      dstEntityKey: insideB.entityKey,
      origin: "heuristic",
      confidence: "likely",
      language: "python",
      provenance: {
        extractorId: "test-python",
        extractorVersion: "1",
        capability: "structural",
        derivation: "parser-derived",
        unresolvedReason: null
      }
    });
    for (let index = 0; index < 1_050; index += 1) {
      const key = sha256Hex(`large-symbol-${String(index)}`);
      const synthetic: GraphNode = {
        ...symbolTemplate!,
        qualifiedName: `large.symbol.${String(index)}`,
        displayName: `symbol${String(index)}`,
        canonicalIdentity: `node|function|large.symbol.${String(index)}`,
        entityKey: key
      };
      service.graph.nodes.push(synthetic);
      service.nodesByKey.set(key, synthetic);
      const edgeKey = sha256Hex(`large-edge-${String(index)}`);
      const syntheticEdge: GraphEdge = {
        ...edgeTemplate!,
        canonicalIdentity: `edge|large-${String(index)}`,
        entityKey: edgeKey
      };
      service.graph.edges.push(syntheticEdge);
    }
    for (let index = 0; index < 550; index += 1) {
      const key = sha256Hex(`large-file-${String(index)}`);
      const synthetic: GraphNode = {
        ...fileTemplate!,
        qualifiedName: `src/large-${String(index)}.ts`,
        displayName: `large-${String(index)}.ts`,
        canonicalIdentity: `node|file|src/large-${String(index)}.ts`,
        entityKey: key,
        file: `src/large-${String(index)}.ts`
      };
      service.graph.nodes.push(synthetic);
      service.nodesByKey.set(key, synthetic);
    }
    const fileEndpoints = service.graph.nodes.filter((node) => node.kind === "file")
      .sort((left, right) => left.entityKey.localeCompare(right.entityKey));
    for (let index = 0; index < 1_050; index += 1) {
      const entityKey = sha256Hex(`large-file-edge-${String(index)}`);
      service.graph.edges.push({
        ...edgeTemplate!,
        canonicalIdentity: `edge|large-file-${String(index)}`,
        entityKey,
        relation: "imports",
        srcEntityKey: fileEndpoints[0]!.entityKey,
        dstEntityKey: fileEndpoints[1]!.entityKey
      });
    }

    const packageResponse = await instance.inject({
      method: "GET",
      url: "/api/v1/nodes?level=package&limit=9999"
    });
    expect(packageResponse.statusCode).toBe(200);
    const packages = packageResponse.json() as Page<unknown>;
    expect(packages.items).toHaveLength(500);
    expect(packages.total).toBe(551);
    expect(packages.omittedCount).toBe(51);
    expect(packages.nextCursor).toBeNull();

    const packageEdgesResponse = await instance.inject({
      method: "GET",
      url: "/api/v1/edges?level=package&relation=imports&limit=9999"
    });
    const packageEdges = packageEdgesResponse.json() as Page<{
      entityKey: string;
      srcEntityKey: string;
      dstEntityKey: string;
      aggregateCount: number;
      aggregateProvenance: Array<{ origin: string; confidence: string; count: number }>;
      aggregateLanguages: string[];
      aggregateCapabilities: string[];
      sourceEdgeCount: number;
      sourceEdgeOmittedCount: number;
      evidenceOmittedCount: number;
    }>;
    const visiblePackageKeys = new Set((packages.items as ToolNode[]).map((node) => node.entityKey));
    expect(packageEdges.items.some((edge) =>
      edge.srcEntityKey === insideA.entityKey && edge.dstEntityKey === insideB.entityKey
      && edge.aggregateCount === 2 && edge.aggregateProvenance.length === 2
      && edge.aggregateLanguages.includes("python")
      && edge.aggregateCapabilities.includes("structural")
    )).toBe(true);
    const aggregate = packageEdges.items.find((edge) =>
      edge.srcEntityKey === insideA.entityKey && edge.dstEntityKey === insideB.entityKey)!;
    expect(aggregate).not.toHaveProperty("origin");
    expect(aggregate).not.toHaveProperty("confidence");
    expect(aggregate).not.toHaveProperty("resolution");
    expect(aggregate).not.toHaveProperty("provenance");
    expect(aggregate).not.toHaveProperty("evidence");
    expect(aggregate.sourceEdgeCount).toBe(2);
    expect(aggregate.sourceEdgeOmittedCount).toBe(0);
    expect(packageEdges.items.some((edge) => edge.dstEntityKey === outside.entityKey)).toBe(false);
    expect(packageEdges.items.every((edge) =>
      visiblePackageKeys.has(edge.srcEntityKey) && visiblePackageKeys.has(edge.dstEntityKey)
    )).toBe(true);
    expect(packageEdges.scope?.omittedEdgeCount).toBeGreaterThanOrEqual(1);
    expect(packageEdges.omittedCount).toBeGreaterThanOrEqual(1);

    const filteredPackageEdgesResponse = await instance.inject({
      method: "GET",
      url: "/api/v1/edges?level=package&relation=imports&origin=heuristic&limit=9999"
    });
    const filteredAggregate = (filteredPackageEdgesResponse.json() as typeof packageEdges).items.find((edge) =>
      edge.srcEntityKey === insideA.entityKey && edge.dstEntityKey === insideB.entityKey)!;
    expect(filteredAggregate.aggregateCount).toBe(1);
    expect(filteredAggregate.sourceEdgeCount).toBe(1);
    expect(filteredAggregate.sourceEdgeOmittedCount).toBe(1);
    expect(filteredAggregate.aggregateProvenance).toEqual([
      expect.objectContaining({ origin: "heuristic", confidence: "likely", count: 1 })
    ]);
    const packageLayoutKeys = selectLodScope(
      service.graph, "package", {}, getPackageProjection(service.graph)
    ).keys;
    expect(packageLayoutKeys.size).toBe(500);
    expect([...packageLayoutKeys].every((entityKey) => visiblePackageKeys.has(entityKey))).toBe(true);

    const fileResponse = await instance.inject({
      method: "GET",
      url: "/api/v1/nodes?level=file&limit=9999"
    });
    expect(fileResponse.statusCode).toBe(200);
    const files = fileResponse.json() as Page<unknown>;
    expect(files.items).toHaveLength(500);
    expect(files.omittedCount).toBeGreaterThan(0);
    const boundedFiles = selectLodScope(service.graph, "file").keys;
    const boundedSymbols = selectLodScope(service.graph, "symbol").keys;
    expect(boundedFiles.size).toBe(500);
    expect(boundedSymbols.size).toBe(1_000);
    expect([...boundedFiles]).toEqual((files.items as ToolNode[]).map((node) => node.entityKey));

    const symbolResponse = await instance.inject({
      method: "GET",
      url: "/api/v1/nodes?level=symbol&limit=9999"
    });
    expect(symbolResponse.statusCode).toBe(200);
    const symbols = symbolResponse.json() as Page<unknown>;
    expect(symbols.items).toHaveLength(1_000);
    expect(symbols.omittedCount).toBeGreaterThan(0);
    expect([...boundedSymbols]).toEqual((symbols.items as ToolNode[]).map((node) => node.entityKey));

    const edgeResponse = await instance.inject({
      method: "GET",
      url: "/api/v1/edges?level=file&limit=9999"
    });
    expect(edgeResponse.statusCode).toBe(200);
    const edges = edgeResponse.json() as Page<unknown>;
    expect(edges.items).toHaveLength(1_000);
    expect(edges.omittedCount).toBeGreaterThan(0);
  });
});
