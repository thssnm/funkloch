/**
 * Tiered solver. Difficulty is not how big the search space is — it is which
 * inference rules a level forces the player to reach for.
 *
 *   Tier 0  forbidden nodes: a transmitter whose ball would touch a forbidden
 *           node is simply not allowed to stand there. The first and most
 *           obvious deduction on such a level, and reported as a step of its
 *           own rather than folded silently into the candidate list.
 *   Tier 1  the existing `reduce`: dominated candidates, redundant constraints,
 *           and constraints left with a single supplier. Pure bookkeeping.
 *   Tier 2  the packing bound: if `count` constraints have pairwise disjoint
 *           balls, every transmitter is pinned inside one of them, and anything
 *           outside can be struck. A genuinely different argument — it reasons
 *           about the budget as a whole rather than one constraint at a time.
 *
 * `solveByTiers` runs tier 0 once and then alternates tiers 1 and 2 to a
 * fixpoint. The order matters for soundness, not just for the narrative: both
 * later rules argue over the candidates still standing, so they are only
 * correct once the inadmissible ones are gone. See the note on `solveByTiers`.
 */

import { bfsWithin, forbiddenNodes, requiredNodes } from './graph.js';
import { reduce } from './generator.js';

/** @typedef {import('./graph.js').Graph} Graph */

/**
 * Ball B(v) per node: everything a transmitter at v supplies. Because graph
 * distance is symmetric, this doubles as the set of candidates able to supply
 * the constraint v.
 * @param {Graph} graph
 * @param {number} k
 * @returns {Map<*, Set<*>>}
 */
function balls(graph, k) {
  return new Map((graph?.nodes ?? []).map((node) => [node.id, new Set(bfsWithin(graph, node.id, k))]));
}

/** @returns {boolean} true when the two sets share no element */
function disjoint(a, b) {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const value of small) {
    if (large.has(value)) return false;
  }
  return true;
}

/**
 * Tier 0: strike every candidate whose signal would reach a forbidden node.
 *
 * On a graph without forbidden nodes this strikes nothing and the level plays
 * exactly as it did before the rule existed.
 *
 * @param {Graph} graph
 * @param {number} k
 * @param {{candidates?: Iterable<*>}} [state] candidates still in play;
 *   omitting it considers every node.
 * @returns {{forbidden: Array<*>, ruledOut: Array<*>}}
 */
export function forbiddenExclusion(graph, k, state = null) {
  const banned = forbiddenNodes(graph);
  const candidates = [...(state?.candidates ?? (graph?.nodes ?? []).map((node) => node.id))];
  if (banned.size === 0) return { forbidden: [], ruledOut: [] };

  const ruledOut = candidates.filter((id) => bfsWithin(graph, id, k).some((reached) => banned.has(reached)));
  return { forbidden: [...banned], ruledOut };
}

/**
 * Largest set of constraints with pairwise disjoint supports, found exactly.
 *
 * This is a maximum independent set in the conflict graph "supports overlap",
 * solved by branch and bound: extend the current family in index order and cut
 * off a branch as soon as everything still available cannot beat the best
 * family found so far. Exact rather than greedy, which n <= 30 affords.
 *
 * @param {Array<*>} ids constraint ids, in a fixed order
 * @param {Map<*, Set<*>>} support support set per constraint
 * @returns {Array<*>} one maximum family; ties resolve to the first one found
 */
function maxDisjointFamily(ids, support) {
  const size = ids.length;
  const conflicts = new Uint8Array(size * size);
  for (let i = 0; i < size; i++) {
    for (let j = i + 1; j < size; j++) {
      const overlap = disjoint(support.get(ids[i]), support.get(ids[j])) ? 0 : 1;
      conflicts[i * size + j] = overlap;
      conflicts[j * size + i] = overlap;
    }
  }

  let best = [];
  const chosen = [];

  const expand = (available) => {
    if (chosen.length > best.length) best = [...chosen];
    for (let i = 0; i < available.length; i++) {
      // Nothing left can overtake the best family: cut the branch.
      if (chosen.length + available.length - i <= best.length) return;
      const pick = available[i];
      chosen.push(pick);
      expand(available.slice(i + 1).filter((other) => conflicts[pick * size + other] === 0));
      chosen.pop();
    }
  };

  expand([...ids.keys()]);
  return best.map((index) => ids[index]);
}

/**
 * Tier 2: the packing bound.
 *
 * A constraint w can only be supplied from its ball B(w), intersected with the
 * candidates still allowed. If `budget` many constraints have pairwise disjoint
 * supports, each needs a transmitter of its own, the whole budget is spent
 * inside those supports, and no transmitter can sit anywhere else. Every
 * candidate outside the union is therefore impossible.
 *
 * @param {Graph} graph
 * @param {number} count transmitters the level asks for
 * @param {number} k transmitter radius
 * @param {{candidates?: Iterable<*>, constraints?: Iterable<*>, forced?: Array<*>}} [state]
 *   Residual state from the earlier tiers; omitting it analyses the untouched
 *   level over its admissible candidates and required constraints.
 * @returns {{family: Array<*>, size: number, budget: number, ruledOut: Array<*>}}
 *   `ruledOut` is empty unless the family exactly fills the remaining budget.
 */
