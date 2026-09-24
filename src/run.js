/**
 * One run of the depot mode: three stages, a procedurally drawn board each
 * time, and a depot of transmitters of radius 1, 2 or 3 to clear it with.
 *
 * The loop: draw the transmitter at the front of the depot, see the next two,
 * place it. Clear the board before the depot runs out and whatever is left over
 * counts as score; run out with nodes still dark and the run is over.
 *
 * A placement is final. Lifting a placed transmitter back off the board was
 * allowed once — it stayed spent either way, so what the lift bought was the
 * *node*, not the card — and it is gone again: the planning bot reached for it
 * in 5.7% of runs and gained 0.5 percentage points of win rate for it, which
 * does not pay for blurring the one rule the whole mode rests on.
 *
 * Everything random is derived from `(seed, stage)`, so no rng state has to be
 * carried around: the state stays pure, serializable and replayable, and a bot
 * can play thousands of runs without the board depending on how it played.
 */

import { bfsWithin, bfsWithinBlocked, blockedNodes } from './graph.js';
import { generateCandidate, mulberry32, shuffled } from './generator.js';

/** @typedef {import('./graph.js').Graph} Graph */

/**
 * Share of the triangulation's edges the generator tries to delete again.
 * A config may override it with its own `edgeDeleteRatio`.
 *
 * Deleting less leaves a denser board: more edges, higher degree, and fewer of
 * the chains of degree-2 nodes on which a radius 2 always lights the same five
 * nodes, so only roughly where it goes matters and never exactly. That is a
 * real defect of the shipped board — at 0.2 nearly every second node has
 * degree 2 — and the obvious repair is to delete less. Measured with
 * `tools/density.js`, it does not pay: the chains go away, the reward for
 * planning does not grow.
 *
 * Board shape, 300 boards per row, node counts as the endless mode deals them:
 *
 *   0.00   degree 3.53   deg-2 23.0%   in chains  2.1%   ball 8.45
 *   0.05   degree 3.37   deg-2 27.1%   in chains  2.9%   ball 8.14
 *   0.10   degree 3.19   deg-2 32.5%   in chains  3.9%   ball 7.76
 *   0.15   degree 3.02   deg-2 38.8%   in chains  5.3%   ball 7.38
 *   0.20   degree 2.84   deg-2 46.3%   in chains  7.5%   ball 6.96   <- this one
 *   0.30   degree 2.50   deg-2 63.9%   in chains 17.2%   ball 6.06
 *
 * Density does not only add branchings, it also grows the ball, and a board
 * that is cheaper to clear is easier whatever its shape. Played with the
 * shipped depot the gap between the greedy and the planning bot therefore
 * explodes — 2.22x at 0.20 against 9.94x at 0.00 — but that is the planner
 * no longer dying, not the board rewarding thought: at 0.00 a quarter of its
 * runs stand on the 200-stage cap, which makes the row a floor and not a
 * reading.
 *
 * With the depot scaled by the change in ball size, so that every density costs
 * about the same transmitters per node, the gap is flat. Ratio of mean stage
 * reached, planning over greedy, 300 runs per bot and row, three starting
 * seeds (1, 1001, 2001):
 *
 *   0.00   2.09x / 1.93x / 1.97x
 *   0.05   2.01x / 2.05x / 1.91x
 *   0.10   1.96x / 1.91x / 1.95x
 *   0.15   2.56x / 2.58x / 2.53x
 *   0.20   2.22x / 2.24x / 2.20x   <- this one
 *   0.30   1.83x / 1.80x / 1.88x
 *
 * The median gap is +4 stages in every row and every seed, and the denser
 * boards (0.00 to 0.10) sit *below* today's 0.20. Less deleting buys
 * branchings but not a reason to think ahead: what a chain costs is not the
 * choice of where to put a transmitter, it is which transmitter to spend on it
 * and which to keep for the branching, and that choice survives however few
 * chains the board has.
 *
 * The bump at 0.15 reproduces across all three seeds, so it is not noise, but
 * it is one step between two lower neighbours rather than a trend, and it
 * carries the spread of a heavy tail (SD 8.5 to 8.9 against 3.2 to 6.6
 * elsewhere). Suspected cause: the depot is `round(nodeCount * ratio)`, and the
 * 0.944 adjustment moves it by a whole transmitter on individual stages. That
 * deserves its own measurement; it is not an argument for moving the default.
 */
const EDGE_DELETE_RATIO = 0.2;

