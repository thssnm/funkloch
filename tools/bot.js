#!/usr/bin/env node
/**
 * Greedy bot for the bag mode, and the sweep that says where greedy breaks.
 *
 *   node tools/bot.js [--runs=1000] [--seed=1]
 *
 * The bot places every transmitter wherever it lights the most nodes that are
 * still dark, breaking ties by node order. That is the obvious strategy, and
 * the point of measuring it is to find the bag size where it stops being
 * enough: below that the mode plays itself, above it there is nothing to think
 * about. A human who plans ahead has to beat greedy, or the choice is not a
 * choice.
 */

import { bfsWithin } from '../src/graph.js';
import { advance, createRun, DEFAULT_RUN, place, remove } from '../src/run.js';

/**
 * Best node for the transmitter in hand: the one lighting the most dark nodes.
 * @param {object} state
 * @returns {*} node id
 */
export function greedyChoice(state) {
  const dark = new Set(state.uncovered);
  let best = null;
  let bestGain = -1;
  for (const node of state.graph.nodes) {
    if (state.radii.has(node.id)) continue; // already holds a transmitter
    let gain = 0;
    for (const reached of bfsWithin(state.graph, node.id, state.current)) {
      if (dark.has(reached)) gain++;
    }
    if (gain > bestGain) {
      bestGain = gain;
      best = node.id;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The planning bot
// ---------------------------------------------------------------------------

/** @param {number} bits @returns {number} how many are set */
function popcount(bits) {
  let x = bits - ((bits >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  x = (x + (x >> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >> 24;
}

/**
 * Precomputes every ball as a bitmask, one bit per node.
 *
 * Boards here top out at 30 nodes, so a whole coverage set fits in a 32-bit
 * integer and union and count are single operations. Without that the
 * three-deep search below would be far too slow to run thousands of times.
 * @param {import('../src/graph.js').Graph} graph
 * @returns {{ids: Array<*>, balls: Int32Array}}
 */
function maskTable(graph) {
  const ids = graph.nodes.map((node) => node.id);
  if (ids.length > 30) throw new RangeError(`the bitmask search handles at most 30 nodes, got ${ids.length}`);
  const index = new Map(ids.map((id, i) => [id, i]));
  // balls[i * 4 + radius] for radius 1..3
  const balls = new Int32Array(ids.length * 4);
  for (let radius = 1; radius <= 3; radius++) {
    for (let i = 0; i < ids.length; i++) {
      let mask = 0;
      for (const reached of bfsWithin(graph, ids[i], radius)) mask |= 1 << index.get(reached);
      balls[i * 4 + radius] = mask;
    }
  }
  return { ids, balls };
}

/** Cache, because the board is rebuilt only when the stage changes. */
const maskCache = new WeakMap();
const tableFor = (graph) => {
  let table = maskCache.get(graph);
  if (table === undefined) {
    table = maskTable(graph);
    maskCache.set(graph, table);
  }
  return table;
};

/**
 * Best placement for the transmitter in hand, judged by where the board stands
 * after the two the player can also see have been placed.
 *
 * The search is exact over the visible horizon: every ordering of the up-to-3
 * known radii across free nodes. Placements that light nothing new are skipped,
 * since they can never help coverage. Ties on the final count go to the opening
 * that covers more immediately, which keeps the bot from dawdling.
 *
 * @param {object} state
 * @returns {*} node id
 */
export function lookaheadChoice(state) {
  const { ids, balls } = tableFor(state.graph);
  const size = ids.length;
  const full = size === 32 ? -1 : (1 << size) - 1;

  let covered = 0;
  let occupied = 0;
  for (const [id, radius] of state.radii) {
    const i = ids.indexOf(id);
    occupied |= 1 << i;
    covered |= balls[i * 4 + radius];
  }

  const horizon = [state.current, ...state.preview].filter((radius) => radius !== undefined);
  let bestScore = -1;
  let bestGain = -1;
  let bestFirst = -1;

  const walk = (depth, mask, used, first, firstGain) => {
    if (depth === horizon.length || mask === full) {
      const score = popcount(mask);
      if (score > bestScore || (score === bestScore && firstGain > bestGain)) {
        bestScore = score;
        bestGain = firstGain;
        bestFirst = first;
      }
      return;
    }
    const radius = horizon[depth];
    for (let i = 0; i < size; i++) {
      if (used & (1 << i)) continue;
      const next = mask | balls[i * 4 + radius];
      if (next === mask) continue; // lights nothing new
      walk(
        depth + 1,
        next,
        used | (1 << i),
        depth === 0 ? i : first,
        depth === 0 ? popcount(next) - popcount(mask) : firstGain,
      );
    }
  };
  walk(0, covered, occupied, -1, -1);

  if (bestFirst >= 0) return ids[bestFirst];
  // Nothing on the board can add anything: drop it on any free node.
  return state.graph.nodes.find((node) => !state.radii.has(node.id))?.id ?? null;
}

/**
 * Like {@link lookaheadChoice}, but also willing to clear a node it has already
 * used. Removal costs the transmitter that was standing there and gives nothing
 * back, so it only pays when the node itself is worth more than the ball it
 * currently carries — a radius-1 sitting where a radius-3 wants to go.
 *
 * Repairs are considered for the move in hand only; the two lookahead plies
 * stay on free nodes.
 *
 * @param {object} state
 * @returns {{remove: *|null, place: *}|null}
 */
export function repairChoice(state) {
  const { ids, balls } = tableFor(state.graph);
  const size = ids.length;
  const full = size === 32 ? -1 : (1 << size) - 1;

  const standing = [];
  let occupied = 0;
  for (const [id, radius] of state.radii) {
    const i = ids.indexOf(id);
    occupied |= 1 << i;
    standing.push({ i, mask: balls[i * 4 + radius] });
  }
  const coveredBy = (skip) => {
    let mask = 0;
    for (let j = 0; j < standing.length; j++) if (j !== skip) mask |= standing[j].mask;
    return mask;
  };
  const covered = coveredBy(-1);

  const horizon = [state.current, ...state.preview].filter((radius) => radius !== undefined);
  let best = { score: -1, gain: -1, place: -1, remove: null };

  /** Explores the two hypothetical plies over free nodes. */
  const walk = (depth, mask, used, opening) => {
    if (depth === horizon.length || mask === full) {
      const score = popcount(mask);
      if (score > best.score || (score === best.score && opening.gain > best.gain)) {
        best = { score, gain: opening.gain, place: opening.place, remove: opening.remove };
      }
      return;
    }
    const radius = horizon[depth];
    for (let i = 0; i < size; i++) {
      if (used & (1 << i)) continue;
      const next = mask | balls[i * 4 + radius];
      if (next === mask) continue;
      walk(depth + 1, next, used | (1 << i), opening);
    }
  };

  const radius = horizon[0];
  // Plain placements on free nodes.
  for (let i = 0; i < size; i++) {
    if (occupied & (1 << i)) continue;
    const next = covered | balls[i * 4 + radius];
    if (next === covered) continue;
    walk(1, next, occupied | (1 << i), {
      place: i, remove: null, gain: popcount(next) - popcount(covered),
    });
  }
  // Placements that first clear the node.
  for (let j = 0; j < standing.length; j++) {
    const i = standing[j].i;
    const withoutIt = coveredBy(j);
    const next = withoutIt | balls[i * 4 + radius];
    if (next === withoutIt) continue;
    walk(1, next, occupied | (1 << i), {
      place: i, remove: i, gain: popcount(next) - popcount(covered),
    });
  }

  if (best.place >= 0) {
    return { place: ids[best.place], remove: best.remove === null ? null : ids[best.remove] };
  }
  const free = state.graph.nodes.find((node) => !state.radii.has(node.id));
  return free ? { place: free.id, remove: null } : null;
}

/**
 * Plays one run to the end.
 * @param {number} seed
 * @param {object} config
 * @param {(state: object) => *} [choose] which bot to play with
 * @returns {{won: boolean, score: number, stagesCleared: number, placements: number,
 *            lostAt: number}}
 */
export function playRun(seed, config, choose = greedyChoice) {
  let state = createRun({ seed, config });
  let placements = 0;
  let removals = 0;
  while (state.status === 'playing' || state.status === 'stageCleared') {
    if (state.status === 'stageCleared') {
      state = advance(state);
      continue;
    }
    const choice = choose(state);
    if (choice === null) break;
    if (typeof choice === 'object') {
      if (choice.remove !== null && choice.remove !== undefined) {
        state = remove(state, choice.remove);
        removals++;
      }
      state = place(state, choice.place);
    } else {
      state = place(state, choice);
    }
    placements++;
  }
  return {
    won: state.status === 'won',
    score: state.score,
    stagesCleared: state.cleared.length,
    placements,
    removals,
    lostAt: state.status === 'won' ? 0 : state.stage,
  };
}

/**
 * Back-compatible wrapper: a run played greedily.
 * @param {number} seed
 * @param {object} config
 * @returns {object}
 */
export function playGreedy(seed, config) {
  return playRun(seed, config, greedyChoice);
}

/**
 * Plays both bots over the same seeds and measures how far apart they are.
 * @param {object} config
 * @param {number} runs
 * @param {number} firstSeed
 * @returns {object}
 */
function compare(config, runs, firstSeed) {
  const result = {
    greedyWins: 0, planWins: 0, repairWins: 0,
    greedyLost: [0, 0, 0], planLost: [0, 0, 0], repairLost: [0, 0, 0],
    greedyScore: 0, planScore: 0, repairScore: 0,
    removalsUsed: 0, runsWithRemoval: 0,
    firstMoveDiffers: 0, movesDiffer: 0, moves: 0,
  };

  for (let i = 0; i < runs; i++) {
    const seed = firstSeed + i;
    const greedy = playRun(seed, config, greedyChoice);
    const planned = playRun(seed, config, lookaheadChoice);
    if (greedy.won) { result.greedyWins++; result.greedyScore += greedy.score; }
    else result.greedyLost[greedy.lostAt - 1]++;
    if (planned.won) { result.planWins++; result.planScore += planned.score; }
    else result.planLost[planned.lostAt - 1]++;

    const repaired = playRun(seed, config, repairChoice);
    if (repaired.won) { result.repairWins++; result.repairScore += repaired.score; }
    else result.repairLost[repaired.lostAt - 1]++;
    if (repaired.removals > 0) result.runsWithRemoval++;
    result.removalsUsed += repaired.removals;

    // How often the two even want different things, walked along the greedy line.
    let state = createRun({ seed, config });
    let first = true;
    while (state.status === 'playing' || state.status === 'stageCleared') {
      if (state.status === 'stageCleared') { state = advance(state); continue; }
      const obvious = greedyChoice(state);
      const planned2 = lookaheadChoice(state);
      result.moves++;
      if (obvious !== planned2) {
        result.movesDiffer++;
        if (first) result.firstMoveDiffers++;
      }
      if (first) first = false;
      if (obvious === null) break;
      state = place(state, obvious);
    }
  }
  return result;
}

/**
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 */
function printTable(headers, rows) {
  const cells = [headers, ...rows.map((row) => row.map(String))];
  const widths = headers.map((_, column) => Math.max(...cells.map((row) => row[column].length)));
  const line = (row) => row.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join('  ');
  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));
}

function compareMain(runs, firstSeed) {
  const configs = [
    ['Standard 4/5/5', [0.22, 0.19, 0.17]],
    ['enger 4/4/5', [0.22, 0.17, 0.17]],
    ['enger 3/5/5', [0.18, 0.19, 0.17]],
    ['weiter 4/5/6', [0.22, 0.19, 0.2]],
    ['weiter 5/6/6', [0.28, 0.24, 0.2]],
  ];
  const rows = [];
  const spread = [];
  for (const [label, bagRatio] of configs) {
    const config = { ...DEFAULT_RUN, bagRatio };
    const bags = DEFAULT_RUN.stages.map((n, i) =>
      Math.max(1, Math.round(n * (Array.isArray(bagRatio) ? bagRatio[i] : bagRatio))));
    const r = compare(config, runs, firstSeed);
    const pct = (x) => `${((100 * x) / runs).toFixed(1)}%`;
    rows.push([
      label, bags.join('/'), pct(r.greedyWins), pct(r.planWins), pct(r.repairWins),
      `+${(((r.planWins - r.greedyWins) * 100) / runs).toFixed(1)}`,
      `${(((r.repairWins - r.planWins) * 100) / runs).toFixed(1)}`,
      pct(r.runsWithRemoval),
      (r.removalsUsed / runs).toFixed(2),
      pct(r.firstMoveDiffers),
    ]);
    spread.push([label, r.greedyLost.join('/'), r.planLost.join('/'), r.repairLost.join('/')]);
  }

  printTable(
    ['Beutel', 'Groessen', 'gierig', 'voraus', 'voraus+rep', 'Abstand g->v', 'Gewinn durch rep',
     'Partien mit Entfernen', 'Entfernen je Partie', 'Zug 1 abweichend'],
    rows,
  );
  console.log();
  printTable(
    ['Beutel', 'gierig verliert in 1/2/3', 'voraus verliert in 1/2/3', 'voraus+rep verliert in 1/2/3'],
    spread,
  );
  console.log(`\n${runs} Partien je Konfiguration, beide Bots auf denselben Seeds`);
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  if ('compare' in args) {
    compareMain(Number.parseInt(args.runs ?? '1000', 10), Number.parseInt(args.seed ?? '1', 10));
    return;
  }
  const runs = Number.parseInt(args.runs ?? '1000', 10);
  const firstSeed = Number.parseInt(args.seed ?? '1', 10);
  const ratios = (args.ratios ?? '0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6')
    .split(',').map(Number);

  const rows = [];
  for (const bagRatio of ratios) {
    const config = { ...DEFAULT_RUN, bagRatio };
    const bags = DEFAULT_RUN.stages.map((n) => Math.max(1, Math.round(n * bagRatio)));
    const started = Date.now();
    let won = 0;
    let scoreSum = 0;
    const stageFails = [0, 0, 0];
    for (let i = 0; i < runs; i++) {
      const result = playGreedy(firstSeed + i, config);
      if (result.won) {
        won++;
        scoreSum += result.score;
      } else {
        stageFails[result.stagesCleared] += 1;
      }
    }
    rows.push([
      bagRatio.toFixed(2),
      bags.join('/'),
      `${((100 * won) / runs).toFixed(1)}%`,
      won ? (scoreSum / won).toFixed(2) : '-',
      stageFails.join('/'),
      `${((Date.now() - started) / 1000).toFixed(1)}s`,
    ]);
  }

  const headers = ['bagRatio', 'bags 18/24/30', 'greedy wins', 'score when won', 'lost at stage 1/2/3', 'time'];
  const cells = [headers, ...rows];
  const widths = headers.map((_, column) => Math.max(...cells.map((row) => row[column].length)));
  const line = (row) => row.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join('  ');
  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));
  console.log(`\n${runs} runs per ratio, greedy strategy, stages ${DEFAULT_RUN.stages.join('/')} nodes`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
