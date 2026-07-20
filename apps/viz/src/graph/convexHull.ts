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
