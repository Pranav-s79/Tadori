import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  insertSnapshotGraph,
  getSnapshot,
  openDatabase,
  pruneSnapshot,
  runMigrations,
  type Database
} from "@tadori/store";
import { EventLog, type RetrievalCallLog } from "../src/events.js";
import { GraphService } from "../src/service.js";
import { makeEdge, makeFile, makeGraph, makeNode } from "./helpers.js";

let db: Database;
let tempRoot: string;

beforeEach(() => {
  db = openDatabase(":memory:");
  runMigrations(db);
  tempRoot = mkdtempSync(path.join(tmpdir(), "tadori-mcp-events-"));
});

afterEach(() => {
  db.close();
  rmSync(tempRoot, { recursive: true, force: true });
});

function setupEventLog() {
  const source = "export function alpha() {}\n";
  mkdirSync(path.join(tempRoot, "src"), { recursive: true });
  writeFileSync(path.join(tempRoot, "src", "a.ts"), source, "utf8");
  const file = makeFile("src/a.ts", source);
  const alpha = makeNode("function", "src/a.ts.alpha", file.normalizedPath, {
    displayName: "alpha"
  });
  const fileNode = makeNode("file", "src/a.ts", file.normalizedPath, {
    displayName: "a.ts"
  });
  const edge = makeEdge(fileNode, "contains", alpha);
  insertSnapshotGraph(db, makeGraph(tempRoot, [file], [fileNode, alpha], [edge]));
  const service = GraphService.open(db, tempRoot);
  return { service, log: new EventLog(db, service, "codex", "test task"), alpha, edge };
}

function callFor(nodeKey: string, edgeKey: string): RetrievalCallLog {
  return {
    tool: "symbol_context",
    args: { anchor: nodeKey },
    requestedTokenBudget: 1000,
    estimatedResponseTokens: 100,
    truncated: false,
    resultNodes: [
      { entityKey: nodeKey, rank: 1, score: 10, representation: "signature", stale: false }
    ],
    resultEdges: [{ entityKey: edgeKey, rank: 1, score: 5, stale: false }],
    omissions: []
  };
}

describe("EventLog", () => {
  it("atomically records one retrieval event and every returned entity", () => {
    const { log, alpha, edge } = setupEventLog();
    log.logRetrieval(callFor(alpha.entityKey, edge.entityKey));

    const counts = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM retrieval_events) AS events,
           (SELECT COUNT(*) FROM retrieval_result_nodes) AS nodes,
           (SELECT COUNT(*) FROM retrieval_result_edges) AS edges`
      )
      .get() as { events: number; nodes: number; edges: number };
    expect(counts).toEqual({ events: 1, nodes: 1, edges: 1 });
  });

  it("rejects unknown and duplicate result entities without partial event rows", () => {
    const { log, alpha, edge } = setupEventLog();
    const unknown = callFor("0".repeat(64), edge.entityKey);
    expect(() => log.logRetrieval(unknown)).toThrow(/unknown node entity/);

    const duplicate = callFor(alpha.entityKey, edge.entityKey);
    duplicate.resultNodes.push({ ...duplicate.resultNodes[0]!, rank: 2 });
    expect(() => log.logRetrieval(duplicate)).toThrow(/duplicate result-node/);

    const count = db.prepare("SELECT COUNT(*) AS count FROM retrieval_events").get() as {
      count: number;
    };
    expect(count.count).toBe(0);
  });

  it("rejects invalid ranks and dishonest freshness without partial event rows", () => {
    const { log, alpha, edge } = setupEventLog();
    const invalidRank = callFor(alpha.entityKey, edge.entityKey);
    invalidRank.resultNodes[0]!.rank = 0;
    expect(() => log.logRetrieval(invalidRank)).toThrow(/positive integers/);

    const dishonestStale = callFor(alpha.entityKey, edge.entityKey);
    dishonestStale.resultNodes[0]!.stale = true;
    expect(() => log.logRetrieval(dishonestStale)).toThrow(/stale flag disagrees/);

    const count = db.prepare("SELECT COUNT(*) AS count FROM retrieval_events").get() as {
      count: number;
    };
    expect(count.count).toBe(0);
  });

  it("pins the served snapshot while its MCP task is active", () => {
    const { service, log } = setupEventLog();
    expect(() => pruneSnapshot(db, service.snapshot.id)).toThrow(/active task/);
    log.endTask();
    expect(() => pruneSnapshot(db, service.snapshot.id)).not.toThrow();
  });

  it("rejects entities that exist in the repository but not in the served snapshot", () => {
    const source = "export function oldOnly() {}\n";
    mkdirSync(path.join(tempRoot, "src"), { recursive: true });
    writeFileSync(path.join(tempRoot, "src", "old.ts"), source, "utf8");
    const file = makeFile("src/old.ts", source);
    const oldOnly = makeNode("function", "src/old.ts.oldOnly", file.normalizedPath);
    const first = insertSnapshotGraph(
      db,
      makeGraph(tempRoot, [file], [oldOnly], [], "commit")
    );

    writeFileSync(path.join(tempRoot, "src", "new.ts"), "export function current() {}\n", "utf8");
    const currentFile = makeFile("src/new.ts", "export function current() {}\n");
    const current = makeNode("function", "src/new.ts.current", currentFile.normalizedPath);
    insertSnapshotGraph(db, makeGraph(tempRoot, [currentFile], [current], []));

    const served = new GraphService(
      db,
      tempRoot,
      getSnapshot(db, first.snapshotId)!
    );
    expect(served.nodeEntityId(current.entityKey)).toBeNull();
  });

  it("records interruption atomically and resets observation coverage to partial", () => {
    const { service, log } = setupEventLog();
    log.setObservationCoverage("complete_for_registered_sources");
    const nodeId = service.nodeEntityId(service.graph.nodes[0]!.entityKey);
    expect(nodeId).not.toBeNull();

    log.recordAgentEvent("capture_interrupted", "codex_log", { reason: "hook closed" }, [
      { kind: "node", entityId: nodeId! }
    ]);
    const task = db
      .prepare("SELECT observation_coverage FROM tasks WHERE id = ?")
      .get(log.taskId) as { observation_coverage: string };
    expect(task.observation_coverage).toBe("partial");
  });

  it("rejects non-member event targets before inserting an agent event", () => {
    const { log } = setupEventLog();
    expect(() =>
      log.recordAgentEvent("file_read_observed", "manual", null, [
        { kind: "file", entityId: 999999 }
      ])
    ).toThrow(/not a member/);
    const count = db.prepare("SELECT COUNT(*) AS count FROM agent_events").get() as {
      count: number;
    };
    expect(count.count).toBe(0);
  });
});
