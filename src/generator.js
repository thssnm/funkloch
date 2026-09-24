/**
 * Deterministic level generator.
 *
 * Geometry first: levels are carved out of a lattice, never sampled as an
 * abstract random graph. A lattice with only nearest-neighbour edges is planar
 * by construction, and deleting nodes or edges from a planar graph keeps it
 * planar — so no crossing test is ever needed. Jitter is capped tightly enough
 * (see MAX_JITTER) that moving points cannot introduce a crossing either.
 *
 * Everything is driven by a seeded PRNG; the same seed always yields exactly
 * the same level. No Math.random anywhere.
 */

import { admissibleCandidates, bfsWithin, coverage, forbiddenNodes, requiredNodes, validateGraph } from './graph.js';
import { combinations, findAllSolutions, isUnique } from './solver.js';
import { delaunayGraph } from './delaunay.js';

/** @typedef {import('./graph.js').Graph} Graph */

/**
 * Upper bound for the jitter factor. A point may move by at most
 * `MAX_JITTER * spacing` along each axis. The tightest lattice we build is the
 * triangular one, where the distance from a point to the opposite side of an
 * adjacent triangle is `spacing * sqrt(3)/2 ≈ 0.866`. Two points moving towards
 * each other close at most `2 * 0.2 * sqrt(2) ≈ 0.57` of that — planarity holds.
 */
export const MAX_JITTER = 0.2;

/** Thrown when reject sampling gives up instead of looping forever. */
export class LevelGenerationError extends Error {
  /**
   * @param {string} message
   * @param {object} info attempts and the parameters that were tried
   */
  constructor(message, info = {}) {
    super(message);
    this.name = 'LevelGenerationError';
    Object.assign(this, info);
  }
}

// ---------------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------------

/**
 * mulberry32: a small, fast, seedable 32-bit PRNG.
 * @param {number} seed any integer; only the low 32 bits matter
 * @returns {() => number} function yielding floats in [0, 1)
 */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Integer in [0, bound).
 * @param {() => number} rng
 * @param {number} bound
 * @returns {number}
 */
function randInt(rng, bound) {
  return Math.floor(rng() * bound);
}

/**
 * Fisher-Yates on a copy; never mutates the input.
 * @template T
 * @param {() => number} rng
 * @param {T[]} items
 * @returns {T[]}
 */
export function shuffled(rng, items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Rounds to 2 decimals so generated coordinates survive a JSON round-trip
 * unchanged — determinism has to hold across `JSON.parse(JSON.stringify(x))`.
 * @param {number} value
 * @returns {number}
 */
const round2 = (value) => Math.round(value * 100) / 100;

// ---------------------------------------------------------------------------
// Lattices
// ---------------------------------------------------------------------------

/** Available lattice kinds for `generateLevel`. */
export const LATTICES = ['rect', 'hex'];

/**
 * Everything the exact-cover generator can build on. `delaunay` is not a
 * lattice at all — scattered points, triangulated — and exists because a
 * regular grid hands almost every node the same degree, so almost every ball
 * comes out the same size and the exact-cover sum rule has nothing to work
 * with.
 */
export const TOPOLOGIES = [...LATTICES, 'delaunay'];

/**
 * Rectangular lattice, 4-neighbourhood (right and down). Planar, degree <= 4.
 * @param {{cols: number, rows: number, spacing: number, jitter: number, rng: () => number}} options
 * @returns {Graph}
 */
export function rectLattice({ cols, rows, spacing = 60, jitter = 0.15, rng }) {
  assertLatticeArgs({ cols, rows, spacing, jitter });
  const nodes = [];
  const edges = [];
  const id = (col, row) => `r${row}c${col}`;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      nodes.push({
        id: id(col, row),
        x: round2(col * spacing + jitterOffset(rng, spacing, jitter)),
        y: round2(row * spacing + jitterOffset(rng, spacing, jitter)),
      });
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (col + 1 < cols) edges.push([id(col, row), id(col + 1, row)]);
      if (row + 1 < rows) edges.push([id(col, row), id(col, row + 1)]);
    }
  }
  return { nodes, edges };
}

/**
 * Hexagonally packed lattice (offset rows, "odd-r"), i.e. a triangular mesh:
 * every interior point has up to 6 neighbours. Planar, degree <= 6.
 * @param {{cols: number, rows: number, spacing: number, jitter: number, rng: () => number}} options
 * @returns {Graph}
 */
