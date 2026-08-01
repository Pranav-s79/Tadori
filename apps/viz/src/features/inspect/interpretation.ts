import type { NodeDetail, ToolEdge } from "./inspectApi.ts";

/**
 * Deterministic readings of structural facts.
 *
 * Every sentence here is derived from counts and relations the panel already
 * shows beside it. Nothing consults a model, and nothing reads intent from a
 * name. The hard rule: fan-in zero means no incoming relation was *extracted
 * in this snapshot*, never that nothing calls the entity at runtime — Tadori
 * observes structure, not execution.
 */

/** A reading the reader can check against the metric printed next to it. */
export interface Interpretation {
  /** Metric this sentence explains, matching the label shown in the panel. */
  metric: string;
  sentence: string;
}

const ENTRY_KINDS = new Set(["route", "test"]);

function isUnresolved(edge: ToolEdge): boolean {
  return edge.resolution === "unresolved";
}

/**
 * One sentence per structural metric, or none. Silence is correct when the
 * numbers speak for themselves; a sentence restating "2 incoming references"
 * as "two things depend on this" is noise, not interpretation.
 */
export function structuralInterpretation(node: NodeDetail): Interpretation[] {
  const readings: Interpretation[] = [];
  const dependents = node.inEdges.length;
  const dependencies = node.outEdges.length;

  if (node.fanIn === 0 && ENTRY_KINDS.has(node.kind)) {
    readings.push({
      metric: "Fan-in",
      sentence: `Nothing in the extracted graph directly references this ${node.kind}; `
        + "it appears to be an entry point rather than a shared dependency."
    });
  } else if (node.fanIn === 0) {
    readings.push({
      metric: "Fan-in",
      sentence: "No incoming relation was extracted in this snapshot. That is not "
        + "evidence nothing calls it at runtime — dynamic dispatch and reflection "
        + "are not extracted."
    });
  } else if (node.fanIn >= 5) {
    readings.push({
      metric: "Fan-in",
      sentence: `${String(node.fanIn)} extracted entities depend on this, so changes here `
        + "may have a wider impact than the file suggests."
    });
  }

  if (dependencies >= 5) {
    readings.push({
      metric: "Fan-out",
      sentence: `It reaches ${String(dependencies)} other entities, so it appears to sit `
        + "at a coordination point rather than a leaf."
    });
  }

  const unresolved = [...node.inEdges, ...node.outEdges].filter(isUnresolved).length;
  if (unresolved > 0) {
    readings.push({
      metric: "Connections",
      sentence: `${String(unresolved)} of its relations could not be statically resolved, `
        + "so the picture here is incomplete."
    });
  }

  if (dependents > 0 && dependencies === 0) {
    readings.push({
      metric: "Dependency position",
      sentence: "It is depended upon but reaches nothing further, which appears "
        + "to place it at a boundary of the extracted graph."
    });
  }

  return readings;
}

/**
 * Responsibility is `observed` only where structure states it mechanically —
 * a route's registered path, a test's registration. A name alone is never
 * converted into a factual claim about what something does.
 */
export function responsibilityOf(node: NodeDetail): { text: string; observed: boolean } {
  if (node.kind === "route") {
    return {
      text: `Handles the registered request path \`${node.displayName}\`.`,
      observed: true
    };
  }
  if (node.kind === "test") {
    return { text: `Registered as a test in ${node.file ?? "an unrecorded file"}.`, observed: true };
  }
  return {
    text: "Unknown from the available repository evidence. Tadori does not read "
      + "responsibility from a name.",
    observed: false
  };
}

/**
 * Risks name the signal, never a verdict. "Five dependents increase the change
 * surface" is a fact about the graph; "this component is fragile" is not.
 */
export function inferredRisks(node: NodeDetail): string[] {
  const risks: string[] = [];
  const unresolved = [...node.inEdges, ...node.outEdges].filter(isUnresolved).length;

  if (node.fanIn >= 5) {
    risks.push(`${String(node.fanIn)} extracted dependents increase the potential change surface.`);
  }
  if (node.outEdges.length >= 5) {
    risks.push(`It depends on ${String(node.outEdges.length)} other entities, widening what can break it.`);
  }
  if (unresolved > 0) {
    risks.push(`${String(unresolved)} unresolved relation(s) mean parts of its behaviour were not extracted.`);
  }
  if (node.kind === "external_dep") {
    risks.push("It is an external dependency, so its behaviour is outside this repository.");
  }
  return risks;
}
