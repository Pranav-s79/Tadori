/** Machine-variance benchmark; CI-excluded. */
import { create150kCorpus, removeCorpus, startServe } from "./lib/serveBenchmark.mts";

type Level = "package" | "file" | "symbol";
interface Position { entityKey: string; x: number; y: number; z: number; pinned: boolean }
const levels: readonly Level[] = ["package", "file", "symbol"];
const corpus = create150kCorpus("tadori-serve-positions-");

async function cycle(): Promise<Record<Level, Position[]>> {
  const serve = await startServe(corpus.root);
  try {
    const entries = await Promise.all(levels.map(async (level) => {
      const response = await fetch(`${serve.url}api/v1/layout?level=${level}`);
      if (!response.ok) throw new Error(`Layout ${level} failed: HTTP ${String(response.status)}`);
      const body = await response.json() as { positions: Position[] };
      return [level, body.positions] as const;
    }));
    return Object.fromEntries(entries) as Record<Level, Position[]>;
  } finally {
    await serve.stop();
  }
}

try {
  const first = await cycle();
  const second = await cycle();
  const result = levels.map((level) => {
    const before = new Map(first[level].map((position) => [position.entityKey, position]));
    const after = new Map(second[level].map((position) => [position.entityKey, position]));
    const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
    const mismatches = keys.flatMap((entityKey) => {
      const left = before.get(entityKey);
      const right = after.get(entityKey);
      if (left !== undefined && right !== undefined
        && Object.is(left.x, right.x) && Object.is(left.y, right.y) && Object.is(left.z, right.z)
        && left.pinned === right.pinned) return [];
      return [{ entityKey, cycle1: left ?? null, cycle2: right ?? null }];
    });
    return { level, positions: first[level].length, mismatches };
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const mismatchCount = result.reduce((sum, level) => sum + level.mismatches.length, 0);
  if (mismatchCount !== 0) throw new Error(`Layout identity found ${String(mismatchCount)} mismatch(es)`);
} finally {
  removeCorpus(corpus);
}
