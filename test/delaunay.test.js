import test from 'node:test';
import assert from 'node:assert/strict';

import { delaunayGraph, scatteredPoints, triangulate } from '../src/delaunay.js';
import { generateCandidate, mulberry32, TOPOLOGIES } from '../src/generator.js';
import { bfsWithin, validateGraph } from '../src/graph.js';

// ---------------------------------------------------------------------------
// Independent planarity check, as for the lattices: the generator claims
// planarity by construction and contains no crossing test, so one lives here.
// ---------------------------------------------------------------------------

const turn = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));

const onSegment = (p, q, r) =>
  Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x) &&
  Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);

function segmentsIntersect(a1, a2, b1, b2) {
  const d1 = turn(a1, a2, b1);
  const d2 = turn(a1, a2, b2);
  const d3 = turn(b1, b2, a1);
  const d4 = turn(b1, b2, a2);
  if (d1 !== d2 && d3 !== d4) return true;
  if (d1 === 0 && onSegment(a1, b1, a2)) return true;
  if (d2 === 0 && onSegment(a1, b2, a2)) return true;
  if (d3 === 0 && onSegment(b1, a1, b2)) return true;
  if (d4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
}

function assertPlanar(graph, label) {
  const pos = new Map(graph.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
  for (let i = 0; i < graph.edges.length; i++) {
    for (let j = i + 1; j < graph.edges.length; j++) {
      const [a1, a2] = graph.edges[i];
      const [b1, b2] = graph.edges[j];
      if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
      assert.ok(
        !segmentsIntersect(pos.get(a1), pos.get(a2), pos.get(b1), pos.get(b2)),
        `${label}: edges ${a1}-${a2} and ${b1}-${b2} cross`,
      );
    }
  }
}

const degrees = (graph) => {
  const degree = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const [a, b] of graph.edges) {
    degree.set(a, degree.get(a) + 1);
    degree.set(b, degree.get(b) + 1);
  }
  return [...degree.values()];
};

const isConnected = (graph) => {
  const adjacent = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const [a, b] of graph.edges) {
    adjacent.get(a).push(b);
    adjacent.get(b).push(a);
  }
  const seen = new Set([graph.nodes[0].id]);
  const queue = [graph.nodes[0].id];
  while (queue.length > 0) {
    for (const next of adjacent.get(queue.pop())) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen.size === graph.nodes.length;
};

test('scatteredPoints', async (t) => {
  await t.test('places the requested number, kept apart', () => {
    const points = scatteredPoints(mulberry32(1), { count: 40, spacing: 60 });
    assert.equal(points.length, 40);
    const minimum = (60 * 0.72) ** 2;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const distance = (points[i].x - points[j].x) ** 2 + (points[i].y - points[j].y) ** 2;
        assert.ok(distance >= minimum - 1e-6, `points ${i} and ${j} are too close`);
      }
    }
  });

  await t.test('is deterministic and JSON-stable', () => {
    const a = scatteredPoints(mulberry32(9), { count: 25 });
    const b = scatteredPoints(mulberry32(9), { count: 25 });
    assert.deepEqual(a, b);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  });

  await t.test('rejects impossible requests', () => {
    assert.throws(() => scatteredPoints(mulberry32(1), { count: 2 }), RangeError);
    // Far too many points for the area: dart throwing gives up rather than loop.
    assert.equal(scatteredPoints(mulberry32(1), { count: 30, separation: 3 }), null);
  });
});

test('triangulate', async (t) => {
  await t.test('covers a simple square with two triangles', () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const triangles = triangulate(square);
    assert.equal(triangles.length, 2);
    for (const triangle of triangles) {
      assert.equal(new Set(triangle).size, 3, 'a triangle must use three distinct points');
      for (const index of triangle) assert.ok(index >= 0 && index < square.length);
    }
  });

  await t.test('handles degenerate input without throwing', () => {
    assert.deepEqual(triangulate([]), []);
    assert.deepEqual(triangulate([{ x: 0, y: 0 }, { x: 1, y: 1 }]), []);
  });

  await t.test('uses every point it is given', () => {
    const points = scatteredPoints(mulberry32(4), { count: 30 });
    const used = new Set(triangulate(points).flat());
    assert.equal(used.size, points.length, 'every point should end up in a triangle');
  });
});

