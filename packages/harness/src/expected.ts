import { readFileSync } from "node:fs";
import path from "node:path";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import type { Confidence, NodeKind, Origin, Relation, Resolution } from "@tadori/core";

export interface ExpectedEvidence {
  file: string;
  line: number;
  contains: string;
  note?: string;
}

export interface ExpectedNode {
  id: string;
  kind: NodeKind;
  qualifiedName: string;
  displayName: string;
  canonicalIdentity: string;
  entityKey: string;
  file: string | null;
  exported: boolean;
  bodyHash?: string;
  notes?: string[];
}

export interface ExpectedEdge {
  id: string;
  src: string;
  relation: Relation;
  dst: string;
  canonicalIdentity: string;
  entityKey: string;
  origin: Origin;
  confidence: Confidence;
  resolution: Resolution;
  evidence: ExpectedEvidence[];
  notes?: string[];
}

export interface ExpectedBoundaryViolation {
  ruleId: string;
  src: string;
  edgeRelation: Relation;
  dst: string;
  severity: "warning" | "error";
  evidence: ExpectedEvidence[];
}

export interface ExpectedExcludedCandidate {
  kind: string;
  reason: string;
  [key: string]: unknown;
}

export interface ExpectedGraph {
  schemaVersion: string;
  fixture: {
    id: string;
    snapshot: string;
    packageName: string;
    purpose: string;
    relationStrata: Relation[];
    nastyCases: string[];
    indexedFiles: string[];
    supportFiles: string[];
  };
  analyzerContract: Record<string, unknown>;
  nodes: ExpectedNode[];
  edges: ExpectedEdge[];
  expectedBoundaryViolations: ExpectedBoundaryViolation[];
  excludedCandidates: ExpectedExcludedCandidate[];
}

let cachedValidator: ValidateFunction | null = null;

export function expectedGraphValidator(repoRoot: string): ValidateFunction {
  if (!cachedValidator) {
    const schemaPath = path.join(repoRoot, "schemas", "expected-graph.schema.json");
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    cachedValidator = ajv.compile(schema);
  }
  return cachedValidator;
}

/** Loads and schema-validates one expected graph JSON. */
export function loadExpectedGraph(repoRoot: string, expectedPath: string): ExpectedGraph {
  const raw = JSON.parse(readFileSync(expectedPath, "utf8")) as unknown;
  const validate = expectedGraphValidator(repoRoot);
  if (!validate(raw)) {
    const details = (validate.errors ?? [])
      .map((e) => `${e.instancePath || "/"}: ${e.message ?? "invalid"}`)
      .join("; ");
    throw new Error(`Expected graph ${expectedPath} fails its JSON schema: ${details}`);
  }
  return raw as ExpectedGraph;
}

export interface ManifestFixture {
  id: string;
  path: string;
  snapshot?: string;
  snapshots?: string[];
  sourceRoot?: string;
  expectedGraph?: string;
  expectedBeforeGraph?: string;
  expectedAfterGraph?: string;
  [key: string]: unknown;
}

export interface FixtureManifest {
  schemaVersion: string;
  root: string;
  fixtures: ManifestFixture[];
}

export function loadManifest(repoRoot: string): FixtureManifest {
  return JSON.parse(
    readFileSync(path.join(repoRoot, "fixture-manifest.json"), "utf8")
  ) as FixtureManifest;
}

/** Every (sourceRoot, expectedGraph) pair the harness must compare. */
export interface FixtureSnapshotTarget {
  fixtureId: string;
  snapshot: string;
  sourceRoot: string;
  expectedGraphPath: string;
}

export function fixtureSnapshotTargets(repoRoot: string): FixtureSnapshotTarget[] {
  const manifest = loadManifest(repoRoot);
  const targets: FixtureSnapshotTarget[] = [];
  for (const fixture of manifest.fixtures) {
    const fixtureDir = path.join(repoRoot, fixture.path);
    if (fixture.expectedGraph && fixture.sourceRoot) {
      targets.push({
        fixtureId: fixture.id,
        snapshot: fixture.snapshot ?? "base",
        sourceRoot: path.join(fixtureDir, fixture.sourceRoot),
        expectedGraphPath: path.join(fixtureDir, fixture.expectedGraph)
      });
    } else if (fixture.snapshots) {
      for (const snapshot of fixture.snapshots) {
        const expectedRelative =
          snapshot === "before" ? fixture.expectedBeforeGraph : fixture.expectedAfterGraph;
        if (!expectedRelative) {
          throw new Error(
            `Fixture ${fixture.id} snapshot ${snapshot} has no expected graph in the manifest`
          );
        }
        targets.push({
          fixtureId: fixture.id,
          snapshot,
          sourceRoot: path.join(fixtureDir, snapshot),
          expectedGraphPath: path.join(fixtureDir, expectedRelative)
        });
      }
    } else {
      throw new Error(`Fixture ${fixture.id} has neither expectedGraph nor snapshots`);
    }
  }
  return targets;
}
