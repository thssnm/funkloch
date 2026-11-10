#!/usr/bin/env node
/**
 * What still changes between level 20 and level 60, and how often each level
 * is lost — measured level by level rather than run by run.
 *
 *   node tools/plateau.js --spec                     the curve, level by level
 *   node tools/plateau.js --levels --seeds=400       failure rate per level
 *   node tools/plateau.js --levels --variant=uncapped
 *   node tools/plateau.js --check                    bitset bots against bot64.js
 *   node tools/plateau.js --runs=300                 whole runs, for the cross-check
 *
 * Levels are independent. Level i of a run is drawn from `seed + i * 7919`
 * alone and deals a fresh hand, so whether a player survives it depends on
 * nothing that happened before. The chance of losing level L can therefore be
 * measured by playing level L on its own, over many seeds — on exactly the
 * boards a run would deal there — and the run length follows as the product
 * of the survival rates. A bot that never gets past level 8 can still say what
 * level 50 is like.
 *
 * Four players, from weak to perfect:
 *
 *   greedy    the most new nodes now
 *   planner   `lookaheadChoice`: three plies over the card in hand and the two
 *             shown — the bot every calibration so far was made against
 *   rollout   the information a person has: the card in hand, the two shown,
 *             and which cards are left (the hand's make-up is fixed by its
 *             size — 9 senders are always 3×r1, 4×r2, 2×r3 — and the count is
 *             on screen), but not their order. Each candidate is judged by how
 *             often greedy play finishes the board from there over shuffles of
 *             the hidden rest.
 *   solvable  whether the board can be cleared at all with this hand, order
 *             ignored: an exact set-cover search. No player does better, so
 *             its failure rate is a floor under everyone's.
 *
 * The bots here hold coverage in as many 32-bit words as the board needs, so
 * boards past 64 nodes — the second variant — can be played. `--check` plays
 * greedy and planner side by side with `bot64.js` and counts disagreements.
 */

import {
  amplifierNodes, bfsWithin, bfsWithinAmplified, bfsWithinBlocked, blockedNodes,
} from '../src/graph.js';
import { mulberry32 } from '../src/generator.js';
import {
  advance, createRun, DAILY_RUN, ENDLESS_RUN, levelSpec, place,
} from '../src/run.js';
import { pathToFileURL } from 'node:url';

import * as bot64 from './bot64.js';

// Run as a tool, it reads its flags; imported — the smoke test borrows the
// rollout bot to play a daily board through — it does nothing on its own, and
// in particular does not read the importer's flags as its own.
const main = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
const args = main ? Object.fromEntries(process.argv.slice(2).map((a) => {
  const [key, value] = a.replace(/^--/, '').split('=');
  return [key, value ?? true];
})) : {};

// ---- the curves -------------------------------------------------------------

/** The shipped curve, as levelSpec deals it. */
const shipped = (index) => levelSpec(ENDLESS_RUN, index);

/** Exponential part of the shipped curve, without rounding. */
const shippedRatio = (index) => {
  const c = ENDLESS_RUN.senderCurve;
  return c.floor + (c.start - c.floor) * Math.exp(-index / c.tau);
};
const shippedNodes = (index) => {
  const { start, growth, max } = ENDLESS_RUN.levelNodes;
  return Math.min(max, start + growth * index);
};
const spec = (nodeCount, ratio) => ({ nodeCount, ratio, senders: Math.max(1, Math.round(nodeCount * ratio)) });

/**
 * The variants under test. Each one deals level 1 as the onboarding board and
 * leaves every level up to `knee` exactly as shipped, so the entry does not
 * get harder by construction; only what comes after differs.
 */
