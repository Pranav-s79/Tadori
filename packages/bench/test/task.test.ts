import { describe, expect, it } from "vitest";
import { parseTaskSet, seededTraps, type BenchTask } from "../src/index.js";

function task(over: Partial<BenchTask> & { id: string }): BenchTask {
  return {
    prompt: "do the thing",
    corpus: "corpus-a",
    successCommand: "pnpm test",
    isSeededTrap: false,
    ...over
  } as BenchTask;
}

describe("parseTaskSet", () => {
  it("parses a well-formed set with a trap and a non-trap task", () => {
    const set = parseTaskSet({
      name: "suite-1",
      tasks: [
        task({ id: "t1" }),
        task({ id: "t2", isSeededTrap: true, trapKind: "boundary_violation" })
      ]
    });
    expect(set.tasks).toHaveLength(2);
    expect(seededTraps(set).map((t) => t.id)).toEqual(["t2"]);
  });

  it("rejects a trap task with no trapKind (invariant: trapKind iff isSeededTrap)", () => {
    expect(() =>
      parseTaskSet({ name: "s", tasks: [task({ id: "t1", isSeededTrap: true })] })
    ).toThrow();
  });

  it("rejects a non-trap task that carries a trapKind", () => {
    expect(() =>
      parseTaskSet({
        name: "s",
        tasks: [task({ id: "t1", isSeededTrap: false, trapKind: "unsupported_claim" })]
      })
    ).toThrow();
  });

  it("rejects an unknown trapKind", () => {
    expect(() =>
      parseTaskSet({
        name: "s",
        // @ts-expect-error deliberately invalid trap kind
        tasks: [task({ id: "t1", isSeededTrap: true, trapKind: "not_a_real_trap" })]
      })
    ).toThrow();
  });

  it("rejects duplicate task ids within a set", () => {
    expect(() =>
      parseTaskSet({ name: "s", tasks: [task({ id: "dup" }), task({ id: "dup" })] })
    ).toThrow();
  });

  it("rejects an empty task set and a missing successCommand", () => {
    expect(() => parseTaskSet({ name: "s", tasks: [] })).toThrow();
    expect(() =>
      parseTaskSet({ name: "s", tasks: [{ ...task({ id: "t1" }), successCommand: "" }] })
    ).toThrow();
  });

  it("rejects unknown extra fields on a task (strict)", () => {
    expect(() =>
      parseTaskSet({ name: "s", tasks: [{ ...task({ id: "t1" }), sneaky: 1 }] })
    ).toThrow();
  });
});

describe("seededTraps", () => {
  it("returns only the seeded-trap tasks", () => {
    const set = parseTaskSet({
      name: "s",
      tasks: [
        task({ id: "a" }),
        task({ id: "b", isSeededTrap: true, trapKind: "hidden_dynamic_dispatch" }),
        task({ id: "c", isSeededTrap: true, trapKind: "stale_doc_drift" })
      ]
    });
    expect(seededTraps(set).map((t) => t.id)).toEqual(["b", "c"]);
  });
});
