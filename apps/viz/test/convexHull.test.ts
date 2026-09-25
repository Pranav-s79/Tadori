import { describe, expect, it } from "vitest";
import { convexHull, nearestPoint, partitionOutliers, type Point } from "../src/graph/convexHull.ts";

/** Sort points for order-independent hull comparison (rotation-agnostic). */
function normalize(points: Point[]): Point[] {
  return [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
}

describe("convexHull", () => {
  it("returns a circle fallback for 0 points", () => {
    const result = convexHull([]);
    expect(result).toEqual({ kind: "circle", center: { x: 0, y: 0 }, radius: 0 });
  });

  it("returns a zero-radius circle fallback for 1 point", () => {
    const result = convexHull([{ x: 5, y: 7 }]);
    expect(result).toEqual({ kind: "circle", center: { x: 5, y: 7 }, radius: 0 });
  });

  it("returns a circle fallback spanning 2 points", () => {
    const result = convexHull([
      { x: 0, y: 0 },
      { x: 10, y: 0 }
    ]);
    expect(result).toEqual({ kind: "circle", center: { x: 5, y: 0 }, radius: 5 });
  });

  it("returns a circle fallback for 2 identical points (dedupe collapses to 1)", () => {
    const result = convexHull([
      { x: 3, y: 3 },
      { x: 3, y: 3 }
    ]);
    expect(result).toEqual({ kind: "circle", center: { x: 3, y: 3 }, radius: 0 });
  });

  it("computes the known hull of a square with an interior point", () => {
    // Interior point (5,5) must NOT appear in the hull.
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 }
    ];
    const result = convexHull(points);
    expect(result.kind).toBe("hull");
    if (result.kind !== "hull") return;
    expect(normalize(result.points)).toEqual(
      normalize([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 }
      ])
    );
  });

  it("computes the known hull of a triangle (all 3 points are the hull)", () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 2, y: 4 }
    ];
    const result = convexHull(points);
    expect(result.kind).toBe("hull");
    if (result.kind !== "hull") return;
    expect(normalize(result.points)).toEqual(normalize(points));
  });

  it("excludes collinear boundary points that lie between two hull vertices", () => {
    // (5,0) lies exactly on the segment from (0,0) to (10,0); monotone
    // chain with a <=0 cross-product pop excludes strictly-between
    // collinear points from the hull.
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ];
    const result = convexHull(points);
    expect(result.kind).toBe("hull");
    if (result.kind !== "hull") return;
    expect(result.points).not.toContainEqual({ x: 5, y: 0 });
    expect(normalize(result.points)).toEqual(
      normalize([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 }
      ])
    );
  });

  it("falls back to a circle when all points are collinear", () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 }
    ];
    const result = convexHull(points);
    expect(result).toEqual({ kind: "circle", center: { x: 5, y: 0 }, radius: 5 });
  });

  it("produces a hull polygon whose vertex count is at most the input size", () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 3, y: 1 },
      { x: 6, y: 0 },
      { x: 6, y: 6 },
      { x: 3, y: 5 },
      { x: 0, y: 6 },
      { x: 3, y: 3 }
    ];
    const result = convexHull(points);
    expect(result.kind).toBe("hull");
    if (result.kind !== "hull") return;
    expect(result.points.length).toBeLessThanOrEqual(points.length);
    expect(result.points).not.toContainEqual({ x: 3, y: 3 });
  });
});

describe("partitionOutliers", () => {
  // Fixture 02's shape: a cluster of files and one test file served far away.
  const cluster: Point[] = [
    { x: 25, y: -28 }, { x: -18, y: -19 }, { x: 21, y: 28 }, { x: 9, y: 38 },
    { x: 4, y: 58 }, { x: 4, y: -33 }, { x: -9, y: 16 }, { x: -29, y: -14 }
  ];
  const far: Point = { x: 5, y: -364 };

  it("keeps a far-off member out of the drawn core, and only that member", () => {
    const { core, outliers } = partitionOutliers([...cluster, far]);
    expect(outliers).toEqual([far]);
    expect(core).toEqual(cluster);
  });

  it("treats an evenly spread package as all core", () => {
    expect(partitionOutliers(cluster).outliers).toEqual([]);
  });

  it("does not judge fewer than four members, or members that coincide", () => {
    expect(partitionOutliers([{ x: 0, y: 0 }, { x: 1, y: 0 }, far]).outliers).toEqual([]);
    const same = Array.from({ length: 5 }, () => ({ x: 2, y: 2 }));
    expect(partitionOutliers(same).outliers).toEqual([]);
  });

  it("finds the closest point to tether an outlier to", () => {
    expect(nearestPoint(cluster, far)).toEqual({ x: 4, y: -33 });
    expect(nearestPoint([], far)).toBeUndefined();
  });
});
