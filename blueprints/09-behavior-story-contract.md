# BehaviorStory contract (FROZEN by lead, 2026-07-21)

Frozen after a read-only architecture inspection of the live repo. This is the
single source of truth for the backend and frontend story lanes. The two lanes
meet ONLY at the `BehaviorStory` TypeScript interface below — agree on the shape,
then never edit the same file.

## Naming & honesty invariants (non-negotiable)

- It is a **static behavior story**, NOT an "execution story". `runtimeObserved`
  is always `false`. No runtime/coverage claim is ever made — the graph has no
  runtime evidence (`GET /tests` already reports `observed:false`; the extractor
  labels test links "Static linkage only, never runtime coverage").
- Dynamic dispatch dead-ends at a `kind:"unresolved"` node — render the wall,
  never invent a destination.
- No control-flow branch data exists today. `branches[]` is emitted as `[]` in
  v1 (DEFER real if/else branching until a control-flow source exists). Call
  fan-out is expressed via multiple `transitions`, not faked branches.
- Every step/transition carries its real `origin`/`confidence`/`resolution` and
  evidence, verbatim from the edge/node that produced it. Nothing is upgraded.

## Honesty label mapping (reuses frozen enums — no new enum)

| label | derived from |
|---|---|
| statically-resolved | `edge.origin === "compiler" && edge.resolution === "resolved"` |
| test-backed | node is target of an incoming `tests` edge |
| documented | node is target of an incoming `documents` edge |
| inferred | `edge.confidence === "inferred"` |
| ambiguous | `edge.origin === "heuristic" && edge.resolution === "partial"` |
| unresolved | `edge.resolution === "unresolved"` OR dst `kind === "unresolved"` |

## Contract

```ts
import type { Confidence, Evidence, Origin, Relation, Resolution } from "@tadori/core";

type EntityKey = string; // hex64, same as GraphNode.entityKey

type StoryStepLabel =
  | "statically-resolved" | "test-backed" | "documented"
  | "inferred" | "ambiguous" | "unresolved";

interface StoryStep {
  id: string;                    // `step:${index}:${entityKey ?? "unresolved"}`
  entityKey: EntityKey | null;   // null only for kind:"unresolved" destinations
  kind: string;                  // NodeKind of the reached node
  resolved: boolean;             // dst.kind !== "unresolved" && reaching edge.resolution !== "unresolved"
  label: StoryStepLabel;
  origin: Origin;                // from the edge that reached this step
  confidence: Confidence;
  resolution: Resolution;
  evidence: Evidence[];          // reached node.evidence via toToolEvidence
}

interface StoryTransition {
  from: EntityKey;
  to: EntityKey | null;
  relation: Relation;            // "routes_to" | "calls" | "references"
  origin: Origin;
  confidence: Confidence;
  resolution: Resolution;
  resolved: boolean;             // resolution !== "unresolved"
  evidence: Evidence[];          // edge.evidence verbatim
}

interface BehaviorStory {
  id: string;                    // `story:route:${entityKey}:${snapshotId}`
  title: string;                 // route node displayName (e.g. "GET /users/:id")
  trigger: string;               // route displayName (HTTP trigger)
  entryPoint: EntityKey;         // the route node's entityKey
  steps: StoryStep[];
  transitions: StoryTransition[];
  tests: EntityKey[];            // test nodes with a `tests` edge into any step (sorted)
  unresolvedTransitions: StoryTransition[]; // explicit subset, resolution === "unresolved"
  branches: [];                  // v1: always empty (DEFER control-flow branching)
  evidenceOmittedCount: number;  // 0 today (mirrors toToolNode/toToolEdge)
  snapshotId: number;
  confidence: Confidence;        // weakest across transitions (inferred < likely < certain)
  runtimeObserved: false;        // invariant: static analysis only
}
```

## Determinism (byte-stable)

BFS from `entryPoint` over `outEdges` filtered to `["routes_to","calls","references"]`;
at each node sort outgoing edges by `edge.entityKey` ascending (same rule as
`MCPTools.path` tools.ts:1691), first-visit wins via a visited set. `steps` are
emitted in BFS visitation order; `tests` and `unresolvedTransitions` sorted by
entityKey. entityKey is a content hash → stable across runs and OSes.

## Seam (no seventh MCP tool)

- Backend lane owns (new): `packages/server/src/story.ts` (pure
  `deriveRouteStory(service, routeNode): BehaviorStory`, reusing GraphService
  `outEdges`/`inEdges` and `toToolNode`/`toToolEdge`/`toToolEvidence`),
  `packages/server/src/routes/story.ts` (`GET /api/v1/story/route/:entityKey`,
  404 unknown_entity / 409 ambiguous via existing errors.ts), the `BehaviorStory`
  DTO block in `packages/server/src/types.ts`, and the one-line registration in
  `app.ts`. Modifies GraphService/graph.ts NONE.
- Frontend lane owns (later): the `apps/viz` StoryView consuming
  `GET /api/v1/story/route/:entityKey` (linear + call-fan-out, playback, keyboard,
  list fallback, honest labels, links each step to existing source/graph
  inspection). Reads the DTO only.

## Roadmap

New node `08-07A "Route behavior story derivation"` depends on `08-07`
(Path/route/test/doc displays, status review). Do not expand 08-07 (in review).
