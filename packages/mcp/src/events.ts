import type { Database } from "@tadori/store";
import type { GraphService } from "./service.js";

export type RetrievalTool =
  | "repo_overview"
  | "find_symbol"
  | "symbol_context"
  | "find_tests"
  | "impact"
  | "path";

export type AgentEventType =
  | "file_read_observed"
  | "plan_mentioned"
  | "modified"
  | "test_selected"
  | "test_executed"
  | "capture_interrupted";

export type AgentEventSource = "claude_hook" | "codex_log" | "transcript" | "manual";

export interface ResultNodeLogEntry {
  entityKey: string;
  rank: number;
  score: number | null;
  representation: "body" | "signature" | "name" | "aggregate";
  stale: boolean;
}

export interface ResultEdgeLogEntry {
  entityKey: string;
  rank: number;
  score: number | null;
  stale: boolean;
}

export interface OmissionLogEntry {
  targetKind: "node" | "edge";
  entityKey: string;
  rank: number;
  score: number | null;
  reason: string;
}

export interface RetrievalCallLog {
  tool: RetrievalTool;
  args: unknown;
  requestedTokenBudget?: number | null;
  estimatedResponseTokens?: number | null;
  truncated: boolean;
  nextCursor?: string | null;
  resultNodes: ResultNodeLogEntry[];
  resultEdges: ResultEdgeLogEntry[];
  omissions: OmissionLogEntry[];
  aggregateOmissionCount?: number;
}

/**
 * Frozen migration-003 retrieval/event logging. One task row represents one
 * MCP session; every tool call writes one retrieval_events row plus result
 * and omission rows. Observation coverage never claims completeness: the
 * default is `partial`, and a capture interruption forces it back to
 * `partial` and records the interruption.
 */
export class EventLog {
  readonly taskId: number;

  constructor(
    private readonly db: Database,
    private readonly service: GraphService,
    agent: string,
    description: string
  ) {
    const createTask = db.transaction((): number => {
      const active = db
        .prepare("SELECT 1 FROM repository_snapshots WHERE id = ? AND status = 'active'")
        .get(service.snapshot.id);
      if (!active) {
        throw new Error(`Snapshot ${service.snapshot.id} is no longer active`);
      }
      const result = db
        .prepare(
          `INSERT INTO tasks (repo_id, base_snapshot_id, agent, description, observation_coverage)
           VALUES (?, ?, ?, ?, 'partial')`
        )
        .run(service.repoId, service.snapshot.id, agent, description);
      return Number(result.lastInsertRowid);
    });
    this.taskId = createTask.immediate();
  }

