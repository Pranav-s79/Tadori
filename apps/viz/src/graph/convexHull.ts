export interface Point {
  x: number;
  y: number;
}

export interface HullShape {
  kind: "hull";
  points: Point[];
}

export interface CircleShape {
  kind: "circle";
  center: Point;
  radius: number;
}

export type HullResult = HullShape | CircleShape;

/**
 * Cross product of OA x OB, used to determine turn direction
 * (positive = counter-clockwise, negative = clockwise, zero = collinear).
 */
function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Convex hull via Andrew's monotone chain algorithm, O(n log n).
 * Packages with fewer than 3 (distinct) points don't form a polygon, so
 * callers get a labeled circle shape instead (radius 0 for a single point)
 * and can render a circle rather than degenerate to a zero-area hull.
 */
export function convexHull(points: readonly Point[]): HullResult {
  const unique = dedupe(points);

  if (unique.length === 0) {
    return { kind: "circle", center: { x: 0, y: 0 }, radius: 0 };
  }
  if (unique.length === 1) {
    return { kind: "circle", center: unique[0]!, radius: 0 };
  }
  if (unique.length === 2) {
    return { kind: "circle", center: midpoint(unique[0]!, unique[1]!), radius: distance(unique[0]!, unique[1]!) / 2 };
  }

  const sorted = [...unique].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  // All points collinear -> no polygon area; fall back to a circle spanning
  // the extremes so callers still get a renderable shape.
  if (sorted.every((p) => cross(sorted[0]!, sorted[sorted.length - 1]!, p) === 0)) {
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    return { kind: "circle", center: midpoint(first, last), radius: distance(first, last) / 2 };
  }

  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  // Last point of each list is the first point of the other; drop the dupes.
  lower.pop();
  upper.pop();

  return { kind: "hull", points: [...lower, ...upper] };
}

/** How many typical distances out a member must sit to be drawn as an outlier. */
const OUTLIER_FACTOR = 4;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Splits a package's member points into the core a drawn boundary should hug
 * and the few far-off members that would stretch it into a spike. A member is
 * an outlier when it sits more than four typical distances (the median
 * distance to the median centre) from the rest. Medians, so the outliers
 * cannot move the yardstick. Fewer than four points are all core. The layout
 * is never changed: outliers are still members, drawn tethered to the core.
 */
export function partitionOutliers<T extends Point>(points: readonly T[]): { core: T[]; outliers: T[] } {
  if (points.length < 4) return { core: [...points], outliers: [] };
  const centre = { x: median(points.map((point) => point.x)), y: median(points.map((point) => point.y)) };
  const typical = median(points.map((point) => distance(point, centre)));
  if (typical === 0) return { core: [...points], outliers: [] };
  const core: T[] = [];
  const outliers: T[] = [];
  for (const point of points) (distance(point, centre) > OUTLIER_FACTOR * typical ? outliers : core).push(point);
  return { core, outliers };
}

/** The point of `candidates` closest to `target` (for an outlier's tether). */
export function nearestPoint(candidates: readonly Point[], target: Point): Point | undefined {
  let best: Point | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const d = distance(candidate, target);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

function dedupe(points: readonly Point[]): Point[] {
  const seen = new Set<string>();
  const result: Point[] = [];
  for (const p of points) {
    const key = `${p.x},${p.y}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(p);
    }
  }
  return result;
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