export function hexLattice({ cols, rows, spacing = 60, jitter = 0.15, rng }) {
  assertLatticeArgs({ cols, rows, spacing, jitter });
  const nodes = [];
  const edges = [];
  const id = (col, row) => `r${row}c${col}`;
  const exists = (col, row) => col >= 0 && col < cols && row >= 0 && row < rows;
  const rowHeight = (spacing * Math.sqrt(3)) / 2;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const offset = (row % 2) * 0.5;
      nodes.push({
        id: id(col, row),
        x: round2((col + offset) * spacing + jitterOffset(rng, spacing, jitter)),
        y: round2(row * rowHeight + jitterOffset(rng, spacing, jitter)),
      });
    }
  }
  for (let row = 0; row < rows; row++) {
    // Only "forward" directions, so every edge is emitted exactly once.
    const down = row % 2 === 0 ? [-1, 0] : [0, 1];
    for (let col = 0; col < cols; col++) {
      if (exists(col + 1, row)) edges.push([id(col, row), id(col + 1, row)]);
      for (const deltaCol of down) {
        if (exists(col + deltaCol, row + 1)) {
          edges.push([id(col, row), id(col + deltaCol, row + 1)]);
        }
      }
    }
  }
  return { nodes, edges };
}

/**
 * @param {{cols: number, rows: number, spacing: number, jitter: number}} options
 */
function assertLatticeArgs({ cols, rows, spacing, jitter }) {
  if (!Number.isInteger(cols) || cols < 1) throw new RangeError(`cols must be a positive integer, got ${cols}`);
  if (!Number.isInteger(rows) || rows < 1) throw new RangeError(`rows must be a positive integer, got ${rows}`);
  if (!Number.isFinite(spacing) || spacing <= 0) throw new RangeError(`spacing must be > 0, got ${spacing}`);
  if (!Number.isFinite(jitter) || jitter < 0 || jitter > MAX_JITTER) {
    throw new RangeError(`jitter must be within [0, ${MAX_JITTER}] to keep the layout planar, got ${jitter}`);
  }
}

/**
 * @param {() => number} rng
 * @param {number} spacing
 * @param {number} jitter
 * @returns {number} offset in [-jitter*spacing, +jitter*spacing)
 */
function jitterOffset(rng, spacing, jitter) {
  return (rng() * 2 - 1) * jitter * spacing;
}

// ---------------------------------------------------------------------------
// Carving a candidate out of a lattice
// ---------------------------------------------------------------------------

/**
 * Mutable working copy of a graph: positions plus an adjacency map.
 * Local to the generator; never handed out.
 * @param {Graph} graph
 */