  logRetrieval(call: RetrievalCallLog): number {
    const argsJson = JSON.stringify(call.args ?? {});
    if (argsJson === undefined) {
      throw new Error("Retrieval arguments are not JSON serializable");
    }
    const assertUnique = (keys: string[], label: string): void => {
      if (new Set(keys).size !== keys.length) {
        throw new Error(`Retrieval log contains duplicate ${label} entity keys`);
      }
    };
    assertUnique(call.resultNodes.map((entry) => entry.entityKey), "result-node");
    assertUnique(call.resultEdges.map((entry) => entry.entityKey), "result-edge");
    assertUnique(
      call.omissions.map((entry) => `${entry.targetKind}:${entry.entityKey}`),
      "omission"
    );
    const assertRanked = (
      entries: ReadonlyArray<{ rank: number; score: number | null }>,
      label: string
    ): void => {
      if (entries.some((entry) => !Number.isInteger(entry.rank) || entry.rank < 1)) {
        throw new Error(`${label} ranks must be positive integers`);
      }
      if (new Set(entries.map((entry) => entry.rank)).size !== entries.length) {
        throw new Error(`${label} ranks must be unique`);
      }
      if (entries.some((entry) => entry.score !== null && !Number.isFinite(entry.score))) {
        throw new Error(`${label} scores must be finite or null`);
      }
    };
    assertRanked(call.resultNodes, "result-node");
    assertRanked(call.resultEdges, "result-edge");
    assertRanked(
      call.omissions.filter((entry) => entry.targetKind === "node"),
      "node-omission"
    );
    assertRanked(
      call.omissions.filter((entry) => entry.targetKind === "edge"),
      "edge-omission"
    );
    for (const [value, label] of [
      [call.requestedTokenBudget, "requested token budget"],
      [call.estimatedResponseTokens, "estimated response tokens"]
    ] as const) {
      if (value !== undefined && value !== null && (!Number.isInteger(value) || value < 0)) {
        throw new Error(`${label} must be a nonnegative integer or null`);
      }
    }
    if (!call.truncated && call.nextCursor !== undefined && call.nextCursor !== null) {
      throw new Error("A non-truncated retrieval cannot have a continuation cursor");
    }
    if (
      call.omissions.some((entry) => entry.reason.trim().length === 0) ||
      (call.truncated &&
        call.omissions.length === 0 &&
        !call.nextCursor &&
        (call.aggregateOmissionCount ?? 0) === 0)
    ) {
      throw new Error("A truncated retrieval requires an omission or continuation cursor");
    }
    const returnedKeys = new Set([
      ...call.resultNodes.map((entry) => `node:${entry.entityKey}`),
      ...call.resultEdges.map((entry) => `edge:${entry.entityKey}`)
    ]);
    for (const omission of call.omissions) {
      if (returnedKeys.has(`${omission.targetKind}:${omission.entityKey}`)) {
        throw new Error(
          `Retrieval entity ${omission.entityKey} cannot be both returned and omitted`
        );
      }
    }
    const run = this.db.transaction((): number => {
      const task = this.db
        .prepare("SELECT status FROM tasks WHERE id = ?")
        .get(this.taskId) as { status: string } | undefined;
      if (task?.status !== "active") {
        throw new Error(`Cannot log retrieval for non-active task ${this.taskId}`);
      }
      const nodeIds = new Map<string, number>();
      const edgeIds = new Map<string, number>();
      for (const entry of [
        ...call.resultNodes,
        ...call.omissions.filter((item) => item.targetKind === "node")
      ]) {
        const id = this.service.nodeEntityId(entry.entityKey);
        if (id === null) {
          throw new Error(`Cannot log unknown node entity ${entry.entityKey}`);
        }
        nodeIds.set(entry.entityKey, id);
      }
      for (const entry of [
        ...call.resultEdges,
        ...call.omissions.filter((item) => item.targetKind === "edge")
      ]) {
        const id = this.service.edgeEntityId(entry.entityKey);
        if (id === null) {
          throw new Error(`Cannot log unknown edge entity ${entry.entityKey}`);
        }
        edgeIds.set(entry.entityKey, id);
      }
      for (const entry of call.resultNodes) {
        const node = this.service.nodesByKey.get(entry.entityKey);
        if (!node || this.service.nodeFreshness(node).stale !== entry.stale) {
          throw new Error(`Result-node stale flag disagrees with snapshot freshness`);
        }
      }
      for (const entry of call.resultEdges) {
        const edge = this.service.graph.edges.find((item) => item.entityKey === entry.entityKey);
        if (!edge || this.service.edgeFreshness(edge).stale !== entry.stale) {
          throw new Error(`Result-edge stale flag disagrees with snapshot freshness`);
        }
      }
      const event = this.db
        .prepare(
        `INSERT INTO retrieval_events
           (task_id, snapshot_id, tool, args_json, requested_token_budget,
            estimated_response_tokens, truncated, next_cursor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
        this.taskId,
        this.service.snapshot.id,
        call.tool,
        argsJson,
        call.requestedTokenBudget ?? null,
        call.estimatedResponseTokens ?? null,
        call.truncated ? 1 : 0,
        call.nextCursor ?? null
        );
      const eventId = Number(event.lastInsertRowid);

    const insertNode = this.db.prepare(
      `INSERT INTO retrieval_result_nodes
         (event_id, node_id, rank_position, score, representation, stale)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const entry of call.resultNodes) {
      insertNode.run(
        eventId,
        nodeIds.get(entry.entityKey),
        entry.rank,
        entry.score,
        entry.representation,
        entry.stale ? 1 : 0
      );
    }

    const insertEdge = this.db.prepare(
      `INSERT INTO retrieval_result_edges
         (event_id, edge_id, rank_position, score, stale)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const entry of call.resultEdges) {
      insertEdge.run(
        eventId,
        edgeIds.get(entry.entityKey),
        entry.rank,
        entry.score,
        entry.stale ? 1 : 0
      );
    }

    const insertOmission = this.db.prepare(
      `INSERT INTO retrieval_omissions
         (event_id, target_kind, node_id, edge_id, rank_position, score, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const omission of call.omissions) {
      insertOmission.run(
        eventId,
        omission.targetKind,
        omission.targetKind === "node" ? nodeIds.get(omission.entityKey) : null,
        omission.targetKind === "edge" ? edgeIds.get(omission.entityKey) : null,
        omission.rank,
        omission.score,
        omission.reason
      );
    }

      return eventId;
    });
    return run.immediate();
  }

  recordAgentEvent(
    type: AgentEventType,
    source: AgentEventSource,
    payload: unknown = null,
    targets: Array<{ kind: "file" | "node"; entityId: number }> = []
  ): number {
    const seen = new Set<string>();
    for (const target of targets) {
      const key = `${target.kind}:${target.entityId}`;
      if (seen.has(key)) {
        throw new Error(`Agent event contains duplicate target ${key}`);
      }
      seen.add(key);
    }
    const payloadJson = payload === null ? null : JSON.stringify(payload);
    if (payload !== null && payloadJson === undefined) {
      throw new Error("Agent event payload is not JSON serializable");
    }
    const run = this.db.transaction((): number => {
      const task = this.db
        .prepare("SELECT status FROM tasks WHERE id = ?")
        .get(this.taskId) as { status: string } | undefined;
      if (task?.status !== "active") {
        throw new Error(`Cannot log agent event for non-active task ${this.taskId}`);
      }
      for (const target of targets) {
        const key = `${target.kind}:${target.entityId}`;
        const table = target.kind === "file" ? "snapshot_files" : "snapshot_nodes";
        const column = target.kind === "file" ? "file_id" : "node_id";
        const exists = this.db
          .prepare(`SELECT 1 FROM ${table} WHERE snapshot_id = ? AND ${column} = ?`)
          .get(this.service.snapshot.id, target.entityId);
        if (!exists) {
          throw new Error(`Agent event target ${key} is not a member of the served snapshot`);
        }
      }
      const event = this.db
        .prepare(
        `INSERT INTO agent_events (task_id, snapshot_id, event_type, source, payload_json)
         VALUES (?, ?, ?, ?, ?)`
        )
        .run(
        this.taskId,
        this.service.snapshot.id,
        type,
        source,
        payloadJson
        );
      const eventId = Number(event.lastInsertRowid);
      const insertTarget = this.db.prepare(
        `INSERT INTO agent_event_targets (event_id, target_kind, file_id, node_id)
       VALUES (?, ?, ?, ?)`
      );
      for (const target of targets) {
        insertTarget.run(
          eventId,
          target.kind,
          target.kind === "file" ? target.entityId : null,
          target.kind === "node" ? target.entityId : null
        );
      }
      if (type === "capture_interrupted") {
        this.db
          .prepare("UPDATE tasks SET observation_coverage = 'partial' WHERE id = ?")
          .run(this.taskId);
      }
      return eventId;
    });
    return run.immediate();
  }

  setObservationCoverage(
    coverage: "complete_for_registered_sources" | "partial" | "unknown"
  ): void {
    this.db
      .prepare("UPDATE tasks SET observation_coverage = ? WHERE id = ?")
      .run(coverage, this.taskId);
  }

  endTask(status: "completed" | "aborted" = "completed"): void {
    this.db
      .prepare("UPDATE tasks SET status = ?, ended_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(status, this.taskId);
  }
}