const VARIANTS = {
  shipped: { label: 'ausgeliefert', spec: shipped },
  // The daily board as run.js deals it — `--check` holds it against daily-3,
  // the form it was measured in.
  daily: {
    label: 'Tagesbrett, wie ausgeliefert',
    last: DAILY_RUN.lastLevel,
    spec: (index) => levelSpec(DAILY_RUN, index),
  },
  // 1. The curve keeps falling: past the knee the ratio drops linearly by
  //    `slope` per level instead of settling on 0.15.
  ...Object.fromEntries([[8, 0.002], [8, 0.003], [8, 0.004], [8, 0.005], [10, 0.004], [12, 0.004]]
    .map(([knee, slope]) => [`fall-${knee}-${slope}`, {
      label: `fällt ab L${knee + 1} um ${slope}/Level`,
      spec: (index) => (index === 0 || index <= knee ? shipped(index)
        : spec(shippedNodes(index), shippedRatio(index) - slope * (index - knee))),
    }])),
  // 1b. What a falling curve comes down to on a 60-node board: the sender
  //     count is whole, 9 → 8 → 7, and 7 is a wall (three boards in four
  //     cannot be cleared at all). So: 8 from level `from` on, and stay there.
  ...Object.fromEntries([12, 14, 16, 18, 20].map((from) => [`eight-${from}`, {
    label: `ab L${from} 8 Sender auf 60`,
    spec: (index) => (index + 1 < from ? shipped(index) : spec(60, 8 / 60)),
  }])),
  // 3. Neither count nor size: the hand. 60 nodes and 9 senders stay, and
  //    from level `from` on the hand steps down one rung every `step` levels,
  //    from the shipped 3/4/2 towards smaller cards. Rungs ordered by reach
  //    per node, measured with `--grid=60:9:a/b/c`.
  ...Object.fromEntries([[12, 2], [12, 3], [12, 4], [14, 3]].map(([from, step]) => [`hand-${from}-${step}`, {
    label: `Hand ab L${from} alle ${step} Level eine Stufe kleiner`,
    spec: (index) => {
      if (index + 1 < from) return shipped(index);
      const rungs = [[3, 4, 2], [4, 3, 2], [3, 5, 1], [5, 2, 2], [4, 4, 1], [5, 3, 1]];
      const rung = rungs[Math.min(rungs.length - 1, Math.floor((index + 1 - from) / step))];
      return { ...spec(60, 9 / 60), composition: rung.map((count, k) => [k + 1, count]) };
    },
  }])),
  // The daily board as proposed on 2026-11-10: level 7 gets an eighth sender,
  // the board stays 60/9 from level 12, the hand steps down every `step`
  // levels, and the run ends after level 25.
  ...Object.fromEntries([3, 4].map((step) => [`daily-${step}`, {
    label: `Tagesbrett: L7 42/8, Hand ab L12 alle ${step} Level, Ende nach 25`,
    last: 25,
    spec: (index) => {
      if (index + 1 === 7) return { ...spec(42, 8 / 42) };
      if (index + 1 < 12) return shipped(index);
      const rungs = [[3, 4, 2], [4, 3, 2], [3, 5, 1], [5, 2, 2], [4, 4, 1], [5, 3, 1]];
      const rung = rungs[Math.min(rungs.length - 1, Math.floor((index + 1 - 12) / step))];
      return { ...spec(60, 9 / 60), composition: rung.map((count, k) => [k + 1, count]) };
    },
  }])),
  // 2. The board keeps growing past 60 nodes, at the same 4 per level, on the
  //    shipped ratio curve. `max` caps it again where a phone stops coping.
  ...Object.fromEntries([[Infinity], [100], [80]].map(([max]) => [`grow-${max}`, {
    label: max === Infinity ? 'wächst ohne Deckel' : `wächst bis ${max}`,
    spec: (index) => (index === 0 ? shipped(index)
      : spec(Math.min(max, 18 + 4 * index), shippedRatio(index))),
  }])),
};

/**
 * Level `index` (0-based) of seed `seed` as a one-level run. A fixed-length
 * config with this one size and ratio draws from the same `seed + index * 7919`
 * stream in the same order, so for the shipped curve this is bit for bit the
 * board and hand a run deals there — `--check` confirms it.
 */
function levelState(seed, index, variant) {
  const { nodeCount, ratio, composition } = variant.spec(index);
  const config = {
    endless: false,
    levelSizes: [nodeCount],
    senderRatio: [ratio],
    lattices: ENDLESS_RUN.lattices,
    // Weights equal to the counts and summing to the hand size make
    // fillSenders deal exactly those counts.
    composition: composition ?? ENDLESS_RUN.composition,
    blockedRatio: index === 0 ? 0 : ENDLESS_RUN.blockedRatio,
  };
  if (index === 0) {
    // The onboarding board: no blocked node and a fixed hand.
    return createRun({ seed, config: ENDLESS_RUN });
  }
  return createRun({ seed: seed + index * 7919, config });
}

// ---- bitsets of any width ---------------------------------------------------