/** Default shape of a run: three boards, growing. */
export const DEFAULT_RUN = {
  stages: [18, 24, 30],
  /** Topologies to draw from. Rectangular lattices are left out: their uniform
   *  degree makes every placement worth about the same, which is dull. */
  lattices: ['delaunay', 'hex'],
  /**
   * Depot size as a share of the node count — the setting everything hinges on.
   * A single number applies to every stage; an array gives each stage its own.
   *
   * Calibrated against the *planning* bot, not the greedy one: a person can see
   * the next two transmitters and will use them, so tuning against a bot that
   * ignores the preview sets the difficulty for a player who does not exist.
   * Measured over 1000 runs per setting, greedy vs. planning, re-run after the
   * `fillDepot` repair below (which made the depot of four carry a radius 3,
   * so all three settings came out easier than they first measured):
   *
   *   4/5/7 (flat 0.22)    86% / 99%   the planner is never troubled
   *   5/6/6 (0.28/../0.20) 90% / 100%  likewise, and stage 1 becomes a formality
   *   4/5/5 (this one)     45% / 94%   the widest gap measured, +49 points
   *
   * The descending shape also moves failure late: only 18 of the 546 greedy
   * losses happened in stage 1, against 418 in stage 3.
   */
  depotRatio: [0.22, 0.19, 0.17],
  /** Transmitter mix as [radius, weight] pairs. */
  composition: [[1, 4], [2, 4], [3, 2]],
};

/**
 * The endless shape: no last stage, only the one you did not survive.
 *
 * Two dials move together as the stages go by. The board grows, and the depot
 * shrinks relative to it — from 0.24 of the node count down towards 0.15 along
 * an exponential, never quite arriving. 0.15 is chosen to sit just under what a
 * board of this family actually costs to clear (a ball averages about six new
 * nodes under the 4/4/2 mix, so roughly n/6 transmitters are needed, i.e. 0.167
 * of the nodes). The curve therefore ends in a regime that is lost eventually —
 * the question a run asks is only how late.
 *
 * `max` caps the board at 60 nodes: the bots' bitmask search holds a board in
 * two 32-bit words, so 64 is the hard ceiling and 60 keeps a margin. Past the
 * cap the difficulty rides on the depot ratio alone.
 */
export const ENDLESS_RUN = {
  endless: true,
  /** nodeCount(stage) = min(max, start + growth * (stage - 1)) */
  stageNodes: { start: 18, growth: 4, max: 60 },
  /** ratio(stage) = floor + (start - floor) * exp(-(stage - 1) / tau) */
  depotCurve: { start: 0.24, floor: 0.15, tau: 4 },
  lattices: ['delaunay', 'hex'],
  composition: [[1, 4], [2, 4], [3, 2]],
  /**
   * Share of nodes made impermeable — see `bfsWithinBlocked` in graph.js.
   * Here for board variation: an impermeable node changes what a placement is
   * worth without changing any rule, and no node can ever drop below
   * degree + 1 possible suppliers, because blocking stops transit and neither
   * the source nor the node reached is transit. Blocking shortens reach; it
   * never forces a move.
   *
   * Kept as low as board variation allows, because it is not free: blocking
   * hits the planning bot harder than the greedy one, so the reward for
   * thinking ahead shrinks with every node made opaque. Mean stage reached,
   * greedy vs. planning, with the planner's spread; `tools/blocked.js --bots`.
   *
   * Re-measured on the shipped tree, 500 runs per density, same tool and the
   * same run count as the table it replaces: at 0.12 the ratio between the bots
   * falls to 1.98 and the spread to SD 5.13, while 0.05 still holds 2.24 and
   * SD 7.18 — against 2.47 and SD 9.74 on a board with nothing blocked at all.
   *
   *   0.00   5.57 / 13.74   2.47x   SD 9.74
   *   0.05   5.23 / 11.73   2.24x   SD 7.18   <- this one
   *   0.12   4.80 /  9.51   1.98x   SD 5.13
   *   0.20   4.33 /  7.70   1.78x   SD 3.07
   *   0.40   3.26 /  5.61   1.72x   SD 1.57
   *
   * The same run also covered 0.10 (4.90 / 10.02, 2.04x, SD 5.26), 0.15
   * (4.62 / 8.91, 1.93x, SD 4.09) and 0.30 (3.76 / 6.58, 1.75x, SD 2.11).
   *
   * The table below is the one the density was originally chosen against. It
   * stays because that is what the choice was made on. Neither bot has ever
   * lifted a transmitter, so dropping that rule is not what moved the digits —
   * the ordering and the shape are unchanged either way:
   *
   *   0.00   5.8 / 14.5   2.49x   SD 9.37
   *   0.05   5.3 / 11.3   2.14x   SD 6.63   <- this one
   *   0.12   4.8 /  9.3   1.94x   SD 4.56
   *   0.20   4.4 /  7.9   1.80x   SD 2.91
   *   0.40   3.2 /  5.7   1.77x   SD 1.57
   *
   * (Measured against the older, truncating fillDepot the relative distance
   * looked constant at 2.5x across every density; it was the broken depot
   * holding it there, not the blocking. Re-measured over 1000 runs per density
   * on identical boards, the three that matter come out at 2.54x / 2.27x /
   * 1.93x for 0 / 0.05 / 0.15 — the same picture, a little sharper.)
   *
   * The endless sweep at the shipped density agrees with the fresh table:
   * 1000 runs at 0.05 give 5.15 / 11.68, 2.27x, SD 7.06
   * (`tools/endless.js --runs=1000`).
   *
   * An array instead of a number is drawn from uniformly, once per stage, so
   * the density can vary from board to board rather than being a constant of
   * the mode. It does not buy the spread back: `[0, 0.05, 0.15]` measures at a
   * mean stage of 10.5 with SD 5.81 and 2.11x, against 11.7 / 7.06 / 2.27x for
   * a flat 0.05 — worse than the average of its three parts, and worse than the
   * flat 0.067 it averages to. A run has to survive every board it is dealt, so
   * the hardest density in the mix weighs more than its third.
   */
  blockedRatio: 0.05,
};