function toWorkingSet(graph) {
  const pos = new Map(graph.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
  const adj = new Map(graph.nodes.map((node) => [node.id, new Set()]));
  for (const [a, b] of graph.edges) {
    adj.get(a).add(b);
    adj.get(b).add(a);
  }
  return { pos, adj };
}

/** @returns {Graph} a plain graph, node order stable by insertion */
function fromWorkingSet({ pos, adj }) {
  const nodes = [...pos].map(([id, { x, y }]) => ({ id, x, y }));
  const seen = new Set();
  const edges = [];
  for (const [a, neighbours] of adj) {
    for (const b of neighbours) {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(a < b ? [a, b] : [b, a]);
    }
  }
  return { nodes, edges };
}

/** @returns {boolean} true when every node is reachable from any one node */
function isWorkingSetConnected({ adj }) {
  const ids = [...adj.keys()];
  if (ids.length === 0) return true;
  const seen = new Set([ids[0]]);
  const queue = [ids[0]];
  while (queue.length > 0) {
    for (const neighbour of adj.get(queue.pop())) {
      if (seen.has(neighbour)) continue;
      seen.add(neighbour);
      queue.push(neighbour);
    }
  }
  return seen.size === ids.length;
}

/**
 * @param {{adj: Map<*, Set<*>>}} state
 * @param {number} minDegree
 * @returns {boolean} true when every node has at least `minDegree` neighbours
 */
function meetsMinDegree({ adj }, minDegree) {
  for (const neighbours of adj.values()) {
    if (neighbours.size < minDegree) return false;
  }
  return true;
}

/**
 * Carves one candidate out of a fresh lattice: delete nodes down to
 * `nodeCount`, then thin out the edges. Deletions that would disconnect the
 * graph or strand a node are skipped rather than undone.
 *
 * Returns `null` when the candidate is unusable (target size not reached,
 * disconnected, or isolated nodes left over) — the caller just draws again.
 *
 * @param {object} options
 * @param {number} options.nodeCount
 * @param {'rect'|'hex'} options.lattice
 * @param {number} options.spacing
 * @param {number} options.jitter
 * @param {number} options.edgeDeleteRatio share of edges to try to remove
 * @param {number} options.minDegree neighbours every node must keep (>= 1)
 * @param {number} options.forbiddenRatio share of nodes to flag as forbidden,
 *   applied once the graph is finished
 * @param {number} options.k transmitter radius, needed only to judge whether
 *   the forbidden nodes leave a playable level behind
 * @param {() => number} options.rng
 * @returns {Graph|null}
 */
export function generateCandidate({
  nodeCount,
  lattice = 'rect',
  spacing = 60,
  jitter = 0.15,
  edgeDeleteRatio = 0.35,
  minDegree = 1,
  forbiddenRatio = 0,
  maxEdge = 1.9,
  k = 1,
  rng,
}) {
  if (!Number.isInteger(nodeCount) || nodeCount < 2) {
    throw new RangeError(`nodeCount must be an integer >= 2, got ${nodeCount}`);
  }
  if (!TOPOLOGIES.includes(lattice)) {
    throw new RangeError(`lattice must be one of ${TOPOLOGIES.join(', ')}, got ${lattice}`);
  }
  if (!Number.isFinite(edgeDeleteRatio) || edgeDeleteRatio < 0 || edgeDeleteRatio >= 1) {
    throw new RangeError(`edgeDeleteRatio must be within [0, 1), got ${edgeDeleteRatio}`);
  }
  if (!Number.isInteger(minDegree) || minDegree < 1) {
    throw new RangeError(`minDegree must be an integer >= 1, got ${minDegree}`);
  }
  if (!Number.isFinite(forbiddenRatio) || forbiddenRatio < 0 || forbiddenRatio >= 1) {
    throw new RangeError(`forbiddenRatio must be within [0, 1), got ${forbiddenRatio}`);
  }

  // Start from a lattice roughly a third larger than the target, so there is
  // something to carve away without the result degenerating into a plain grid.
  const target = Math.ceil(nodeCount * 1.35);
  let base;
  if (lattice === 'delaunay') {
    base = delaunayGraph({ points: target, spacing, maxEdge, rng });
    if (base === null) return null;
  } else {
    const cols = Math.max(2, Math.ceil(Math.sqrt(target)));
    const rows = Math.max(2, Math.ceil(target / cols));
    base = (lattice === 'hex' ? hexLattice : rectLattice)({ cols, rows, spacing, jitter, rng });
  }
  const state = toWorkingSet(base);

  // 1. Delete nodes down to the requested size.
  for (const id of shuffled(rng, [...state.pos.keys()])) {
    if (state.pos.size <= nodeCount) break;
    const neighbours = state.adj.get(id);
    // Removing a node costs each neighbour one edge; skip when that would take
    // one of them below minDegree.
    if ([...neighbours].some((other) => state.adj.get(other).size <= minDegree)) continue;
    const backup = new Set(neighbours);
    state.pos.delete(id);
    state.adj.delete(id);
    for (const other of backup) state.adj.get(other).delete(id);
    if (!isWorkingSetConnected(state)) return null;
  }
  if (state.pos.size !== nodeCount) return null;

  // 2. Thin out the edges, skipping any removal that would break the graph.
  const remaining = fromWorkingSet(state).edges;
  let budget = Math.floor(remaining.length * edgeDeleteRatio);
  for (const [a, b] of shuffled(rng, remaining)) {
    if (budget <= 0) break;
    if (state.adj.get(a).size <= minDegree || state.adj.get(b).size <= minDegree) continue;
    state.adj.get(a).delete(b);
    state.adj.get(b).delete(a);
    if (isWorkingSetConnected(state)) {
      budget--;
    } else {
      state.adj.get(a).add(b); // a bridge — put it back
      state.adj.get(b).add(a);
    }
  }

  if (!isWorkingSetConnected(state) || !meetsMinDegree(state, minDegree)) return null;
  const graph = fromWorkingSet(state);

  // 3. Flag forbidden nodes on the finished graph, then check the level is
  //    still playable at all.
  const banned = Math.round(nodeCount * forbiddenRatio);
  if (banned === 0) return graph;

  const chosen = new Set(shuffled(rng, graph.nodes.map((node) => node.id)).slice(0, banned));
  for (const node of graph.nodes) {
    if (chosen.has(node.id)) node.forbidden = true;
  }

  const candidates = admissibleCandidates(graph, k);
  if (candidates.length === 0) return null; // nowhere left to put a transmitter
  const reachable = new Set();
  for (const id of candidates) {
    for (const node of bfsWithin(graph, id, k)) reachable.add(node);
  }
  // Every node that must be supplied has to be reachable from somewhere legal.
  if (requiredNodes(graph).some((id) => !reachable.has(id))) return null;
  return graph;
}

// ---------------------------------------------------------------------------
// Reduction analysis
// ---------------------------------------------------------------------------

/**
 * Exact binomial coefficient C(n, count). Returns 0 when the choice is
 * impossible and 1 for `count = 0`. Stays exact well past the sizes this
 * generator produces.
 * @param {number} n
 * @param {number} count
 * @returns {number}
 */
export function binomial(n, count) {
  if (!Number.isInteger(n) || !Number.isInteger(count) || count < 0 || count > n) return 0;
  const half = Math.min(count, n - count);
  let result = 1;
  for (let i = 1; i <= half; i++) {
    result = (result * (n - half + i)) / i;
  }
  return Math.round(result);
}

/** @returns {Set<*>} a new set holding the elements present in both inputs */
function intersect(a, b) {
  const out = new Set();
  for (const value of a) {
    if (b.has(value)) out.add(value);
  }
  return out;
}

/** @returns {boolean} true when every element of `a` is in `b` */
function isSubset(a, b) {
  if (a.size > b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

/** @returns {boolean} true when `a` is contained in `b` but not equal to it */
const isStrictSubset = (a, b) => a.size < b.size && isSubset(a, b);

/**
 * Maps every node to its ball B(v) = the nodes a transmitter at v would supply.
 * @param {Graph} graph
 * @param {number} k
 * @returns {Map<*, Set<*>>}
 */
function balls(graph, k) {
  return new Map((graph?.nodes ?? []).map((node) => [node.id, new Set(bfsWithin(graph, node.id, k))]));
}

/**
 * All pairs `[v, w]` with B(v) strictly contained in B(w): a transmitter at w
 * supplies everything v would and at least one node more, so v is pointless.
 *
 * Containment is deliberately strict. For B(v) === B(w) the two positions are
 * interchangeable and neither may be struck — dropping both would throw away
 * every solution that uses either of them.
 *
 * @param {Graph} graph
 * @param {number} k
 * @returns {Array<[*, *]>} pairs [dominated, dominator], in node order
 */
export function strictlyDominates(graph, k) {
  const ball = balls(graph, k);
  const pairs = [];
  for (const [v, coverV] of ball) {
    for (const [w, coverW] of ball) {
      if (v !== w && isStrictSubset(coverV, coverW)) pairs.push([v, w]);
    }
  }
  return pairs;
}

/**
 * Runs the standard set-cover reduction to a fixpoint and reports what is left.
 *
 * The level is read as a covering problem: every node is a *candidate* (a place
 * to put a transmitter) and a *constraint* (a node that must end up supplied).
 * Because graph distance is symmetric, the candidates able to supply a
 * constraint w are exactly B(w) — the same set, read the other way round.
 *
 * One round applies three rules, each against the current, already-shrunken
 * sets:
 *   1. drop candidate v when some remaining candidate w has B(v) ⊊ B(w) —
 *      over the *remaining* candidates, so once inadmissible positions have
 *      been struck, no admissible candidate can be dominated by one that is
 *      not itself allowed;
 *   2. drop constraint w when some other remaining constraint u has
 *      B(u) ⊆ B(w) — covering u then covers w for free;
 *   3. a constraint with exactly one remaining candidate forces that
 *      transmitter: record it, retire it as a candidate, and drop every
 *      constraint it supplies.
 *
 * Rules 1 and 2 remove one element at a time and re-read the live sets, so two
 * equivalent constraints can never cancel each other out: the first is dropped
 * because of the second, and the second then has nothing left to justify its
 * own removal.
 *
 * For a uniquely solvable level the rules are solution-preserving: every forced
 * transmitter is in the solution, and no struck candidate is. Both are asserted
 * in the tests rather than merely claimed here.
 *
 * @param {Graph} graph
 * @param {number} count number of transmitters the level asks for
 * @param {number} k transmitter radius in edges
 * @param {{candidates?: Iterable<*>, constraints?: Iterable<*>, forced?: Array<*>}} [start]
 *   Optional partially reduced state to continue from, so a higher tier can
 *   hand back what it has struck and let these same rules run again. Omitting
 *   it starts from the whole graph, which is the original behaviour — the rules
 *   themselves are untouched.
 * @returns {{forced: Array<*>, forcedTrace: Array<{node: *, round: number, ruledOut: number}>,
 *            hardestStep: number, avgStep: number, residualCandidates: number,
 *            residualConstraints: number, residualSpace: number, rounds: number,
 *            candidates: Array<*>, constraints: Array<*>}}
 *   `residualCandidates` / `residualConstraints` are counts; `candidates` /
 *   `constraints` list the surviving ids, which is what the invariant tests
 *   need to see. `rounds` counts the passes that actually changed something.
 *
 *   `forcedTrace` records how hard each forced transmitter was to see:
 *   `ruledOut` is how many of the triggering constraint's possible suppliers
 *   had to be struck as dominated before a single one remained — the number of
 *   options a player has to eliminate to spot the move. `hardestStep` and
 *   `avgStep` are the maximum and the mean over those, both 0 when nothing was
 *   forced. (For a constraint that is still alive, a supplier can only have
 *   left the pool by domination: had it been placed as a forced transmitter,
 *   it would have supplied — and thereby retired — the constraint itself.)
 */
export function reduce(graph, count, k, start = null) {
  const ball = balls(graph, k);
  // Without a starting state these are the admissible candidates and the nodes
  // that actually need supplying. On a graph with no forbidden node both are
  // simply every node, which is the original behaviour.
  const candidates = new Set(start?.candidates ?? admissibleCandidates(graph, k));
  const constraints = new Set(start?.constraints ?? requiredNodes(graph));
  const forced = [...(start?.forced ?? [])];
  const forcedTrace = [];
  const dominated = new Set(); // candidates struck by rule 1, for forcedTrace
  let rounds = 0;

  for (let changed = true; changed; ) {
    changed = false;

    // 1. Dominated candidates. Covers only depend on `constraints`, which is
    //    untouched here, so the strict-subset relation stays a partial order
    //    and a maximal candidate always survives.
    for (const v of [...candidates]) {
      if (!candidates.has(v)) continue;
      const coverV = intersect(ball.get(v), constraints);
      for (const w of candidates) {
        if (w === v) continue;
        if (isStrictSubset(coverV, intersect(ball.get(w), constraints))) {
          candidates.delete(v);
          dominated.add(v);
          changed = true;
          break;
        }
      }
    }

    // 2. Redundant constraints, justified only by constraints still alive.
    for (const w of [...constraints]) {
      if (!constraints.has(w)) continue;
      const supportW = intersect(ball.get(w), candidates);
      for (const u of constraints) {
        if (u === w) continue;
        if (isSubset(intersect(ball.get(u), candidates), supportW)) {
          constraints.delete(w);
          changed = true;
          break;
        }
      }
    }

    // 3. Constraints with a single remaining candidate force that transmitter.
    //    A constraint with *no* candidate left can only occur on an instance
    //    that has no solution at all; it is left standing.
    for (const w of [...constraints]) {
      if (!constraints.has(w)) continue;
      const support = intersect(ball.get(w), candidates);
      if (support.size !== 1) continue;
      const [transmitter] = support;
      let ruledOut = 0;
      for (const supplier of ball.get(w)) {
        if (dominated.has(supplier)) ruledOut++;
      }
      forced.push(transmitter);
      forcedTrace.push({ node: transmitter, round: rounds + 1, ruledOut });
      candidates.delete(transmitter);
      for (const supplied of ball.get(transmitter)) constraints.delete(supplied);
      changed = true;
    }

    if (changed) rounds++;
  }

  const steps = forcedTrace.map((entry) => entry.ruledOut);
  return {
    forced,
    forcedTrace,
    hardestStep: steps.length === 0 ? 0 : Math.max(...steps),
    avgStep: steps.length === 0 ? 0 : round2(steps.reduce((sum, step) => sum + step, 0) / steps.length),
    residualCandidates: candidates.size,
    residualConstraints: constraints.size,
    residualSpace: binomial(candidates.size, count - forced.length),
    rounds,
    candidates: [...candidates],
    constraints: [...constraints],
  };
}

/**
 * Number of transmitter sets of size `count` that leave exactly one node dark.
 * Many near misses make a level feel frustrating rather than clever, so this
 * stays part of the score even though the reduction analysis replaced the rest
 * of the old difficulty measure.
 * @param {Graph} graph
 * @param {number} count
 * @param {number} k
 * @returns {number}
 */
export function nearMisses(graph, count, k) {
  const nodes = graph?.nodes ?? [];
  const total = nodes.length;
  if (total === 0 || !Number.isInteger(count) || count < 0 || count > total) return 0;

  let found = 0;
  for (const candidate of combinations(nodes.map((node) => node.id), count)) {
    if (coverage(graph, candidate, k).size === total - 1) found++;
  }
  return found;
}

// ---------------------------------------------------------------------------
// Reject sampling
// ---------------------------------------------------------------------------

/**
 * Generates candidate levels until one has exactly one solution.
 *
 * @param {object} options
 * @param {number} options.nodeCount how many nodes the level should have (>= 2)
 * @param {number} options.count number of transmitters to place
 * @param {number} options.k transmitter radius in edges
 * @param {number} options.seed any integer; identical seeds give identical levels
 * @param {number} [options.maxAttempts=500] hard cap instead of an endless loop
 * @param {'rect'|'hex'|'auto'} [options.lattice='auto'] 'auto' picks per candidate
 * @param {number} [options.spacing=60]
 * @param {number} [options.jitter=0.15]
 * @param {number} [options.edgeDeleteRatio=0.35]
 * @param {number} [options.minDegree=1] neighbours every node must keep; 2 bans
 *   leaves, which otherwise hand the player a free forced move
 * @param {number} [options.forbiddenRatio=0] share of nodes no signal may reach
 * @returns {{seed: number, nodeCount: number, count: number, k: number,
 *            lattice: string, attempts: number, graph: Graph,
 *            solution: Array<*>, reduction: object, nearMisses: number}}
 * @throws {LevelGenerationError} when no unique level was found in time
 */
export function generateLevel({
  nodeCount,
  count,
  k,
  seed,
  maxAttempts = 500,
  lattice = 'auto',
  spacing = 60,
  jitter = 0.15,
  edgeDeleteRatio = 0.35,
  minDegree = 1,
  forbiddenRatio = 0,
}) {
  if (!Number.isInteger(nodeCount) || nodeCount < 2) {
    throw new RangeError(`nodeCount must be an integer >= 2, got ${nodeCount}`);
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`count must be an integer >= 1, got ${count}`);
  }
  if (count > nodeCount) {
    throw new RangeError(`count (${count}) cannot exceed nodeCount (${nodeCount})`);
  }
  if (!Number.isInteger(k) || k < 0) throw new RangeError(`k must be an integer >= 0, got ${k}`);
  if (!Number.isInteger(seed)) throw new RangeError(`seed must be an integer, got ${seed}`);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(`maxAttempts must be an integer >= 1, got ${maxAttempts}`);
  }
  if (lattice !== 'auto' && !LATTICES.includes(lattice)) {
    throw new RangeError(`lattice must be 'auto' or one of ${LATTICES.join(', ')}, got ${lattice}`);
  }

  const rng = mulberry32(seed);
  let rejected = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const kind = lattice === 'auto' ? LATTICES[randInt(rng, LATTICES.length)] : lattice;
    const graph = generateCandidate({
      nodeCount, lattice: kind, spacing, jitter, edgeDeleteRatio, minDegree, forbiddenRatio, k, rng,
    });
    if (graph === null) {
      rejected++;
      continue;
    }
    validateGraph(graph);
    if (!isUnique(graph, count, k)) continue;

    const [solution] = findAllSolutions(graph, count, k);
    return {
      seed,
      nodeCount,
      count,
      k,
      forbiddenRatio,
      lattice: kind,
      attempts: attempt,
      graph,
      solution,
      reduction: reduce(graph, count, k),
      nearMisses: nearMisses(graph, count, k),
    };
  }

  throw new LevelGenerationError(
    `No uniquely solvable level found for nodeCount=${nodeCount}, count=${count}, k=${k} ` +
      `after ${maxAttempts} attempts (seed ${seed}; ${rejected} candidates discarded as ` +
      'disconnected or wrongly sized). Try another seed, a larger maxAttempts, or relax the ' +
      'parameters — very small k with few transmitters is often unsatisfiable.',
    { seed, nodeCount, count, k, attempts: maxAttempts, rejected },
  );
}