function popcount(bits) {
  let x = bits - ((bits >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

/**
 * Every ball of radius 1..3 as a W-word bitmask. Same walk as run.js and bot64.
 */
function maskTable(graph) {
  const ids = graph.nodes.map((node) => node.id);
  const n = ids.length;
  const W = Math.ceil(n / 32);
  const seat = new Map(ids.map((id, i) => [id, i]));
  let ball = bfsWithin;
  if (amplifierNodes(graph).size > 0) ball = bfsWithinAmplified;
  else if (blockedNodes(graph).size > 0) ball = bfsWithinBlocked;
  const masks = new Int32Array(n * 4 * W);
  const sizes = new Int32Array(n * 4);
  for (let r = 1; r <= 3; r++) {
    for (let i = 0; i < n; i++) {
      let count = 0;
      for (const reached of ball(graph, ids[i], r)) {
        const bit = seat.get(reached);
        masks[(i * 4 + r) * W + (bit >>> 5)] |= 1 << (bit & 31);
        count++;
      }
      sizes[i * 4 + r] = count;
    }
  }
  // Who can reach node x with radius r: for the solver's branching.
  const coverers = Array.from({ length: n }, () => [[], [], [], []]);
  for (let r = 1; r <= 3; r++) {
    for (let i = 0; i < n; i++) {
      for (let x = 0; x < n; x++) {
        if (masks[(i * 4 + r) * W + (x >>> 5)] & (1 << (x & 31))) coverers[x][r].push(i);
      }
    }
  }
  return { ids, n, W, seat, masks, sizes, coverers };
}

const tables = new WeakMap();
function tableFor(graph) {
  let table = tables.get(graph);
  if (!table) { table = maskTable(graph); tables.set(graph, table); }
  return table;
}

function position(state, t) {
  const covered = new Int32Array(t.W);
  const used = new Int32Array(t.W);
  for (const [id, r] of state.radii) {
    const i = t.seat.get(id);
    used[i >>> 5] |= 1 << (i & 31);
    for (let w = 0; w < t.W; w++) covered[w] |= t.masks[(i * 4 + r) * t.W + w];
  }
  return { covered, used };
}

const isSet = (bits, i) => (bits[i >>> 5] & (1 << (i & 31))) !== 0;
function countOf(bits) { let c = 0; for (let w = 0; w < bits.length; w++) c += popcount(bits[w]); return c; }
function unionCount(bits, t, i, r) {
  let c = 0;
  const base = (i * 4 + r) * t.W;
  for (let w = 0; w < t.W; w++) c += popcount(bits[w] | t.masks[base + w]);
  return c;
}
function orInto(target, source, t, i, r) {
  const base = (i * 4 + r) * t.W;
  for (let w = 0; w < t.W; w++) target[w] = source[w] | t.masks[base + w];
}

// ---- greedy and planner, any width -------------------------------------------

/** bot64's greedyChoice, word for word on W words. */
function greedyChoice(state) {
  const t = tableFor(state.graph);
  const { covered, used } = position(state, t);
  const had = countOf(covered);
  let best = -1; let bestGain = -1;
  for (let i = 0; i < t.n; i++) {
    if (isSet(used, i)) continue;
    const gain = unionCount(covered, t, i, state.current) - had;
    if (gain > bestGain) { bestGain = gain; best = i; }
  }
  return best < 0 ? null : t.ids[best];
}

/** bot64's lookaheadChoice (beam 16, plain objective) on W words. */
function lookaheadChoice(state, beam = bot64.BEAM) {
  const t = tableFor(state.graph);
  const { covered, used } = position(state, t);
  const horizon = [state.current, ...state.preview].filter((r) => r !== undefined);
  const full = t.n;
  let bestScore = -1; let bestGain = -1; let bestFirst = -1;

  const walk = (depth, mask, taken, first, firstGain) => {
    const score = countOf(mask);
    if (depth === horizon.length || score === full) {
      const better = score !== bestScore ? score > bestScore : firstGain > bestGain;
      if (better) { bestScore = score; bestGain = firstGain; bestFirst = first; }
      return;
    }
    const r = horizon[depth];
    const moves = [];
    for (let i = 0; i < t.n; i++) {
      if (isSet(taken, i)) continue;
      const next = unionCount(mask, t, i, r);
      if (next === score) continue;
      moves.push({ i, gain: next - score });
    }
    if (depth > 0 && moves.length > beam) {
      moves.sort((a, b) => b.gain - a.gain || a.i - b.i);
      moves.length = beam;
    }
    for (const move of moves) {
      const nextMask = new Int32Array(t.W);
      orInto(nextMask, mask, t, move.i, r);
      const nextTaken = taken.slice();
      nextTaken[move.i >>> 5] |= 1 << (move.i & 31);
      walk(depth + 1, nextMask, nextTaken, depth === 0 ? move.i : first, depth === 0 ? move.gain : firstGain);
    }
  };
  walk(0, covered, used, -1, -1);
  if (bestFirst >= 0) return t.ids[bestFirst];
  return state.graph.nodes.find((node) => !state.radii.has(node.id))?.id ?? null;
}

// ---- rollout: what a person knows ---------------------------------------------

/**
 * Judges each placement by how often greedy play clears the board from there,
 * over `samples` orders of the hidden cards. The two shown cards keep their
 * places; only the rest is shuffled — it is known what is left, not in which
 * order. Ties go to the placement that ends with more lit on average, then to
 * the one that lights more right away. The same shuffles are used for every
 * candidate, so they are compared on equal draws.
 */
export function rolloutChoice(state, samples = 24) {
  const t = tableFor(state.graph);
  const { covered, used } = position(state, t);
  const had = countOf(covered);
  const shown = state.preview;
  const hidden = state.senders.slice(1 + shown.length);
  const rng = mulberry32((state.seed * 31 + state.level * 1009 + state.placed.length * 97) | 0);
  const orders = Array.from({ length: samples }, () => {
    const rest = hidden.slice();
    for (let k = rest.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1));
      [rest[k], rest[j]] = [rest[j], rest[k]];
    }
    return [...shown, ...rest];
  });

  const candidates = [];
  for (let i = 0; i < t.n; i++) {
    if (isSet(used, i)) continue;
    const gain = unionCount(covered, t, i, state.current) - had;
    if (gain > 0) candidates.push({ i, gain });
  }
  if (candidates.length === 0) return greedyChoice(state);
  if (candidates.length === 1) return t.ids[candidates[0].i];

  const mask = new Int32Array(t.W);
  const taken = new Int32Array(t.W);
  let best = null;
  for (const cand of candidates) {
    let wins = 0; let lit = 0;
    for (const order of orders) {
      orInto(mask, covered, t, cand.i, state.current);
      taken.set(used);
      taken[cand.i >>> 5] |= 1 << (cand.i & 31);
      let count = countOf(mask);
      for (const r of order) {
        if (count === t.n) break;
        let pick = -1; let pickCount = -1;
        for (let i = 0; i < t.n; i++) {
          if (isSet(taken, i)) continue;
          const c = unionCount(mask, t, i, r);
          if (c > pickCount) { pickCount = c; pick = i; }
        }
        if (pick < 0) break;
        orInto(mask, mask, t, pick, r);
        taken[pick >>> 5] |= 1 << (pick & 31);
        count = pickCount;
      }
      if (count === t.n) wins++;
      lit += count;
    }
    const value = { i: cand.i, wins, lit, gain: cand.gain };
    if (best === null || value.wins > best.wins
      || (value.wins === best.wins && (value.lit > best.lit
        || (value.lit === best.lit && value.gain > best.gain)))) best = value;
  }
  return t.ids[best.i];
}

// ---- solvable: the floor under every player ------------------------------------

/**
 * Whether the hand can clear the board at all, in any order. Exact: branches
 * on the dark node with the fewest ways to be lit, prunes when even the best
 * ball for each remaining card could not light what is left. Gives up after
 * `budget` search nodes and says so (null), rather than guessing.
 */
function solvable(state, budget = 2_000_000) {
  const t = tableFor(state.graph);
  const { covered, used } = position(state, t);
  const counts = [0, 0, 0, 0];
  for (const r of state.senders) counts[r]++;
  const dark = new Int32Array(t.W);
  for (let x = 0; x < t.n; x++) if (!isSet(covered, x)) dark[x >>> 5] |= 1 << (x & 31);
  let visited = 0;

  const gainOn = (d, i, r) => {
    let c = 0;
    const base = (i * 4 + r) * t.W;
    for (let w = 0; w < t.W; w++) c += popcount(d[w] & t.masks[base + w]);
    return c;
  };

  const search = (d, taken) => {
    const left = countOf(d);
    if (left === 0) return true;
    if (++visited > budget) throw new Error('budget');
    // Bound: each remaining card lights at most the best ball for its radius.
    let bound = 0;
    for (let r = 1; r <= 3; r++) {
      if (counts[r] === 0) continue;
      let top = 0;
      for (let i = 0; i < t.n; i++) {
        if (isSet(taken, i)) continue;
        const g = gainOn(d, i, r);
        if (g > top) top = g;
      }
      bound += top * counts[r];
    }
    if (bound < left) return false;
    // The dark node with the fewest ways to be lit.
    let target = -1; let fewest = Infinity;
    for (let x = 0; x < t.n; x++) {
      if (!isSet(d, x)) continue;
      let ways = 0;
      for (let r = 1; r <= 3; r++) {
        if (counts[r] === 0) continue;
        for (const i of t.coverers[x][r]) if (!isSet(taken, i)) ways++;
      }
      if (ways < fewest) { fewest = ways; target = x; if (ways <= 1) break; }
    }
    if (fewest === 0) return false;
    const options = [];
    for (let r = 1; r <= 3; r++) {
      if (counts[r] === 0) continue;
      for (const i of t.coverers[target][r]) {
        if (!isSet(taken, i)) options.push({ r, i, g: gainOn(d, i, r) });
      }
    }
    // Smallest radius first among equal gains: a bigger card saved is never worse.
    options.sort((a, b) => b.g - a.g || a.r - b.r);
    for (const { r, i } of options) {
      counts[r]--;
      const next = new Int32Array(t.W);
      const base = (i * 4 + r) * t.W;
      for (let w = 0; w < t.W; w++) next[w] = d[w] & ~t.masks[base + w];
      const nextTaken = taken.slice();
      nextTaken[i >>> 5] |= 1 << (i & 31);
      const ok = search(next, nextTaken);
      counts[r]++;
      if (ok) return true;
    }
    return false;
  };

  try {
    return search(dark, used);
  } catch (error) {
    if (error.message === 'budget') return null;
    throw error;
  }
}

// ---- playing a level ---------------------------------------------------------

const BOTS = {
  greedy: greedyChoice,
  planner: (state) => lookaheadChoice(state),
  rollout: (state) => rolloutChoice(state),
};

/** Plays one level to its end; true if it was cleared. */
function playLevel(state, choose) {
  while (state.status === 'playing') {
    const id = choose(state);
    if (id === null) return false;
    state = place(state, id);
  }
  return state.status === 'won' || state.status === 'levelCleared';
}

/** Mean ball size per radius on this board, over every node. */
function ballSizes(state) {
  const t = tableFor(state.graph);
  const mean = [0, 0, 0, 0];
  for (let r = 1; r <= 3; r++) {
    let sum = 0;
    for (let i = 0; i < t.n; i++) sum += t.sizes[i * 4 + r];
    mean[r] = sum / t.n;
  }
  return mean;
}

const fmt = (x, d = 2) => x.toFixed(d);
const pct = (x) => `${(100 * x).toFixed(1)} %`;

// ---- modes -------------------------------------------------------------------

function variantOf(name) {
  const v = VARIANTS[name ?? 'shipped'];
  if (!v) throw new Error(`unbekannte Variante ${name}; bekannt: ${Object.keys(VARIANTS).join(', ')}`);
  return v;
}

function parseLevels(text, fallback) {
  if (!text || text === true) return fallback;
  return text.split(',').flatMap((part) => {
    const [a, b] = part.split('-').map(Number);
    return b === undefined ? [a] : Array.from({ length: b - a + 1 }, (_, k) => a + k);
  });
}

if (args.spec) {
  const variant = variantOf(args.variant);
  const levels = parseLevels(args.level, [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60]);
  const seeds = Number(args.seeds ?? 100);
  console.log(`Kurve „${variant.label}", Ballgrößen über ${seeds} Bretter je Level`);
  console.log('Level  Knoten  Verhältnis  Sender  Hand r1/r2/r3   Ball r1/r2/r3        Hand-Ball  Reichweite/Knoten');
  for (const level of levels) {
    const index = level - 1;
    const s = variant.spec(index);
    const sums = [0, 0, 0, 0];
    let hand = null; let reach = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const state = levelState(seed, index, variant);
      const mean = ballSizes(state);
      for (let r = 1; r <= 3; r++) sums[r] += mean[r];
      hand ??= [1, 2, 3].map((r) => state.senders.filter((x) => x === r).length);
      reach += state.senders.reduce((sum, r) => sum + mean[r], 0) / state.graph.nodes.length;
    }
    const ball = sums.map((x) => x / seeds);
    const handBall = (hand[0] * ball[1] + hand[1] * ball[2] + hand[2] * ball[3]) / s.senders;
    console.log(`${String(level).padStart(5)}  ${String(s.nodeCount).padStart(6)}  ${fmt(s.ratio, 4).padStart(10)}  ${String(s.senders).padStart(6)}  `
      + `${hand.join('/').padEnd(14)} ${[1, 2, 3].map((r) => fmt(ball[r], 2)).join(' / ').padEnd(20)} `
      + `${fmt(handBall, 2).padStart(9)}  ${fmt(reach / seeds, 2).padStart(17)}`);
  }
}