/**
 * Milliseconds in a day. The daily board turns over at UTC midnight, and UTC
 * has no daylight saving, so a day is always exactly this long — which is what
 * lets the day number be a plain division instead of a calendar walk.
 */
const DAY_MS = 86400000;

/**
 * Normalises a `Date` or an epoch millisecond count to a number.
 * @param {Date|number} at
 * @returns {number}
 */
function toTime(at) {
  const time = at instanceof Date ? at.getTime() : at;
  if (!Number.isFinite(time)) throw new RangeError(`not a moment in time: ${String(at)}`);
  return time;
}

/**
 * The day a moment falls in, as `YYYY-MM-DD`, **in UTC**.
 *
 * UTC and not the local zone, and this is the whole point of the function: the
 * daily board is only worth playing if it is the same board for everyone, and a
 * local date would hand New Zealand tomorrow's board while California still has
 * yesterday's. Two players comparing results would then not have played the
 * same thing. One clock for everyone, and it costs at most a few hours of
 * "today" feeling off at the edges of the world.
 *
 * `at` is required rather than defaulting to the current time, so that this
 * half of the code reads no clock and a test can ask about any day it likes.
 * @param {Date|number} at
 * @returns {string}
 */
export function utcDay(at) {
  return new Date(toTime(at)).toISOString().slice(0, 10);
}

/**
 * Seed of the daily board for the UTC day `at` falls in.
 *
 * Hashed rather than used directly, because the stage seeds are `seed + stage *
 * 7919`: consecutive days would otherwise deal boards from neighbouring corners
 * of the same PRNG stream, and the first board of Tuesday would be a near miss
 * of the second board of Monday. The mix is the finaliser of murmur3, which
 * scatters two inputs one apart across the whole range.
 * @param {Date|number} at
 * @returns {number} integer in [0, 2^32), suitable as a `createRun` seed
 */
