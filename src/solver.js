/**
 * Brute-force solver for the transmitter placement puzzle, in two modes.
 *
 *   cover   which sets of exactly `count` transmitters supply every node that
 *           needs supplying? Overlap is fine.
 *   exact   which sets make the balls a *partition*: every node reached by
 *           exactly one transmitter, overlap counts as a mistake.
 *
 * Exact mode rests on one fact that makes the search cheap. Two balls of radius
 * k are disjoint if and only if their centres are at least 2k+1 edges apart:
 * a node within k of both would put the centres within 2k by the triangle
 * inequality, and conversely any path of length <= 2k has a node within k of
 * both ends. So pairwise distance alone decides disjointness, and a disjoint
 * family whose ball sizes add up to the number of required nodes must be a
 * partition — no separate coverage check is needed at all.
 *
 * Nodes flagged `forbidden` change both halves of that question: a transmitter
 * may only stand where its ball reaches no forbidden node, and forbidden nodes
 * themselves are not among the nodes that must be supplied. Both restrictions
 * come from graph.js, so there is one definition of admissibility in the
 * codebase. A graph without any forbidden node is unaffected.
 *
 * All functions are pure and free of shared state.
 */

import { admissibleCandidates, bfsWithin, requiredNodes } from './graph.js';

/** The two rule sets a level can be played under. */
export const MODES = ['cover', 'exact'];

/** @typedef {import('./graph.js').Graph} Graph */

/**
 * Yields every combination of `count` indices out of `0..n-1` in ascending
 * lexicographic order.
 * @param {number} n
 * @param {number} count
 * @returns {Generator<number[]>}
 */
function* indexCombinations(n, count) {
  if (count === 0) {
    yield [];
    return;
  }
  if (count > n) return;

  const picked = new Array(count);
  function* build(start, depth) {
    if (depth === count) {
      yield picked.slice();
      return;
    }
    // Leave room for the remaining picks.
    for (let i = start; i <= n - (count - depth); i++) {
      picked[depth] = i;
      yield* build(i + 1, depth + 1);
    }
  }
  yield* build(0, 0);
}

/**
 * Yields every combination of exactly `count` items from `items`, in ascending
 * lexicographic order of their positions. Yields nothing for a negative or
 * non-integer `count`, or when `count` exceeds the number of items; `count = 0`
 * yields a single empty combination.
 * @template T
 * @param {Iterable<T>} items
 * @param {number} count
 * @returns {Generator<T[]>}
 */
export function* combinations(items, count) {
  if (!Number.isInteger(count) || count < 0) return;
  const list = [...items];
  for (const picked of indexCombinations(list.length, count)) {
    yield picked.map((index) => list[index]);
  }
}

/**
 * Precomputes, per admissible candidate, which of the required nodes it would
 * supply.
 * @param {Graph} graph
 * @param {number} k
 * @returns {{candidates: Array<*>, required: number, reach: number[][]}}
 */
function reachTable(graph, k) {
  const candidates = admissibleCandidates(graph, k);
  const required = requiredNodes(graph);
  const indexOfId = new Map();
  required.forEach((id, index) => {
    if (!indexOfId.has(id)) indexOfId.set(id, index);
  });

  const reach = candidates.map((id) =>
    bfsWithin(graph, id, k)
      .map((reached) => indexOfId.get(reached))
      .filter((index) => index !== undefined),
  );
  return { candidates, required: required.length, reach };
}

/**
 * Enumerates covering transmitter sets, stopping after `limit` hits.
 * @param {Graph} graph
 * @param {number} count
 * @param {number} k
 * @param {number} limit
 * @returns {Array<Array<*>>}
 */
function solveUpTo(graph, count, k, limit) {
  if (!Number.isInteger(count) || count < 0) return [];

  const { candidates, required, reach } = reachTable(graph, k);
  if (count > candidates.length) return [];

  const solutions = [];
  const marked = new Uint8Array(required);

  for (const combination of indexCombinations(candidates.length, count)) {
    marked.fill(0);
    let covered = 0;
    for (const transmitter of combination) {
      for (const index of reach[transmitter]) {
        if (marked[index] === 0) {
          marked[index] = 1;
          covered++;
        }
      }
    }
    if (covered === required) {
      solutions.push(combination.map((index) => candidates[index]));
      if (solutions.length >= limit) break;
    }
  }
  return solutions;
}

/**
 * Enumerates exact-cover solutions: transmitter sets whose balls partition the
 * required nodes. Stops after `limit` hits.
 * @param {Graph} graph
 * @param {number} count
 * @param {number} k
 * @param {number} limit
 * @returns {Array<Array<*>>}
 */
function solveExactUpTo(graph, count, k, limit) {
  if (!Number.isInteger(count) || count < 0) return [];

  const candidates = admissibleCandidates(graph, k);
  const target = requiredNodes(graph).length;
  if (count > candidates.length) return [];

  // An admissible candidate's ball holds no forbidden node, so its size is
  // exactly its contribution to the required nodes.
  const size = new Map(candidates.map((id) => [id, bfsWithin(graph, id, k).length]));
  // The prefilter: everything within 2k is too close to coexist.
  const tooClose = new Map(candidates.map((id) => [id, new Set(bfsWithin(graph, id, 2 * k))]));

  const solutions = [];
  const chosen = [];

  const expand = (start, sum) => {
    if (chosen.length === count) {
      if (sum === target) solutions.push([...chosen]);
      return;
    }
    const need = count - chosen.length;
    for (let i = start; i <= candidates.length - need; i++) {
      if (solutions.length >= limit) return;
      const candidate = candidates[i];
      const reach = size.get(candidate);
      if (sum + reach > target) continue; // overshoots the partition
      if (chosen.some((other) => tooClose.get(candidate).has(other))) continue; // balls would overlap
      chosen.push(candidate);
      expand(i + 1, sum + reach);
      chosen.pop();
    }
  };

  expand(0, 0);
  return solutions.slice(0, limit === Infinity ? undefined : limit);
}

/**
 * @param {string} mode
 * @returns {string} the validated mode
 */
function checkMode(mode) {
  if (!MODES.includes(mode)) throw new RangeError(`mode must be one of ${MODES.join(', ')}, got ${mode}`);
  return mode;
}

/**
 * All transmitter sets of exactly `count` nodes that cover every node within
 * `k` edges. Each solution is a list of node ids in node-list order; the
 * solutions themselves come in ascending lexicographic index order.
 *
 * Returns `[]` when `count` is negative, not an integer, or larger than the
 * number of admissible candidates. For an empty graph and `count === 0` the
 * empty set is the (single) trivial solution.
 * In `exact` mode the balls must instead partition the required nodes: every
 * one reached by exactly one transmitter.
 * @param {Graph} graph
 * @param {number} count
 * @param {number} k
 * @param {'cover'|'exact'} [mode='cover']
 * @returns {Array<Array<*>>}
 */
export function findAllSolutions(graph, count, k, mode = 'cover') {
  return checkMode(mode) === 'exact'
    ? solveExactUpTo(graph, count, k, Infinity)
    : solveUpTo(graph, count, k, Infinity);
}

/**
 * True when exactly one transmitter set of size `count` covers the graph.
 * Stops enumerating as soon as a second solution shows up.
 * @param {Graph} graph
 * @param {number} count
 * @param {number} k
 * @param {'cover'|'exact'} [mode='cover']
 * @returns {boolean}
 */
export function isUnique(graph, count, k, mode = 'cover') {
  return (checkMode(mode) === 'exact'
    ? solveExactUpTo(graph, count, k, 2)
    : solveUpTo(graph, count, k, 2)
  ).length === 1;
}