if (args.levels) {
  const variant = variantOf(args.variant);
  const levels = parseLevels(args.level, [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 30, 40, 60]);
  const seeds = Number(args.seeds ?? 400);
  const first = Number(args.from ?? 1);
  const bots = (args.bots && args.bots !== true ? args.bots.split(',') : ['greedy', 'planner', 'rollout', 'solvable']);
  console.log(`Kurve „${variant.label}", Scheitern je Level, ${seeds} Seeds ab ${first}, jedes Level für sich`);
  console.log(`Level  Knoten  Sender  ${bots.map((b) => b.padStart(16)).join('')}`);
  for (const level of levels) {
    const index = level - 1;
    const s = variant.spec(index);
    const lost = Object.fromEntries(bots.map((b) => [b, 0]));
    let undecided = 0;
    const started = Date.now();
    for (let seed = first; seed < first + seeds; seed++) {
      const state = levelState(seed, index, variant);
      for (const bot of bots) {
        if (bot === 'solvable') {
          const ok = solvable(state);
          if (ok === null) undecided++;
          else if (!ok) lost.solvable++;
        } else if (!playLevel(state, BOTS[bot])) lost[bot]++;
      }
    }
    const cells = bots.map((b) => {
      const p = lost[b] / (b === 'solvable' ? seeds - undecided : seeds);
      return `${pct(p)} (${lost[b]})`.padStart(16);
    });
    console.log(`${String(level).padStart(5)}  ${String(s.nodeCount).padStart(6)}  ${String(s.senders).padStart(6)}  ${cells.join('')}`
      + `${undecided ? `  ${undecided} offen` : ''}  ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
}

/**
 * Failure rate of a level of `nodeCount` nodes and `senders` senders. Past the
 * onboarding board a level's chances depend on nothing else: the lattice, the
 * blocked share and the hand's make-up are drawn the same way at every index.
 * Measured on the seeds level `index` would use, cached per pair.
 */
const rates = new Map();
function rateOf(index, variant, bots, seeds) {
  const s = variant.spec(index);
  const key = index === 0 ? 'onboarding'
    : `${s.nodeCount}:${s.senders}${s.composition ? `:${s.composition.map(([r, c]) => `${c}×r${r}`).join('+')}` : ''}`;
  if (rates.has(key)) return rates.get(key);
  const lost = Object.fromEntries(bots.map((b) => [b, 0]));
  let undecided = 0;
  const started = Date.now();
  for (let seed = 1; seed <= seeds; seed++) {
    const state = levelState(seed, index, variant);
    for (const bot of bots) {
      if (bot === 'solvable') {
        const ok = solvable(state);
        if (ok === null) undecided++;
        else if (!ok) lost.solvable++;
      } else if (!playLevel(state, BOTS[bot])) lost[bot]++;
    }
  }
  const p = Object.fromEntries(bots.map((b) => [b, lost[b] / (b === 'solvable' ? seeds - undecided : seeds)]));
  const rate = { key, p, undecided, seconds: (Date.now() - started) / 1000 };
  rates.set(key, rate);
  console.error(`  gemessen ${key}: ${bots.map((b) => `${b} ${pct(p[b])}`).join(', ')}`
    + `${undecided ? `, ${undecided} offen` : ''} (${rate.seconds.toFixed(0)}s)`);
  return rate;
}

if (args.grid) {
  const bots = (args.bots && args.bots !== true ? args.bots.split(',') : ['planner', 'rollout', 'solvable']);
  const seeds = Number(args.seeds ?? 1000);
  console.log(`Scheitern je Brett aus Knoten:Sendern, ${seeds} Seeds`);
  console.log(`Knoten  Sender  Verh.   ${bots.map((b) => b.padStart(12)).join('')}`);
  for (const pair of args.grid.split(',')) {
    // `n:s` deals the shipped mix; `n:s:a/b/c` deals exactly a r1, b r2, c r3.
    const [n, s, hand] = pair.split(':');
    const counts = hand?.split('/').map(Number);
    const variant = {
      spec: () => ({
        nodeCount: Number(n),
        ratio: Number(s) / Number(n),
        senders: Number(s),
        ...(counts ? { composition: counts.map((count, k) => [k + 1, count]).filter(([, c]) => c > 0) } : {}),
      }),
    };
    const rate = rateOf(20, variant, bots, seeds);
    console.log(`${String(n).padStart(6)}  ${String(s).padStart(6)}  ${fmt(Number(s) / Number(n), 3)}  `
      + `${(hand ?? '').padEnd(7)} `
      + `${bots.map((b) => pct(rate.p[b]).padStart(12)).join('')}${rate.undecided ? `  ${rate.undecided} offen` : ''}`);
  }
}

if (args.compose) {
  // A run is a chain of independent levels, so its length follows from the
  // per-level rates: P(at least k cleared) is the product of the first k
  // survival rates. Past `upto` the last rate is assumed to hold, which on a
  // curve that has flattened out is what it does.
  const bots = (args.bots && args.bots !== true ? args.bots.split(',') : ['planner', 'rollout', 'solvable']);
  const seeds = Number(args.seeds ?? 1000);
  // A guessed human: the rollout bot's rate on every level times k
  // (`--human=1.7,1.9`). An assumption from one observation, see MESSUNGEN.md.
  const humans = args.human && args.human !== true ? args.human.split(',').map(Number) : [];
  const names = args.compose === true ? ['shipped'] : args.compose.split(',');
  for (const name of names) {
    const variant = variantOf(name);
    // A variant with a last level ends there: no tail past it.
    const finite = variant.last !== undefined;
    const upto = finite ? variant.last : Number(args.upto ?? 60);
    const perLevel = [];
    for (let index = 0; index < upto; index++) perLevel.push(rateOf(index, variant, bots, seeds));
    console.log(`\n„${variant.label}" (${name}), ${seeds} Seeds je Brettgröße, Level 1–${upto}`
      + `${finite ? ', danach Ende' : `, danach Level ${upto} fortgesetzt`}`);
    const specs = perLevel.map((_, index) => variant.spec(index));
    console.log(`  Kurve: ${specs.map((s, i) => `L${i + 1} ${s.nodeCount}/${s.senders}`
      + `${s.composition ? ` ${s.composition.map(([, c]) => c).join('/')}` : ''}`)
      .filter((_, i) => i < 12 || (i + 1) % 5 === 0 || (finite && i + 1 >= 12)).join(' · ')}`);
    const rows = [
      ...bots.map((bot) => [bot, perLevel.map((rate) => rate.p[bot])]),
      ...(bots.includes('rollout') ? humans : []).map((k) => [`Mensch ${k}`,
        perLevel.map((rate) => Math.min(1, k * rate.p.rollout))]),
    ];
    for (const [who, p] of rows) {
      let alive = 1; let mean = 0; let median = null;
      const atLeast = {};
      for (let k = 1; k <= upto; k++) {
        alive *= 1 - p[k - 1];
        mean += alive;
        if (median === null && alive < 0.5) median = k - 1;
        if ([10, 20, 25, 30, 40, 60].includes(k)) atLeast[k] = alive;
      }
      const q = p[upto - 1];
      let tailMedian = median;
      if (median === null) {
        // Still above one half at `upto`: carry on at the last rate, or, on a
        // run with an end, the median run plays it through.
        tailMedian = finite ? `${upto} (durch)`
          : q > 0 ? upto + Math.floor(Math.log(0.5 / alive) / Math.log(1 - q)) : Infinity;
      }
      if (!finite) mean += q > 0 ? alive * (1 - q) / q : Infinity;
      const quartile = (target) => {
        let a = 1;
        for (let k = 1; k <= upto; k++) { a *= 1 - p[k - 1]; if (a < target) return k - 1; }
        if (finite) return upto;
        return q > 0 ? upto + Math.floor(Math.log(target / a) / Math.log(1 - q)) : Infinity;
      };
      console.log(`  ${who.padEnd(11)} Median ${String(tailMedian).padStart(4)}  Mittel ${fmt(mean, 1).padStart(6)}`
        + `  Quartile ${quartile(0.75)}–${quartile(0.25)}`
        + `  ≥10 ${pct(atLeast[10] ?? 0)}  ≥20 ${pct(atLeast[20] ?? 0)}  ≥25 ${pct(atLeast[25] ?? 0)}`
        + `${finite ? '' : `  ≥30 ${pct(atLeast[30] ?? 0)}  Plateau ${pct(q)}`}`);
    }
  }
}