export function dailySeed(at) {
  const day = Math.floor(toTime(at) / DAY_MS);
  let hash = Math.imul(day ^ (day >>> 16), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

/**
 * Milliseconds from `at` until the next UTC midnight, i.e. until the next daily
 * board. Never zero and never more than a day: at midnight exactly, the day has
 * already turned and a whole new one is ahead.
 * @param {Date|number} at
 * @returns {number}
 */
export function msUntilNextDay(at) {
  const time = toTime(at);
  return DAY_MS - ((time % DAY_MS) + DAY_MS) % DAY_MS;
}

/**
 * Node count and depot ratio for stage `index` (0-based), for either shape of
 * run. The fixed shape reads them off its arrays; the endless one computes them
 * from its two curves.
 * @param {object} config
 * @param {number} index
 * @returns {{nodeCount: number, ratio: number}}
 */
export function stageSpec(config, index) {
  if (config.endless) {
    const { start, growth, max } = config.stageNodes;
    const curve = config.depotCurve;
    return {
      nodeCount: Math.min(max, start + growth * index),
      ratio: curve.floor + (curve.start - curve.floor) * Math.exp(-index / curve.tau),
    };
  }
  const ratio = Array.isArray(config.depotRatio) ? config.depotRatio[index] : config.depotRatio;
  return { nodeCount: config.stages[index], ratio };
}

/**
 * Draws a board, retrying until the generator yields one.
 * @param {() => number} rng
 * @param {{nodeCount: number, lattice: string}} spec
 * @returns {Graph}
 */
function drawBoard(
  rng,
  { nodeCount, lattice, blockedRatio = null, edgeDeleteRatio = EDGE_DELETE_RATIO },
) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const graph = generateCandidate({
      nodeCount, lattice, minDegree: 2, edgeDeleteRatio, k: 1, rng,
    });
    if (graph === null) continue;
    // Impermeable nodes are sprinkled on the finished board. They never make it
    // unsolvable: a transmitter standing on a node always lights that node.
    //
    // A mode that deals them at all draws the order even at density zero, so
    // that two densities played on the same seed differ in what is blocked and
    // in nothing else — same board, same depot. A mode that has never heard of
    // them (`blockedRatio` absent) keeps its random stream untouched.
    if (blockedRatio !== null) {
      const order = shuffled(rng, graph.nodes.map((node) => node.id));
      const chosen = new Set(order.slice(0, Math.round(nodeCount * blockedRatio)));
      for (const node of graph.nodes) if (chosen.has(node.id)) node.blocked = true;
    }
    return graph;
  }
  throw new Error(`could not draw a ${lattice} board of ${nodeCount} nodes`);
}

/**
 * The density of impermeable nodes for one stage. A number applies to every
 * board; an array is drawn from uniformly, once per stage, which makes the
 * density itself part of what a board can surprise you with.
 *
 * The draw happens either way, so a fixed density and a drawn one walk through
 * the same random stream and therefore the same boards.
 * @param {() => number} rng
 * @param {number|number[]|undefined} configured
 * @returns {number|null} null when the mode has no impermeable nodes at all
 */
function blockedDensity(rng, configured) {
  if (configured === undefined) return null;
  const draw = rng();
  return Array.isArray(configured) ? configured[Math.floor(draw * configured.length)] : configured;
}

/**
 * Fills a depot of the given size, holding the composition as closely as the
 * rounding allows, then shuffles it.
 *
 * Largest remainder, not rounding-and-truncating. Rounding each share on its
 * own overshoots or undershoots the size, and cutting the overshoot off the end
 * of the list always took from the *last* entry of the composition — the rarest
 * and longest-reaching radius. A depot of nine came out as 4x r1, 4x r2, 1x r3
 * and carried less total reach than a depot of eight at 3/3/2, so a stage that
 * dealt one more transmitter could be harder than the one before it.
 *
 * Every share is therefore floored first, and the slots left over go to the
 * largest fractions, ties to the longer radius. That keeps each radius within
 * one of its exact share and keeps a bigger depot from ever carrying less.
 * @param {() => number} rng
 * @param {number} size
 * @param {Array<[number, number]>} composition
 * @returns {number[]} radii, in draw order
 */
