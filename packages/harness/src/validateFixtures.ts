import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { sha256Hex } from "@tadori/core";
import { fixtureSnapshotTargets, loadExpectedGraph } from "./expected.js";

/**
 * TypeScript port of validate_fixtures.py: schema validation, canonical hash
 * verification, endpoint-alias integrity, and evidence anchors against the
 * fixture sources. This validates the frozen expectations themselves, not the
 * indexer.
 */
export function validateFixtures(repoRoot: string): string[] {
  const errors: string[] = [];

  for (const target of fixtureSnapshotTargets(repoRoot)) {
    let graph;
    try {
      graph = loadExpectedGraph(repoRoot, target.expectedGraphPath);
    } catch (error) {
      errors.push(String(error));
      continue;
    }
    const where = `${target.fixtureId}/${target.snapshot}`;

    const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
    if (nodesById.size !== graph.nodes.length) {
      errors.push(`${where}: duplicate node id`);
    }
    if (new Set(graph.nodes.map((n) => n.entityKey)).size !== graph.nodes.length) {
      errors.push(`${where}: duplicate node entityKey`);
    }
    if (new Set(graph.edges.map((e) => e.entityKey)).size !== graph.edges.length) {
      errors.push(`${where}: duplicate edge entityKey`);
    }

    for (const node of graph.nodes) {
      if (sha256Hex(node.canonicalIdentity) !== node.entityKey) {
        errors.push(`${where}: node hash mismatch: ${node.id}`);
      }
    }

    for (const edge of graph.edges) {
      const src = nodesById.get(edge.src);
      const dst = nodesById.get(edge.dst);
      if (!src || !dst) {
        errors.push(`${where}: dangling edge alias: ${edge.id}`);
        continue;
      }
      const expectedCanonical = `edge|${src.entityKey}|${edge.relation}|${dst.entityKey}`;
      if (edge.canonicalIdentity !== expectedCanonical) {
        errors.push(`${where}: edge canonical mismatch: ${edge.id}`);
      }
      if (sha256Hex(edge.canonicalIdentity) !== edge.entityKey) {
        errors.push(`${where}: edge hash mismatch: ${edge.id}`);
      }

      for (const evidence of edge.evidence) {
        const sourcePath = path.join(target.sourceRoot, evidence.file);
        if (!existsSync(sourcePath)) {
          errors.push(`${where}: missing evidence file ${evidence.file}`);
          continue;
        }
        const lines = readFileSync(sourcePath, "utf8").split(/\r?\n/);
        const line = lines[evidence.line - 1];
        if (evidence.line < 1 || line === undefined) {
          errors.push(`${where}: evidence line out of range: ${edge.id}`);
        } else if (!line.includes(evidence.contains)) {
          errors.push(`${where}: evidence substring mismatch: ${edge.id}`);
        }
      }
    }
  }

  // Diff artifacts validate against their own schema.
  const diffSchemaPath = path.join(repoRoot, "schemas", "expected-diff.schema.json");
  const diffSchema = JSON.parse(readFileSync(diffSchemaPath, "utf8")) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validateDiff = ajv.compile(diffSchema);
  for (const relative of [
    "packages/fixtures/04-diff-coalescing/expected/raw-diff.json",
    "packages/fixtures/04-diff-coalescing/expected/coalesced-diff.json"
  ]) {
    const raw = JSON.parse(readFileSync(path.join(repoRoot, relative), "utf8")) as unknown;
    if (!validateDiff(raw)) {
      errors.push(
        `${relative}: fails expected-diff schema: ${(validateDiff.errors ?? [])
          .map((e) => `${e.instancePath || "/"}: ${e.message ?? "invalid"}`)
          .join("; ")}`
      );
    }
  }

  return errors;
}