// ---------------------------------------------------------------------------
// Exact-cover levels, built backwards
// ---------------------------------------------------------------------------

/**
 * Picks `count` lattice nodes that are pairwise at least 2k+1 edges apart, so
 * their balls are guaranteed disjoint.
 *
 * Exactly 2k+1 apart is preferred over merely far enough: at that distance the
 * two balls touch, and the finished board stays in one piece. Picking greedily
 * at random instead scatters the transmitters, the union of their balls falls
 * into separate components, and the candidate has to be thrown away — which is
 * what all but a twentieth of them used to be.
 * @param {Graph} graph
 * @param {number} count
 * @param {number} k
 * @param {() => number} rng
 * @returns {Array<*>|null} null when the graph has no room for that many
 */
function spacedTransmitters(graph, count, k, rng) {
  const ids = shuffled(rng, graph.nodes.map((node) => node.id));
  if (ids.length === 0) return null;

  const chosen = [ids[0]];
  const blocked = new Set(bfsWithin(graph, ids[0], 2 * k));

  while (chosen.length < count) {
    // The shell at exactly 2k+1 around anything already placed.
    const touching = new Set();
    for (const transmitter of chosen) {
      const inner = new Set(bfsWithin(graph, transmitter, 2 * k));
      for (const node of bfsWithin(graph, transmitter, 2 * k + 1)) {
        if (!inner.has(node)) touching.add(node);
      }
    }
    const free = ids.filter((id) => !blocked.has(id));
    const next = (free.find((id) => touching.has(id)) ?? free[0]);
    if (next === undefined) return null;
    chosen.push(next);
    for (const near of bfsWithin(graph, next, 2 * k)) blocked.add(near);
  }
  return chosen;
}

