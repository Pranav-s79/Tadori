import type { GraphEdge, GraphNode } from "@tadori/core";

/**
 * Boundary rules (09-03). A repository-root `tadori.rules.json` declares
 * allow/deny dependency statements between path globs; violations are computed
 * deterministically over a snapshot's import/call edges, evidence-backed.
 *
 * Lives in @tadori/store so the server route AND the harness fixture check
 * consume one implementation (same layering lesson as coalescing).
 */

export type BoundarySeverity = "warning" | "error";

/** One boundary rule: files under `from` must not depend on files under any `deny` glob. */
export interface BoundaryRule {
  id: string;
  from: string;
  deny: string[];
  /** Optional per-rule severity; defaults to "error". */
  severity?: BoundarySeverity;
}

export interface BoundaryRules {
  boundaries: BoundaryRule[];
}

/** A detected violation, shaped to match the fixture oracle's expectedBoundaryViolations. */
export interface BoundaryViolation {
  ruleId: string;
  /** `file:<normalizedPath>` — the fixture id form. */
  src: string;
  edgeRelation: "imports" | "calls";
  dst: string;
  severity: BoundarySeverity;
  evidence: GraphEdge["evidence"];
}

/** Relations a boundary rule can be violated through (a dependency edge). */
const BOUNDARY_RELATIONS = new Set(["imports", "calls"]);

/**
 * Compile a `tadori.rules.json` glob to a matcher over normalized repo-relative
 * paths. Supports `**` (any path segments, including `/`), `*` (any run of
 * non-`/` characters), and literal segments — the subset the fixtures use.
 * Anchored full-match (a rule glob must match the whole path).
 */
export function globToRegExp(glob: string): RegExp {
  let re = "^";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**` → any characters including `/`; consume a following `/` so
        // `a/**/b` matches `a/b` too.
        i += 1;
        if (glob[i + 1] === "/") {
          i += 1;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*"; // single `*` → within one path segment
      }
    } else if (".+?^${}()|[]\\".includes(c ?? "")) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  re += "$";
  return new RegExp(re);
}

/**
 * Validate + normalize a parsed `tadori.rules.json` object. Throws on a
 * malformed shape (missing id/from, non-array deny) rather than silently
 * dropping rules — a boundary rule that silently doesn't apply is worse than a
 * loud error.
 */
export function parseBoundaryRules(raw: unknown): BoundaryRules {
  if (raw === null || typeof raw !== "object" || !Array.isArray((raw as { boundaries?: unknown }).boundaries)) {
    throw new Error("tadori.rules.json: expected an object with a `boundaries` array");
  }
  const boundaries = (raw as { boundaries: unknown[] }).boundaries.map((entry, index) => {
    if (entry === null || typeof entry !== "object") {
      throw new Error(`tadori.rules.json: boundary[${index}] is not an object`);
    }
    const rule = entry as Record<string, unknown>;
    if (typeof rule.id !== "string" || rule.id.length === 0) {
      throw new Error(`tadori.rules.json: boundary[${index}] missing string \`id\``);
    }
    if (typeof rule.from !== "string" || rule.from.length === 0) {
      throw new Error(`tadori.rules.json: boundary[${index}] missing string \`from\``);
    }
    if (!Array.isArray(rule.deny) || rule.deny.some((d) => typeof d !== "string")) {
      throw new Error(`tadori.rules.json: boundary[${index}] \`deny\` must be an array of strings`);
    }
    const severity: BoundarySeverity =
      rule.severity === "warning" || rule.severity === "error" ? rule.severity : "error";
    return { id: rule.id, from: rule.from, deny: rule.deny as string[], severity };
  });
  return { boundaries };
}

/**
 * Compute boundary violations over a snapshot's nodes+edges. For each
 * import/call edge whose source file matches a rule's `from` glob and whose
 * destination file matches one of that rule's `deny` globs, emit one violation
 * carrying the edge's evidence verbatim. Deterministic: sorted by
 * (ruleId, src, dst) so output is byte-stable across runs and OSes.
 */
export function computeBoundaryViolations(
  rules: BoundaryRules,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[]
): BoundaryViolation[] {
  if (rules.boundaries.length === 0) {
    return [];
  }
  const fileByKey = new Map<string, string>();
  for (const node of nodes) {
    if (node.file !== null) {
      fileByKey.set(node.entityKey, node.file);
    }
  }
  // Pre-compile globs once.
  const compiled = rules.boundaries.map((rule) => ({
    rule,
    from: globToRegExp(rule.from),
    deny: rule.deny.map((g) => globToRegExp(g))
  }));

  const violations: BoundaryViolation[] = [];
  for (const edge of edges) {
    if (!BOUNDARY_RELATIONS.has(edge.relation)) {
      continue;
    }
    const srcFile = fileByKey.get(edge.srcEntityKey);
    const dstFile = fileByKey.get(edge.dstEntityKey);
    if (srcFile === undefined || dstFile === undefined) {
      continue;
    }
    for (const { rule, from, deny } of compiled) {
      if (!from.test(srcFile)) {
        continue;
      }
      if (deny.some((d) => d.test(dstFile))) {
        violations.push({
          ruleId: rule.id,
          src: `file:${srcFile}`,
          edgeRelation: edge.relation as "imports" | "calls",
          dst: `file:${dstFile}`,
          severity: rule.severity ?? "error",
          evidence: edge.evidence
        });
      }
    }
  }
  violations.sort((a, b) => {
    const ka = `${a.ruleId} ${a.src} ${a.dst}`;
    const kb = `${b.ruleId} ${b.src} ${b.dst}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return violations;
}