function fillDepot(rng, size, composition) {
  const total = composition.reduce((sum, [, weight]) => sum + weight, 0);
  const shares = composition.map(([radius, weight]) => {
    const exact = (size * weight) / total;
    return { radius, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let left = size - shares.reduce((sum, share) => sum + share.count, 0);
  for (const share of [...shares].sort((a, b) => b.remainder - a.remainder || b.radius - a.radius)) {
    if (left <= 0) break;
    share.count++;
    left--;
  }

  const depot = [];
  for (const { radius, count } of shares) for (let i = 0; i < count; i++) depot.push(radius);
  return shuffled(rng, depot);
}

/**
 * Builds stage `index` (0-based) from the run seed alone.
 * @param {number} seed
 * @param {number} index
 * @param {object} config
 * @returns {{graph: Graph, lattice: string, depot: number[]}}
 */
function buildStage(seed, index, config) {
  const rng = mulberry32(seed + index * 7919);
  const { nodeCount, ratio } = stageSpec(config, index);
  const lattice = config.lattices[Math.floor(rng() * config.lattices.length)];
  const blockedRatio = blockedDensity(rng, config.blockedRatio);
  const graph = drawBoard(rng, {
    nodeCount, lattice, blockedRatio, edgeDeleteRatio: config.edgeDeleteRatio,
  });
  if (!Number.isFinite(ratio)) throw new RangeError(`no depotRatio for stage ${index + 1}`);
  const depotSize = Math.max(1, Math.round(nodeCount * ratio));
  return { graph, lattice, depot: fillDepot(rng, depotSize, config.composition) };
}

/**
 * Recomputes everything derived from the placements.
 * @param {object} base fields that survive a placement unchanged
 * @param {Array<{id: *, radius: number}>} placed
 * @param {number[]} depot
 * @returns {object} frozen state
 */
function build(base, placed, depot) {
  // On a board without impermeable nodes both walks agree node for node; the
  // check only keeps the ordinary board off the slower path.
  const ball = blockedNodes(base.graph).size > 0 ? bfsWithinBlocked : bfsWithin;
  const covered = new Set();
  const radii = new Map();
  for (const { id, radius } of placed) {
    radii.set(id, radius);
    for (const reached of ball(base.graph, id, radius)) covered.add(reached);
  }
  const uncovered = base.graph.nodes.filter((node) => !covered.has(node.id)).map((node) => node.id);

  const cleared = uncovered.length === 0;
  // An endless run has no last stage: clearing one always leads to the next.
  const lastStage = !base.config.endless && base.stage === base.config.stages.length;
  const status = cleared
    ? (lastStage ? 'won' : 'stageCleared')
    : (depot.length === 0 ? 'lost' : 'playing');
  // Leftovers only score once the board is actually clear.
  const score = base.score + (cleared ? depot.length : 0);

  const state = {
    ...base,
    placed,
    depot,
    covered,
    uncovered,
    radii,
    score,
    status,
    /** The transmitter in hand, and the two the player is allowed to see. */
    current: status === 'playing' ? depot[0] : null,
    preview: status === 'playing' ? depot.slice(1, 3) : [],
  };
  Object.defineProperty(state, 'toJSON', { value: () => snapshot(state) });
  return Object.freeze(state);
}

/**
 * Starts a run.
 * @param {{seed?: number, config?: object}} [options]
 * @returns {object} frozen state
 */
export function createRun({ seed = 1, config = DEFAULT_RUN } = {}) {
  if (!Number.isInteger(seed)) throw new RangeError(`seed must be an integer, got ${seed}`);
  if (!config.endless && (!Array.isArray(config.stages) || config.stages.length === 0)) {
    throw new RangeError('config.stages must be a non-empty array of node counts');
  }
  if (config.endless && !(config.stageNodes?.start >= 2 && config.depotCurve?.start > 0)) {
    throw new RangeError('an endless config needs stageNodes and depotCurve');
  }
  const { graph, lattice, depot } = buildStage(seed, 0, config);
  return build(
    { seed, config, stage: 1, graph, lattice, score: 0, cleared: [] },
    [],
    depot,
  );
}

/**
 * Places the transmitter in hand on `id`. Final: there is no way back.
 * Placing on an occupied node, an unknown node, or once the run is over is a
 * no-op rather than an error, so a stray tap cannot corrupt a run.
 * @param {object} state
 * @param {*} id
 * @returns {object}
 */
export function place(state, id) {
  if (state.status !== 'playing') return state;
  if (!state.graph.nodes.some((node) => node.id === id)) return state;
  if (state.radii.has(id)) return state;

  const [radius, ...rest] = state.depot;
  const placed = [...state.placed, { id, radius }];
  const next = build(state, placed, rest);
  return next.status === 'playing' || next.status === 'lost'
    ? next
    : { ...next, cleared: [...state.cleared, { stage: state.stage, left: rest.length }] };
}

/**
 * Moves on to the next stage once the current one is clear.
 * @param {object} state
 * @returns {object}
 */
export function advance(state) {
  if (state.status !== 'stageCleared') return state;
  const index = state.stage;
  const { graph, lattice, depot } = buildStage(state.seed, index, state.config);
  return build(
    { ...state, stage: state.stage + 1, graph, lattice },
    [],
    depot,
  );
}

/**
 * Plain, JSON-serializable view of a run.
 * @param {object} state
 * @returns {object}
 */
export function snapshot(state) {
  return {
    seed: state.seed,
    stage: state.stage,
    stages: state.config.endless ? null : state.config.stages.length,
    /** The stage currently being played — the streak the player is on. */
    streak: state.stage,
    nodeCount: state.graph.nodes.length,
    lattice: state.lattice,
    status: state.status,
    score: state.score,
    current: state.current,
    preview: [...state.preview],
    depotLeft: state.depot.length,
    placed: state.placed.map(({ id, radius }) => ({ id: String(id), radius })),
    uncovered: state.uncovered.length,
    cleared: state.cleared.map((entry) => ({ ...entry })),
  };
}
