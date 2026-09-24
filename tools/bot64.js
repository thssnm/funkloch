/**
 * The two bots again, for boards of up to 64 nodes.
 *
 * `tools/bot.js` holds a board's coverage in one 32-bit integer, which is what
 * makes its three-ply search cheap — and what stops it at 30 nodes. The endless
 * mode grows boards past that, so this module keeps the same two strategies but
 * carries the coverage set in two words (`lo`, `hi`).
 *
 * The second difference is the search width. Exhausting three plies over 60
 * free nodes is 200k leaves per move, far too much for thousands of runs, so
 * plies two and three only look at the `beam` best openings by immediate gain.
 * Ply one stays exhaustive — that is the move actually being chosen. With
 * `beam: Infinity` the search is the exact one, and `tools/verify-bot64.js`
 * checks that narrow and exact agree on the small boards where both fit.
 *
 * Both bots read the board through the impermeable-aware walk, which on a board
 * without blocked nodes is the ordinary one.
 */

import { bfsWithin, bfsWithinBlocked, blockedNodes } from '../src/graph.js';

/**
 * Default beam width for plies two and three. Measured against the exact search
 * on 2097 moves of the standard run: beam 4 picks a different move on 5.2% of
 * them, beam 8 on 1.8%, beam 12 on 0.3%, beam 16 on 0.05%, beam 24 on none.
 * 16 buys the exactness for a few percent of runtime.
 */
export const BEAM = 16;

