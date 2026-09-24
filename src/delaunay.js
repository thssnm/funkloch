/**
 * Irregular planar graphs: scattered points, Delaunay triangulation, then a
 * thinning pass.
 *
 * Why not a lattice: a regular grid gives almost every node the same degree, so
 * almost every ball has the same size, and the exact-cover sum rule then has
 * nothing to bite on. A Delaunay triangulation of scattered points has degrees
 * from 2 to 7, which at radius 1 means ball sizes from 3 to 8 — real spread,
 * without needing a bigger board.
 *
 * Planarity is by construction here too: a Delaunay triangulation of points in
 * general position has no crossing edges, and removing edges cannot introduce
 * one. As with the lattices there is deliberately no crossing test in this
 * file; the tests verify the claim independently.
 */

/** @typedef {{x: number, y: number}} Point */

/** Rounds to 2 decimals so coordinates survive a JSON round-trip unchanged. */
const round2 = (value) => Math.round(value * 100) / 100;

/**
 * Scatters `count` points with a minimum separation, by dart throwing.
 * @param {() => number} rng
 * @param {{count: number, spacing?: number, separation?: number}} options
 *   `separation` is a fraction of `spacing`; below it, points are rejected.
 * @returns {Point[]|null} null when the area could not take that many points
 */
export function scatteredPoints(rng, { count, spacing = 60, separation = 0.72 }) {
  if (!Number.isInteger(count) || count < 3) {
    throw new RangeError(`count must be an integer >= 3, got ${count}`);
  }
  const side = Math.ceil(Math.sqrt(count)) * spacing;
  const minimum = (spacing * separation) ** 2;
  const points = [];

  for (let attempt = 0; attempt < count * 400 && points.length < count; attempt++) {
    const point = { x: rng() * side, y: rng() * side };
    if (points.every((other) => (other.x - point.x) ** 2 + (other.y - point.y) ** 2 >= minimum)) {
      points.push(point);
    }
  }
  return points.length === count ? points.map((p) => ({ x: round2(p.x), y: round2(p.y) })) : null;
}

/**
 * Circumcircle of a triangle, or null when the three points are collinear.
 * @param {Point} a
 * @param {Point} b
 * @param {Point} c
 * @returns {{x: number, y: number, r2: number}|null}
 */
function circumcircle(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const aa = a.x * a.x + a.y * a.y;
  const bb = b.x * b.x + b.y * b.y;
  const cc = c.x * c.x + c.y * c.y;
  const x = (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d;
  const y = (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d;
  return { x, y, r2: (a.x - x) ** 2 + (a.y - y) ** 2 };
}

/**
 * Delaunay triangulation by Bowyer-Watson.
 *
 * Points are inserted one at a time. Every triangle whose circumcircle swallows
 * the new point is removed, which leaves a star-shaped hole; the hole's
 * boundary is exactly the edges that appeared only once among the removed
 * triangles, and joining the new point to each of them re-triangulates it.
 *
 * @param {Point[]} points
 * @returns {Array<[number, number, number]>} triangles as point indices
 */
export function triangulate(points) {
  if (points.length < 3) return [];

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const reach = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;

  // A triangle large enough to contain every point; dropped again at the end.
  const all = [
    ...points,
    { x: midX - 20 * reach, y: midY - reach },
    { x: midX, y: midY + 20 * reach },
    { x: midX + 20 * reach, y: midY - reach },
  ];
  const first = points.length;
  let triangles = [[first, first + 1, first + 2]];

  for (let index = 0; index < points.length; index++) {
    const point = all[index];
    const kept = [];
    const boundary = new Map();

    for (const triangle of triangles) {
      const circle = circumcircle(all[triangle[0]], all[triangle[1]], all[triangle[2]]);
      const swallowed =
        circle !== null && (point.x - circle.x) ** 2 + (point.y - circle.y) ** 2 < circle.r2 - 1e-9;
      if (!swallowed) {
        kept.push(triangle);
        continue;
      }
      const [a, b, c] = triangle;
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        const key = u < v ? `${u},${v}` : `${v},${u}`;
        boundary.set(key, (boundary.get(key) ?? 0) + 1);
      }
    }

    triangles = kept;
    for (const [key, times] of boundary) {
      if (times !== 1) continue; // shared by two removed triangles: interior
      const [u, v] = key.split(',').map(Number);
      triangles.push([u, v, index]);
    }
  }

  return triangles.filter((triangle) => triangle.every((index) => index < points.length));
}

/**
 * Builds an irregular planar graph: scattered points, triangulated, with the
 * long boundary slivers a triangulation always produces trimmed away.
 *
 * @param {object} options
 * @param {number} options.points how many points to scatter
 * @param {number} [options.spacing=60]
 * @param {number} [options.maxEdge=1.9] longest edge to keep, in units of
 *   `spacing`. A raw triangulation spans its convex hull with long thin
 *   triangles; dropping those keeps the graph local and readable.
 * @param {() => number} options.rng
 * @returns {{nodes: Array<{id: string, x: number, y: number}>, edges: Array<[string, string]>}|null}
 */
export function delaunayGraph({ points, spacing = 60, maxEdge = 1.9, rng }) {
  const scattered = scatteredPoints(rng, { count: points, spacing });
  if (scattered === null) return null;

  const nodes = scattered.map((point, index) => ({ id: `p${index}`, x: point.x, y: point.y }));
  const limit = (maxEdge * spacing) ** 2;
  const seen = new Set();
  const edges = [];

  for (const triangle of triangulate(scattered)) {
    const [a, b, c] = triangle;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? `${u},${v}` : `${v},${u}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const from = scattered[u];
      const to = scattered[v];
      if ((from.x - to.x) ** 2 + (from.y - to.y) ** 2 > limit) continue;
      edges.push(u < v ? [nodes[u].id, nodes[v].id] : [nodes[v].id, nodes[u].id]);
    }
  }

  return { nodes, edges };
}