/**
 * @param {Graph} graph
 * @param {Array<*>} transmitters
 * @param {number} k
 * @returns {boolean} true when the balls tile the graph exactly
 */
function isPartition(graph, transmitters, k) {
  const seen = new Set();
  for (const transmitter of transmitters) {
    for (const reached of bfsWithin(graph, transmitter, k)) {
      if (seen.has(reached)) return false; // two signals on one node
      seen.add(reached);
    }
  }
  return seen.size === graph.nodes.length;
}

/**
 * Builds one exact-cover candidate, working backwards from the answer.
 *
 * The transmitters are chosen first, spaced far enough apart that their balls
 * cannot overlap. Everything outside those balls is then deleted — which is
 * what turns a disjoint family into a partition. Deleting nodes only ever
 * lengthens paths, so balls can shrink and leave new nodes stranded; the prune
 * therefore repeats to a fixpoint. Edges are thinned afterwards, and any
 * removal that breaks the partition is put straight back.
 *
 * @param {object} options
 * @returns {{graph: Graph, solution: Array<*>}|null}
 */
export function generateExactCandidate({
  count,
  k,
  lattice = 'rect',
  spacing = 60,
  jitter = 0.15,
  edgeDeleteRatio = 0.25,
  minDegree = 1,
  maxEdge = 1.9,
  rng,
}) {
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`count must be an integer >= 1, got ${count}`);
  if (!Number.isInteger(k) || k < 0) throw new RangeError(`k must be an integer >= 0, got ${k}`);
  if (!TOPOLOGIES.includes(lattice)) {
    throw new RangeError(`lattice must be one of ${TOPOLOGIES.join(', ')}, got ${lattice}`);
  }

  // Room for `count` balls of radius k, kept 2k+1 apart, plus slack.
  const cells = Math.ceil(count * (2 * k + 1) ** 2 * 2.2);
  let graph;
  if (lattice === 'delaunay') {
    graph = delaunayGraph({ points: cells, spacing, maxEdge, rng });
    if (graph === null) return null;
  } else {
    const cols = Math.max(2 * k + 2, Math.ceil(Math.sqrt(cells)));
    const rows = Math.max(2 * k + 2, Math.ceil(cells / cols));
    graph = (lattice === 'hex' ? hexLattice : rectLattice)({ cols, rows, spacing, jitter, rng });
  }

  const transmitters = spacedTransmitters(graph, count, k, rng);
  if (transmitters === null) return null;

  // Prune to the union of the balls, repeating because pruning can strand more.
  for (let pass = 0; pass < graph.nodes.length; pass++) {
    const keep = new Set();
    for (const transmitter of transmitters) {
      for (const reached of bfsWithin(graph, transmitter, k)) keep.add(reached);
    }
    if (keep.size === graph.nodes.length) break;
    graph = {
      nodes: graph.nodes.filter((node) => keep.has(node.id)),
      edges: graph.edges.filter(([a, b]) => keep.has(a) && keep.has(b)),
    };
    if (!transmitters.every((id) => keep.has(id))) return null;
  }

  if (!isPartition(graph, transmitters, k)) return null;

  // Thin the edges, reverting anything that breaks the tiling.
  const state = toWorkingSet(graph);
  let budget = Math.floor(graph.edges.length * edgeDeleteRatio);
  for (const [a, b] of shuffled(rng, graph.edges)) {
    if (budget <= 0) break;
    if (state.adj.get(a).size <= minDegree || state.adj.get(b).size <= minDegree) continue;
    state.adj.get(a).delete(b);
    state.adj.get(b).delete(a);
    const trimmed = fromWorkingSet(state);
    if (isWorkingSetConnected(state) && isPartition(trimmed, transmitters, k)) {
      graph = trimmed;
      budget--;
    } else {
      state.adj.get(a).add(b);
      state.adj.get(b).add(a);
    }
  }

  if (!isWorkingSetConnected(state) || !meetsMinDegree(state, minDegree)) return null;
  graph = fromWorkingSet(state);
  if (!isPartition(graph, transmitters, k)) return null;
  return { graph, solution: transmitters.slice().sort() };
}

