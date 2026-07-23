import { describe, expect, it } from "vitest";
import type { Origin } from "../../api/types.ts";
import type { ExploreNode } from "./exploreApi.ts";
import { deriveMethodLabel, pathSourceLabel } from "./routeLabels.ts";

function routeNode(signature: string | null, name = "handler"): ExploreNode {
  return {
    entityKey: "k",
    kind: "route",
    qualifiedName: name,
    displayName: name,
    file: null,
    signature
  };
}

describe("pathSourceLabel", () => {
  const cases: [Origin, string][] = [
    ["compiler", "path source: direct"],
    ["heuristic", "path source: derived (heuristic)"],
    ["doc", "path source: documented, not code-extracted"],
    ["git", "path source: derived from history"],
    ["human", "path source: human-annotated"],
    ["llm", "path source: LLM-derived"]
  ];
  it.each(cases)("maps origin %s to its documented label", (origin, label) => {
    expect(pathSourceLabel(origin)).toBe(label);
  });
});

describe("deriveMethodLabel", () => {
  it("reads an Express method off the signature", () => {
    expect(deriveMethodLabel(routeNode('app.get("/users/:id", handler)'))).toBe("GET");
    expect(deriveMethodLabel(routeNode('router.post("/users", handler)'))).toBe("POST");
  });

  it("reads a Next.js route-handler export", () => {
    expect(deriveMethodLabel(routeNode("export async function DELETE(req)"))).toBe("DELETE");
  });

  it("returns 'unknown' — never blank, never a guess — when unrecognizable", () => {
    expect(deriveMethodLabel(routeNode("some unrelated signature"))).toBe("unknown");
    expect(deriveMethodLabel(routeNode(null))).toBe("unknown");
  });
});
