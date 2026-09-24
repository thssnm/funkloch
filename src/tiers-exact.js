/**
 * Tiered solver for the exact-cover mode, where the balls of the chosen
 * transmitters must partition the nodes: every node reached by exactly one.
 *
 * The cover-mode tiers do not carry over and are deliberately left alone. Their
 * foundation is the domination rule "B(v) ⊊ B(w), so w is never worse" — and
 * under exact cover a bigger ball is not better, it overshoots. A transmitter
 * that reaches one node too many is disqualified, not preferred. So this file
 * starts from scratch with two rules of its own:
 *
 *   Tier E1  propagation: a candidate whose ball meets an already-covered node
 *            would double-cover it and falls away. If only one candidate is
 *            left that can reach some still-dark node, it is forced. Cascade.
 *   Tier E2  the sum bound: the chosen balls must add up to exactly the number
 *            of required nodes. A candidate that appears in no subset of the
 *            remaining size with a matching sum cannot be part of any solution.
 *            An arithmetic argument, not a geometric one.
 */

import { admissibleCandidates, bfsWithin, requiredNodes } from './graph.js';

/** @typedef {import('./graph.js').Graph} Graph */

/**
 * Ball B(v) per node.
 * @param {Graph} graph
 * @param {number} k
 * @returns {Map<*, Set<*>>}
 */
function balls(graph, k) {
  return new Map((graph?.nodes ?? []).map((node) => [node.id, new Set(bfsWithin(graph, node.id, k))]));
}

/**
 * Normalises a partial solving state into candidates, chosen transmitters and
 * the nodes they already cover.
 * @param {Graph} graph
 * @param {number} k
 * @param {{candidates?: Iterable<*>, chosen?: Array<*>}} [state]
 * @param {Map<*, Set<*>>} ball
 */
function resolve(graph, k, state, ball) {
  const candidates = new Set(state?.candidates ?? admissibleCandidates(graph, k));
  const chosen = [...(state?.chosen ?? [])];
  const covered = new Set();
  for (const transmitter of chosen) {
    for (const reached of ball.get(transmitter)) covered.add(reached);
  }
  return { candidates, chosen, covered };
}

/**
 * Tier E1: propagation, run to its own fixpoint.
 *
 * @param {Graph} graph
 * @param {number} k
 * @param {{candidates?: Iterable<*>, chosen?: Array<*>}} [state]
 * @returns {{chosen: Array<*>, candidates: Array<*>, covered: Array<*>,
 *            ruledOut: Array<*>, forcedTrace: Array<object>, rounds: number}}
 *   `forcedTrace` records each forced transmitter together with the dark node
 *   that forced it — the step the player actually has to see.
 */
export function propagation(graph, k, state = null) {
  const ball = balls(graph, k);
  const { candidates, chosen, covered } = resolve(graph, k, state, ball);
  const required = requiredNodes(graph);

  const ruledOut = [];
  const forcedTrace = [];
  let rounds = 0;

  for (let changed = true; changed; ) {
    changed = false;

    // 1. A candidate overlapping what is already covered would light a node
    //    twice, which the exact rule forbids outright.
    for (const candidate of [...candidates]) {
      if (![...ball.get(candidate)].some((reached) => covered.has(reached))) continue;
      candidates.delete(candidate);
      ruledOut.push(candidate);
      changed = true;
    }

    // 2. A still-dark node with a single remaining candidate forces it.
    for (const node of required) {
      if (covered.has(node)) continue;
      let only = null;
      let supporters = 0;
      for (const candidate of candidates) {
        if (!ball.get(candidate).has(node)) continue;
        supporters++;
        if (supporters > 1) break;
        only = candidate;
      }
      // supporters === 0 means the level has no solution at all; leave it be.
      if (supporters !== 1) continue;
      chosen.push(only);
      candidates.delete(only);
      forcedTrace.push({ node: only, forcedBy: node, round: rounds + 1 });
      for (const reached of ball.get(only)) covered.add(reached);
      changed = true;
    }

    if (changed) rounds++;
  }

  return { chosen, candidates: [...candidates], covered: [...covered], ruledOut, forcedTrace, rounds };
}

/**
 * Can `need` of the given sizes be picked so they add up to `target`?
 * Plain 0/1 knapsack over (items picked, sum reached).
 * @param {number[]} sizes
 * @param {number} need
 * @param {number} target
 * @returns {boolean}
 */
function canPick(sizes, need, target) {
  if (need < 0 || target < 0) return false;
  if (need === 0) return target === 0;
  if (sizes.length < need) return false;

  const reachable = Array.from({ length: need + 1 }, () => new Set());
  reachable[0].add(0);
  for (const size of sizes) {
    for (let picked = need; picked >= 1; picked--) {
      for (const sum of reachable[picked - 1]) {
        if (sum + size <= target) reachable[picked].add(sum + size);
      }
    }
  }
  return reachable[need].has(target);
}

/**
 * Tier E2: the sum bound.
 *
 * The chosen balls tile the required nodes, so their sizes add up to exactly
 * how many required nodes are still dark. A candidate that fits into no subset
 * of the remaining size with a matching sum can be struck.
 *
 * Only sizes are considered, deliberately — whether the chosen balls would also
 * fit together geometrically is tier E1's business. Keeping the two arguments
 * separate is what makes them different tiers rather than a slow full search.
 *
 * @param {Graph} graph
 * @param {number} count
 * @param {number} k
 * @param {{candidates?: Iterable<*>, chosen?: Array<*>}} [state]
 * @returns {{need: number, target: number, sizes: Array<[*, number]>, ruledOut: Array<*>}}
 */
