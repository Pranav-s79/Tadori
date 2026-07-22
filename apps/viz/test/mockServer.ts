import type {
  ApiContext,
  ApiEdge,
  ApiNode,
  LayoutPositionDto,
  RefreshStatus
} from "../src/api/types.ts";

/**
 * Contract-shaped fixtures for /api/v1/*, mirroring the real server's
 * paginated `{ items, nextCursor, total }` envelope (see
 * packages/server/src/routes/graph.ts) rather than a flat `{ nodes }`/
 * `{ edges }` shape. The client (src/api/client.ts) is written to tolerate
 * either shape so it keeps working against both this mock and the real
 * server.
 */

export const mockContext: ApiContext = {
  repository: "tadori",
  snapshotId: 1,
  snapshotKind: "working_tree",
  freshness: "fresh",
  stale: false,
  staleReason: null,
  refreshPending: false
};

export const mockPackageNodes: ApiNode[] = [
  {
    entityKey: "pkg:core",
    kind: "package",
    qualifiedName: "@tadori/core",
    displayName: "@tadori/core",
    file: null,
    exported: true,
    fanIn: 4
  },
  {
    entityKey: "pkg:store",
    kind: "package",
    qualifiedName: "@tadori/store",
    displayName: "@tadori/store",
    file: null,
    exported: true,
    fanIn: 2
  },
  {
    entityKey: "pkg:server",
    kind: "package",
    qualifiedName: "@tadori/server",
    displayName: "@tadori/server",
    file: null,
    exported: true,
    fanIn: 1
  }
];

export const mockPackageEdges: ApiEdge[] = [
  {
    entityKey: "edge:1",
    srcEntityKey: "pkg:server",
    relation: "imports",
    dstEntityKey: "pkg:store",
    origin: "compiler",
    confidence: "certain",
    resolution: "resolved"
  },
  {
    entityKey: "edge:2",
    srcEntityKey: "pkg:store",
    relation: "imports",
    dstEntityKey: "pkg:core",
    origin: "compiler",
    confidence: "certain",
    resolution: "resolved"
  }
];

export const mockLayoutPositions: LayoutPositionDto[] = [
  { entityKey: "pkg:core", x: 0, y: 0, z: 0, pinned: false },
  { entityKey: "pkg:store", x: 100, y: 0, z: 0, pinned: false },
  { entityKey: "pkg:server", x: 50, y: 100, z: 0, pinned: false }
];

export const mockRefreshStatus: RefreshStatus = {
  phase: "idle",
  generation: 1,
  dirtyPaths: [],
  snapshotId: 1,
  lastError: null
};

/**
 * File-level fixtures for semantic zoom (08-03), keyed by owning package. Two
 * packages carry file nodes/edges/positions so tests can expand each
 * independently and assert cross-package aggregation.
 */
export const mockFileNodesByPackage: Record<string, ApiNode[]> = {
  "pkg:core": [
    { entityKey: "file:core/a.ts", kind: "file", qualifiedName: "core/a.ts", displayName: "a.ts", file: "core/a.ts", exported: true, fanIn: 2 },
    { entityKey: "file:core/b.ts", kind: "file", qualifiedName: "core/b.ts", displayName: "b.ts", file: "core/b.ts", exported: false, fanIn: 1 }
  ],
  "pkg:store": [
    { entityKey: "file:store/index.ts", kind: "file", qualifiedName: "store/index.ts", displayName: "index.ts", file: "store/index.ts", exported: true, fanIn: 3 }
  ]
};

export const mockFileEdgesByPackage: Record<string, ApiEdge[]> = {
  "pkg:core": [
    { entityKey: "fedge:core:1", srcEntityKey: "file:core/a.ts", relation: "imports", dstEntityKey: "file:core/b.ts", origin: "compiler", confidence: "certain", resolution: "resolved" }
  ],
  "pkg:store": []
};

export const mockFileLayoutByPackage: Record<string, LayoutPositionDto[]> = {
  "pkg:core": [
    { entityKey: "file:core/a.ts", x: 5, y: 5, z: 0, pinned: false },
    { entityKey: "file:core/b.ts", x: 15, y: 5, z: 0, pinned: false }
  ],
  "pkg:store": [{ entityKey: "file:store/index.ts", x: 105, y: 5, z: 0, pinned: false }]
};

export function mockNodesResponse(nodes: ApiNode[] = mockPackageNodes) {
  return { items: nodes, nextCursor: null, total: nodes.length };
}

export function mockEdgesResponse(edges: ApiEdge[] = mockPackageEdges) {
  return { items: edges, nextCursor: null, total: edges.length };
}

export function mockLayoutResponse(positions: LayoutPositionDto[] = mockLayoutPositions) {
  return { positions, layoutVersion: 1 };
}

/** Minimal empty ReviewDiffDto so App-level review fetches resolve in tests. */
export function mockReviewDiffResponse() {
  return {
    context: mockContext,
    base: { id: 1, kind: "snapshot", label: "base", baseCommitSha: null, workspaceHash: "", pinned: false, status: "active", createdAt: "" },
    head: { id: 1, kind: "snapshot", label: "head", baseCommitSha: null, workspaceHash: "", pinned: false, status: "active", createdAt: "" },
    nodesAdded: [],
    nodesRemoved: [],
    edges: [],
    nodesAddedOmitted: 0,
    nodesRemovedOmitted: 0,
    edgesOmitted: 0,
    nextCursor: null,
    presentation: "raw"
  };
}

/**
 * Installs a `fetch` stub on `globalThis` that answers the /api/v1/*
 * endpoints this app calls, using the mock fixtures above. Returns a
 * restore function to put the original fetch back.
 */
export function installMockFetch(overrides?: {
  context?: ApiContext;
  nodes?: ApiNode[];
  edges?: ApiEdge[];
  positions?: LayoutPositionDto[];
}): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const params = new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?")) : "");
    const level = params.get("level");
    const pkg = params.get("packageName");
    if (url.includes("/api/v1/snapshot")) {
      return jsonResponse(overrides?.context ?? mockContext);
    }
    if (url.includes("/api/v1/nodes")) {
      if (level === "file" && pkg !== null) {
        return jsonResponse(mockNodesResponse(mockFileNodesByPackage[pkg] ?? []));
      }
      return jsonResponse(mockNodesResponse(overrides?.nodes));
    }
    if (url.includes("/api/v1/edges")) {
      if (level === "file" && pkg !== null) {
        return jsonResponse(mockEdgesResponse(mockFileEdgesByPackage[pkg] ?? []));
      }
      return jsonResponse(mockEdgesResponse(overrides?.edges));
    }
    if (url.includes("/api/v1/layout")) {
      if (level === "file" && pkg !== null) {
        return jsonResponse(mockLayoutResponse(mockFileLayoutByPackage[pkg] ?? []));
      }
      return jsonResponse(mockLayoutResponse(overrides?.positions));
    }
    if (url.includes("/api/v1/review/diff")) {
      return jsonResponse(mockReviewDiffResponse());
    }
    throw new Error(`installMockFetch: unhandled URL ${url}`);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