export function disjointBound(graph, count, k, state = null) {
  const ball = balls(graph, k);
  const candidates = new Set(
    state?.candidates ?? forbiddenExclusionApplied(graph, k),
  );
  const constraints = [...(state?.constraints ?? requiredNodes(graph))];
  const budget = count - (state?.forced?.length ?? 0);

  // Supports, restricted to the candidates still in play.
  const support = new Map(
    constraints.map((id) => [id, new Set([...ball.get(id)].filter((node) => candidates.has(node)))]),
  );

  const family = maxDisjointFamily(constraints, support);
  const result = { family, size: family.length, budget, ruledOut: [] };
  // A family larger than the budget would mean the level has no solution at
  // all; smaller tells us nothing. Only an exact fit pins the transmitters.
  if (family.length !== budget || budget <= 0) return result;

  const reachable = new Set();
  for (const constraint of family) {
    for (const candidate of support.get(constraint)) reachable.add(candidate);
  }
  result.ruledOut = [...candidates].filter((candidate) => !reachable.has(candidate));
  return result;
}

/** @returns {Array<*>} every node minus what tier 0 would strike */
function forbiddenExclusionApplied(graph, k) {
  const all = (graph?.nodes ?? []).map((node) => node.id);
  const struck = new Set(forbiddenExclusion(graph, k).ruledOut);
  return all.filter((id) => !struck.has(id));
}

/**
 * Runs the tiers until none makes progress.
 *
 * Tier 0 goes first and only once: nothing later can put a candidate back, so
 * re-running it could never find more. Its position is also what keeps the
 * later rules sound — tier 1's domination rule strikes a candidate v whenever
 * some *remaining* candidate w covers strictly more, and if an inadmissible w
 * were still standing it could dominate a perfectly good v and have it thrown
 * away. Running tier 0 first removes that possibility entirely, which is why
 * neither of the later rules needed changing for forbidden nodes.
 *
 * @param {Graph} graph
 * @param {number} count
 * @param {number} k
 * @returns {{solved: boolean, maxTier: number, tier0Steps: number, tier1Steps: number,
 *            tier2Steps: number, trace: Array<object>, forced: Array<*>,
 *            candidates: Array<*>, constraints: Array<*>}}
 *   `solved` means deduction alone placed every transmitter and left no
 *   required node unsupplied. `maxTier` is the highest tier that contributed;
 *   since tier 0 never finishes a level on its own it is reported separately,
 *   as `tier0Steps` — the number of positions the forbidden nodes removed.
 *   `tier1Steps` counts the transmitters tier 1 forced, `tier2Steps` how often
 *   the packing bound struck something.
 */
export function solveByTiers(graph, count, k) {
  let state = {
    candidates: (graph?.nodes ?? []).map((node) => node.id),
    constraints: requiredNodes(graph),
    forced: [],
  };

  const trace = [];
  let tier0Steps = 0;
  let tier1Steps = 0;
  let tier2Steps = 0;
  let maxTier = 0;

  // --- tier 0, once ---------------------------------------------------------
  const excluded = forbiddenExclusion(graph, k, state);
  if (excluded.ruledOut.length > 0) {
    trace.push({ tier: 0, forbidden: excluded.forbidden, ruledOut: excluded.ruledOut });
    tier0Steps = excluded.ruledOut.length;
    const struck = new Set(excluded.ruledOut);
    state = { ...state, candidates: state.candidates.filter((id) => !struck.has(id)) };
  }

  for (;;) {
    // --- tier 1, to its own fixpoint ---------------------------------------
    const reduced = reduce(graph, count, k, state);
    const placed = reduced.forced.length - state.forced.length;
    if (
      placed > 0 ||
      reduced.candidates.length !== state.candidates.length ||
      reduced.constraints.length !== state.constraints.length
    ) {
      trace.push({
        tier: 1,
        forced: reduced.forced.slice(state.forced.length),
        rounds: reduced.rounds,
        hardestStep: reduced.hardestStep,
      });
      tier1Steps += placed;
      maxTier = Math.max(maxTier, 1);
    }
    state = {
      candidates: reduced.candidates,
      constraints: reduced.constraints,
      forced: reduced.forced,
    };

    if (state.constraints.length === 0) break;

    // --- tier 2, one application -------------------------------------------
    const bound = disjointBound(graph, count, k, state);
    if (bound.ruledOut.length === 0) break; // no tier can move: stuck
    trace.push({ tier: 2, family: bound.family, ruledOut: bound.ruledOut });
    tier2Steps++;
    maxTier = 2;
    const struck = new Set(bound.ruledOut);
    state = { ...state, candidates: state.candidates.filter((id) => !struck.has(id)) };
  }

  return {
    solved: state.constraints.length === 0 && state.forced.length === count,
    maxTier,
    tier0Steps,
    tier1Steps,
    tier2Steps,
    trace,
    forced: state.forced,
    candidates: state.candidates,
    constraints: state.constraints,
  };
}