/**
 * Reject-samples exact-cover levels until one is uniquely solvable.
 *
 * @param {object} options
 * @param {number} options.count transmitters to place
 * @param {number} options.k transmitter radius
 * @param {number} options.seed
 * @param {number} [options.nodeCount] target size; candidates further than
 *   `tolerance` away from it are discarded. Omit to take whatever comes out.
 * @param {number} [options.tolerance=0.25]
 * @param {number} [options.maxAttempts=400]
 * @param {'backward'|'forward'} [options.strategy='backward'] `backward` picks
 *   the transmitters first and carves the board around them, which always
 *   succeeds but leaves the transmitters holding the largest balls — so the sum
 *   condition pins them almost for free. `forward` draws a random board of the
 *   requested size and keeps it only if it happens to tile uniquely: far lower
 *   yield, but the ball sizes are not rigged and the sum step is real work.
 * @param {number} [options.nodeCount] required for `forward`
 * @param {'auto'|'rect'|'hex'|'delaunay'} [options.lattice='auto'] 'auto' picks
 *   between the two lattices per candidate; 'delaunay' asks for the irregular
 *   generator, whose varied node degrees give varied ball sizes
 * @returns {object} level with `mode: 'exact'`
 * @throws {LevelGenerationError}
 */
export function generateExactLevel({
  count,
  k,
  seed,
  nodeCount = null,
  tolerance = 0.25,
  maxAttempts = 400,
  lattice = 'auto',
  spacing = 60,
  jitter = 0.15,
  edgeDeleteRatio = 0.25,
  minDegree = 1,
  maxEdge = 1.9,
  strategy = 'backward',
}) {
  if (!Number.isInteger(seed)) throw new RangeError(`seed must be an integer, got ${seed}`);
  if (!['backward', 'forward'].includes(strategy)) {
    throw new RangeError(`strategy must be 'backward' or 'forward', got ${strategy}`);
  }
  if (strategy === 'forward' && !Number.isInteger(nodeCount)) {
    throw new RangeError('the forward strategy needs an explicit nodeCount');
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(`maxAttempts must be an integer >= 1, got ${maxAttempts}`);
  }

  const rng = mulberry32(seed);
  let rejected = 0;
  let offSize = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const kind = lattice === 'auto' ? LATTICES[randInt(rng, LATTICES.length)] : lattice;
    let graph;
    if (strategy === 'forward') {
      // Draw a board of the requested size and see whether it tiles at all.
      graph = generateCandidate({
        nodeCount, lattice: kind, spacing, jitter, edgeDeleteRatio, minDegree, maxEdge, k, rng,
      });
      if (graph === null) {
        rejected++;
        continue;
      }
    } else {
      const candidate = generateExactCandidate({
        count, k, lattice: kind, spacing, jitter, edgeDeleteRatio, minDegree, maxEdge, rng,
      });
      if (candidate === null) {
        rejected++;
        continue;
      }
      graph = candidate.graph;
      if (nodeCount !== null && Math.abs(graph.nodes.length - nodeCount) > nodeCount * tolerance) {
        offSize++;
        continue;
      }
    }
    validateGraph(graph);
    if (!isUnique(graph, count, k, 'exact')) continue;

    return {
      seed,
      mode: 'exact',
      strategy,
      nodeCount: graph.nodes.length,
      count,
      k,
      lattice: kind,
      attempts: attempt,
      graph,
      solution: findAllSolutions(graph, count, k, 'exact')[0],
    };
  }

  throw new LevelGenerationError(
    `No uniquely solvable exact-cover level found for count=${count}, k=${k} after ` +
      `${maxAttempts} attempts (seed ${seed}; ${rejected} candidates failed to tile, ` +
      `${offSize} were off the requested size). Exact cover is far pickier than plain ` +
      'cover: the balls have to fit together with no slack at all.',
    { seed, count, k, attempts: maxAttempts, rejected, offSize },
  );
}