if (args.check) {
  // 1. The one-level construction deals what a run deals, for the endless
  //    curve and for the daily board. The daily runs are played by the
  //    rollout bot, which gets far enough to reach the hand ladder.
  for (const [config, variant, choose, seeds] of [
    [ENDLESS_RUN, VARIANTS.shipped, bot64.lookaheadChoice, 40],
    [DAILY_RUN, VARIANTS.daily, rolloutChoice, 12],
  ]) {
    let same = 0; let compared = 0; let deepest = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      let state = createRun({ seed, config });
      while (state.status === 'playing' || state.status === 'levelCleared') {
        if (state.status === 'levelCleared') { state = advance(state); continue; }
        if (state.placed.length === 0) {
          const alone = levelState(seed, state.level - 1, variant);
          compared++;
          deepest = Math.max(deepest, state.level);
          const shape = (s) => JSON.stringify([s.graph.nodes.map((n) => [n.id, !!n.blocked]), s.graph.edges, s.senders]);
          if (shape(alone) === shape(state)) same++;
        }
        state = place(state, choose(state));
      }
    }
    console.log(`„${variant.label}": einzeln gebaute Level gleich dem Lauf: ${same} / ${compared}`
      + ` (bis Level ${deepest})`);
  }
  // The daily board deals what was measured as daily-3.
  const differ = [];
  for (let index = 0; index < DAILY_RUN.lastLevel; index++) {
    const a = JSON.stringify(VARIANTS.daily.spec(index));
    const b = JSON.stringify(VARIANTS['daily-3'].spec(index));
    if (a !== b) differ.push(`L${index + 1}: ${a} ≠ ${b}`);
  }
  console.log(`Tagesbrett gleich daily-3: ${differ.length === 0 ? 'ja, alle 25 Level' : differ.join('; ')}`);
  // 2. The bitset bots choose what bot64 chooses.
  let moves = 0; let greedyOff = 0; let plannerOff = 0;
  for (let seed = 1; seed <= 60; seed++) {
    for (const index of [1, 4, 9, 14, 30]) {
      let state = levelState(seed, index, VARIANTS.shipped);
      while (state.status === 'playing') {
        moves++;
        if (greedyChoice(state) !== bot64.greedyChoice(state)) greedyOff++;
        const mine = lookaheadChoice(state);
        if (mine !== bot64.lookaheadChoice(state)) plannerOff++;
        state = place(state, mine);
      }
    }
  }
  console.log(`Züge verglichen: ${moves}, gierig abweichend: ${greedyOff}, Planer abweichend: ${plannerOff}`);
}

