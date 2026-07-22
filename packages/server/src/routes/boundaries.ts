import { readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { computeBoundaryViolations, parseBoundaryRules, type BoundaryRules } from "@tadori/store";
import { badRequest } from "../errors.js";
import type { BoundariesDto } from "../types.js";

/**
 * Boundary violations (09-03). Reads the repository-root `tadori.rules.json`
 * (absent → no rules, empty violations — NOT an error), parses it, and computes
 * violations over the served active snapshot's import/call edges. Deterministic;
 * evidence-backed per the store's computeBoundaryViolations.
 *
 * A malformed rules file is a 400 (`bad_rules`) with the parser's message — an
 * operator-actionable config error, never a silent empty result that would hide
 * a broken boundary policy.
 */
function loadRules(repoRoot: string): BoundaryRules | null {
  const filePath = path.join(repoRoot, "tadori.rules.json");
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return null; // no rules file → no boundaries declared
  }
  return parseBoundaryRules(JSON.parse(raw));
}

export async function registerBoundaryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/boundaries", async (_request: FastifyRequest, reply: FastifyReply) => {
    const service = app.graphState.current();
    let rules: BoundaryRules | null;
    try {
      rules = loadRules(service.repoRoot);
    } catch (err) {
      const { statusCode, payload } = badRequest("bad_rules", err instanceof Error ? err.message : String(err));
      return reply.code(statusCode).send(payload);
    }
    const violations =
      rules === null ? [] : computeBoundaryViolations(rules, service.graph.nodes, service.graph.edges);
    const body: BoundariesDto = {
      rulesPresent: rules !== null,
      violations
    };
    return reply.send(body);
  });
}