test('delaunayGraph', async (t) => {
  await t.test('is planar across many seeds', () => {
    for (let seed = 0; seed < 30; seed++) {
      const graph = delaunayGraph({ points: 35, rng: mulberry32(seed) });
      assert.ok(graph !== null);
      assertPlanar(graph, `delaunay seed=${seed}`);
    }
  });

  await t.test('is planar for small and large point sets alike', () => {
    for (const points of [6, 12, 60, 90]) {
      const graph = delaunayGraph({ points, rng: mulberry32(points) });
      assertPlanar(graph, `delaunay points=${points}`);
      assert.equal(graph.nodes.length, points);
    }
  });

  await t.test('produces the irregular degrees a lattice cannot', () => {
    const graph = delaunayGraph({ points: 40, rng: mulberry32(5) });
    const spread = degrees(graph);
    assert.ok(Math.min(...spread) >= 1, 'no stranded points');
    assert.ok(Math.max(...spread) >= 6, `expected high-degree nodes, max was ${Math.max(...spread)}`);
    assert.ok(new Set(spread).size >= 5, `expected varied degrees, got ${new Set(spread).size} values`);

    // Which is the whole point: varied degrees mean varied ball sizes.
    const balls = graph.nodes.map((node) => bfsWithin(graph, node.id, 1).length);
    assert.ok(new Set(balls).size >= 5, `expected varied ball sizes, got ${new Set(balls).size}`);
  });

  await t.test('drops the long slivers a raw triangulation leaves at the hull', () => {
    const graph = delaunayGraph({ points: 40, spacing: 60, maxEdge: 1.9, rng: mulberry32(2) });
    const pos = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const [a, b] of graph.edges) {
      const length = Math.hypot(pos.get(a).x - pos.get(b).x, pos.get(a).y - pos.get(b).y);
      assert.ok(length <= 1.9 * 60 + 1e-6, `edge ${a}-${b} is ${length.toFixed(1)} long`);
    }
  });

  await t.test('passes the structural check and is deterministic', () => {
    const graph = delaunayGraph({ points: 30, rng: mulberry32(12) });
    validateGraph(graph);
    assert.deepEqual(delaunayGraph({ points: 30, rng: mulberry32(12) }), graph);
    assert.deepEqual(JSON.parse(JSON.stringify(graph)), graph);
  });
});

test('delaunay as a generator topology', async (t) => {
  await t.test('is offered alongside the lattices', () => {
    assert.deepEqual(TOPOLOGIES, ['rect', 'hex', 'delaunay']);
  });

  await t.test('yields tidy, planar boards of the requested size', () => {
    const rng = mulberry32(77);
    let produced = 0;
    for (let i = 0; i < 30; i++) {
      const graph = generateCandidate({ nodeCount: 18, lattice: 'delaunay', minDegree: 2, rng });
      if (graph === null) continue;
      produced++;
      assert.equal(graph.nodes.length, 18);
      validateGraph(graph);
      assertPlanar(graph, `candidate ${i}`);
      assert.ok(isConnected(graph), `candidate ${i} is disconnected`);
      assert.ok(Math.min(...degrees(graph)) >= 2, `candidate ${i} has a leaf`);
    }
    assert.ok(produced > 10, `expected a usable yield, got ${produced}/30`);
  });

  await t.test('gives a wider spread of ball sizes than a rectangular lattice', () => {
    const distinct = (topology) => {
      const rng = mulberry32(3);
      const seen = [];
      for (let i = 0; i < 20; i++) {
        const graph = generateCandidate({ nodeCount: 24, lattice: topology, minDegree: 2, rng });
        if (graph === null) continue;
        seen.push(new Set(graph.nodes.map((node) => bfsWithin(graph, node.id, 1).length)).size);
      }
      return seen.reduce((sum, value) => sum + value, 0) / seen.length;
    };
    const irregular = distinct('delaunay');
    const rectangular = distinct('rect');
    assert.ok(irregular > rectangular,
      `delaunay averaged ${irregular.toFixed(2)} distinct ball sizes, rect ${rectangular.toFixed(2)}`);
  });
});