export function sumBound(graph, count, k, state = null) {
  const ball = balls(graph, k);
  const { candidates, chosen, covered } = resolve(graph, k, state, ball);
  const need = count - chosen.length;
  const target = requiredNodes(graph).length - covered.size;

  const live = [...candidates];
  const sizes = live.map((id) => [id, ball.get(id).size]);
  const result = { need, target, sizes, ruledOut: [] };
  if (need <= 0) return result; // nothing left to place, nothing to infer

  const sizeOf = new Map(sizes);
  result.ruledOut = live.filter((candidate) => {
    const others = live.filter((other) => other !== candidate).map((other) => sizeOf.get(other));
    return !canPick(others, need - 1, target - sizeOf.get(candidate));
  });
  return result;
}

/**
 * Counts subsets of the given sizes of size `need` that add up to `target`.
 * Plain 0/1 knapsack again, counting instead of deciding, so it never has to
 * enumerate the subsets themselves.
 * @param {number[]} sizes
 * @param {number} need
 * @param {number} target
 * @returns {number}
 */
function countSubsets(sizes, need, target) {
  if (need < 0 || target < 0) return 0;
  const ways = Array.from({ length: need + 1 }, () => new Map());
  ways[0].set(0, 1);
  for (const size of sizes) {
    for (let picked = need; picked >= 1; picked--) {
      for (const [sum, howMany] of ways[picked - 1]) {
        const next = sum + size;
        if (next > target) continue;
        ways[picked].set(next, (ways[picked].get(next) ?? 0) + howMany);
      }
    }
  }
  return ways[need].get(target) ?? 0;
}

/**
 * How many transmitter sets of size `count` satisfy the sum condition — their
 * ball sizes adding up to the number of required nodes.
 *
 * Exactly one of them is the solution; every other one is a set the arithmetic
 * lets through and only the geometry rules out. So `sumFeasible - 1` is the
 * work the E2 step actually costs the player: the number of arithmetically
 * plausible placements they have to knock down by hand.
 *
 * @param {Graph} graph
 * @param {number} count
 * @param {number} k
 * @returns {number}
 */
export function sumFeasible(graph, count, k) {
  if (!Number.isInteger(count) || count < 0) return 0;
  const candidates = admissibleCandidates(graph, k);
  const sizes = candidates.map((id) => bfsWithin(graph, id, k).length);
  return countSubsets(sizes, count, requiredNodes(graph).length);
}

/**
 * Spread of the ball sizes across the admissible candidates.
 *
 * The sum rule has nothing to say when every ball is the same size — the
 * condition then reduces to `count * size === n`, which every subset either
 * satisfies or none does. `distinct === 1` marks exactly that degenerate case.
 *
 * @param {Graph} graph
 * @param {number} k
 * @returns {{spread: number, distinct: number, sizes: number[]}}
 *   `spread` is the population standard deviation, rounded to two decimals.
 */
export function ballSizeStats(graph, k) {
  const sizes = admissibleCandidates(graph, k).map((id) => bfsWithin(graph, id, k).length);
  if (sizes.length === 0) return { spread: 0, distinct: 0, sizes };
  const mean = sizes.reduce((sum, size) => sum + size, 0) / sizes.length;
  const variance = sizes.reduce((sum, size) => sum + (size - mean) ** 2, 0) / sizes.length;
  return {
    spread: Math.round(Math.sqrt(variance) * 100) / 100,
    distinct: new Set(sizes).size,
    sizes,
  };
}

/**
 * Alternates E1 and E2 until neither makes progress.
 *
 * @param {Graph} graph
 * @param {number} count
 * @param {number} k
 * @returns {{solved: boolean, maxTier: number, e1Steps: number, e2Steps: number,
 *            trace: Array<object>, chosen: Array<*>, candidates: Array<*>}}
 *   `maxTier` is the highest tier that contributed: 1 when E1 managed alone,
 *   2 when the sum bound was needed, 0 when nothing moved at all. `e1Steps`
 *   counts the transmitters propagation forced, `e2Steps` how often the sum
 *   bound struck something.
 */
export function solveExactByTiers(graph, count, k) {
  const total = requiredNodes(graph).length;
  let state = { candidates: admissibleCandidates(graph, k), chosen: [] };

  const trace = [];
  let e1Steps = 0;
  let e2Steps = 0;
  let maxTier = 0;
  let covered = 0;

  for (;;) {
    const step = propagation(graph, k, state);
    const placed = step.chosen.length - state.chosen.length;
    if (placed > 0 || step.ruledOut.length > 0) {
      trace.push({ tier: 1, forced: step.forcedTrace, ruledOut: step.ruledOut, rounds: step.rounds });
      e1Steps += placed;
      maxTier = Math.max(maxTier, 1);
    }
    state = { candidates: step.candidates, chosen: step.chosen };
    covered = step.covered.length;
    if (state.chosen.length === count || covered === total) break;

    const bound = sumBound(graph, count, k, state);
    if (bound.ruledOut.length === 0) break; // neither tier can move: stuck
    trace.push({ tier: 2, need: bound.need, target: bound.target, ruledOut: bound.ruledOut });
    e2Steps++;
    maxTier = 2;
    const struck = new Set(bound.ruledOut);
    state = { ...state, candidates: state.candidates.filter((id) => !struck.has(id)) };
  }

  return {
    solved: covered === total && state.chosen.length === count,
    maxTier,
    e1Steps,
    e2Steps,
    trace,
    chosen: state.chosen,
    candidates: state.candidates,
  };
}