/** @param {number} bits @returns {number} how many are set */
function popcount(bits) {
  let x = bits - ((bits >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  x = (x + (x >> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >> 24;
}

/**
 * Every ball of radius 1..3 as a two-word bitmask, one bit per node.
 * @param {import('../src/graph.js').Graph} graph
 * @returns {{ids: Array<*>, lo: Int32Array, hi: Int32Array, fullLo: number, fullHi: number}}
 */
export function maskTable(graph) {
  const ids = graph.nodes.map((node) => node.id);
  const size = ids.length;
  if (size > 64) throw new RangeError(`the bitmask search handles at most 64 nodes, got ${size}`);
  const index = new Map(ids.map((id, i) => [id, i]));
  const ball = blockedNodes(graph).size > 0 ? bfsWithinBlocked : bfsWithin;

  const lo = new Int32Array(size * 4);
  const hi = new Int32Array(size * 4);
  for (let radius = 1; radius <= 3; radius++) {
    for (let i = 0; i < size; i++) {
      let maskLo = 0;
      let maskHi = 0;
      for (const reached of ball(graph, ids[i], radius)) {
        const bit = index.get(reached);
        if (bit < 32) maskLo |= 1 << bit;
        else maskHi |= 1 << (bit - 32);
      }
      lo[i * 4 + radius] = maskLo;
      hi[i * 4 + radius] = maskHi;
    }
  }
  return {
    ids, lo, hi,
    fullLo: size >= 32 ? -1 : (1 << size) - 1,
    fullHi: size <= 32 ? 0 : (size === 64 ? -1 : (1 << (size - 32)) - 1),
  };
}

/** One table per board object; a stage keeps its graph for its whole life. */
const cache = new WeakMap();
export function tableFor(graph) {
  let table = cache.get(graph);
  if (table === undefined) {
    table = maskTable(graph);
    cache.set(graph, table);
  }
  return table;
}

/**
 * The board as the search sees it: what is lit, and what is taken.
 * @param {object} state
 * @param {ReturnType<maskTable>} table
 */
function position(state, table) {
  const seat = new Map(table.ids.map((id, i) => [id, i]));
  let coveredLo = 0; let coveredHi = 0; let usedLo = 0; let usedHi = 0;
  for (const [id, radius] of state.radii) {
    const i = seat.get(id);
    if (i < 32) usedLo |= 1 << i; else usedHi |= 1 << (i - 32);
    coveredLo |= table.lo[i * 4 + radius];
    coveredHi |= table.hi[i * 4 + radius];
  }
  return { coveredLo, coveredHi, usedLo, usedHi };
}

/**
 * Greedy: the free node whose ball lights the most dark nodes, ties by node
 * order. Same rule as `bot.js`'s `greedyChoice`, read off the mask table.
 * @param {object} state
 * @returns {*} node id
 */
export function greedyChoice(state) {
  const table = tableFor(state.graph);
  const { coveredLo, coveredHi, usedLo, usedHi } = position(state, table);
  const size = table.ids.length;
  const radius = state.current;
  const had = popcount(coveredLo) + popcount(coveredHi);

  let best = -1;
  let bestGain = -1;
  for (let i = 0; i < size; i++) {
    if (i < 32 ? (usedLo & (1 << i)) : (usedHi & (1 << (i - 32)))) continue;
    const gain = popcount(coveredLo | table.lo[i * 4 + radius])
      + popcount(coveredHi | table.hi[i * 4 + radius]) - had;
    if (gain > bestGain) { bestGain = gain; best = i; }
  }
  return best < 0 ? null : table.ids[best];
}

/**
 * Planning: judges a placement by what the board looks like once the two
 * transmitters the player can also see have been placed as well. Ties on the
 * final count go to the opening that lights more right away.
 * @param {object} state
 * @param {{beam?: number}} [options]
 * @returns {*} node id
 */
export function lookaheadChoice(state, { beam = BEAM } = {}) {
  const table = tableFor(state.graph);
  const { lo, hi, ids, fullLo, fullHi } = table;
  const size = ids.length;
  const { coveredLo, coveredHi, usedLo, usedHi } = position(state, table);

  const horizon = [state.current, ...state.preview].filter((radius) => radius !== undefined);
  let bestScore = -1;
  let bestGain = -1;
  let bestFirst = -1;

  /**
   * @param {number} depth ply to fill next
   * @param {number} first index chosen at ply one, carried down to the leaf
   */
  const walk = (depth, maskLo, maskHi, takenLo, takenHi, first, firstGain) => {
    const score = popcount(maskLo) + popcount(maskHi);
    if (depth === horizon.length || (maskLo === fullLo && maskHi === fullHi)) {
      if (score > bestScore || (score === bestScore && firstGain > bestGain)) {
        bestScore = score;
        bestGain = firstGain;
        bestFirst = first;
      }
      return;
    }
    const radius = horizon[depth];

    // Collect the candidates for this ply, then keep only the `beam` best when
    // this is a hypothetical one. Ply one is never narrowed.
    const moves = [];
    for (let i = 0; i < size; i++) {
      if (i < 32 ? (takenLo & (1 << i)) : (takenHi & (1 << (i - 32)))) continue;
      const nextLo = maskLo | lo[i * 4 + radius];
      const nextHi = maskHi | hi[i * 4 + radius];
      if (nextLo === maskLo && nextHi === maskHi) continue; // lights nothing new
      moves.push({ i, nextLo, nextHi, gain: popcount(nextLo) + popcount(nextHi) - score });
    }
    if (depth > 0 && moves.length > beam) {
      moves.sort((a, b) => b.gain - a.gain || a.i - b.i);
      moves.length = beam;
    }
    for (const move of moves) {
      walk(
        depth + 1, move.nextLo, move.nextHi,
        move.i < 32 ? takenLo | (1 << move.i) : takenLo,
        move.i < 32 ? takenHi : takenHi | (1 << (move.i - 32)),
        depth === 0 ? move.i : first,
        depth === 0 ? move.gain : firstGain,
      );
    }
  };
  walk(0, coveredLo, coveredHi, usedLo, usedHi, -1, -1);

  if (bestFirst >= 0) return ids[bestFirst];
  // Nothing left that adds anything: put it down anywhere free.
  return state.graph.nodes.find((node) => !state.radii.has(node.id))?.id ?? null;
}