if (args.runs) {
  // Whole runs with the planner, to hold the product of the per-level rates
  // against the real thing.
  const runs = Number(args.runs);
  const streaks = [];
  for (let seed = 1; seed <= runs; seed++) {
    let state = createRun({ seed, config: ENDLESS_RUN });
    while (state.status === 'playing' || state.status === 'levelCleared') {
      if (state.status === 'levelCleared') { state = advance(state); continue; }
      state = place(state, bot64.lookaheadChoice(state));
    }
    streaks.push(state.cleared.length);
  }
  streaks.sort((a, b) => a - b);
  const mean = streaks.reduce((a, b) => a + b, 0) / runs;
  console.log(`Planer, ${runs} ganze Läufe: Median ${streaks[Math.floor(runs / 2)]}, Mittel ${fmt(mean)}`);
  const hist = new Map();
  for (const s of streaks) hist.set(s + 1, (hist.get(s + 1) ?? 0) + 1);
  // Hazard: of the runs that reached level L, how many died there.
  let alive = runs;
  const rows = [];
  for (let level = 1; level <= 25 && alive > 0; level++) {
    const died = hist.get(level) ?? 0;
    rows.push(`L${level}: ${pct(died / alive)} von ${alive}`);
    alive -= died;
  }
  console.log(rows.join(' · '));
}
