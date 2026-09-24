/**
 * How far the bots get in the endless mode.
 *
 *   node tools/endless.js [--runs=1000] [--seed=1] [--blocked=0]
 *   node tools/endless.js --curves          sweep over depot curves
 *
 * A run ends when a depot runs out on an unfinished board; the streak is the
 * number of stages survived before that, the score the sum of the transmitters
 * left over in the stages that were cleared. The question is whether the depot
 * curve produces a *distribution* — if every run dies at the same stage the
 * mode has a wall, not a difficulty — and whether planning ahead still pays off
 * when the board grows.
 */

import { advance, createRun, ENDLESS_RUN, place, stageSpec } from '../src/run.js';
import { greedyChoice, lookaheadChoice } from './bot64.js';

/** Runs that survive this many stages are counted as capped, not as won.
 *  Exported so a sweep can say how much of its table is standing on the cap. */
export const STAGE_CAP = 200;

/**
 * Plays one endless run to its end.
 *
 * `streak` is the stage the run was on when it ended — the number the HUD
 * shows — so a run that dies on its first board has a streak of 1, not 0.
 * @param {number} seed
 * @param {object} config
 * @param {(state: object) => *} choose
 * @returns {{streak: number, score: number, diedIn: number}}
 */
export function playEndless(seed, config, choose) {
  let state = createRun({ seed, config });
  while (state.status === 'playing' || state.status === 'stageCleared') {
    if (state.status === 'stageCleared') {
      if (state.cleared.length >= STAGE_CAP) break;
      state = advance(state);
      continue;
    }
    const choice = choose(state);
    if (choice === null) break;
    state = place(state, choice);
  }
  return { streak: state.stage, score: state.score, diedIn: state.stage };
}

/** @param {number[]} sorted @param {number} q @returns {number} */
function quantile(sorted, q) {
  if (sorted.length === 0) return NaN;
  const pos = q * (sorted.length - 1);
  const low = Math.floor(pos);
  const high = Math.ceil(pos);
  return sorted[low] + (sorted[high] - sorted[low]) * (pos - low);
}

/**
 * Plays `runs` runs and summarises the streaks.
 * @param {object} config
 * @param {(state: object) => *} choose
 * @param {number} runs
 * @param {number} firstSeed
 */
export function measure(config, choose, runs, firstSeed) {
  const streaks = [];
  const scores = [];
  const reached = new Map(); // stage -> runs that at least started it
  for (let i = 0; i < runs; i++) {
    const result = playEndless(firstSeed + i, config, choose);
    streaks.push(result.streak);
    scores.push(result.score);
    for (let stage = 1; stage <= result.diedIn; stage++) {
      reached.set(stage, (reached.get(stage) ?? 0) + 1);
    }
  }
  const sortedStreaks = [...streaks].sort((a, b) => a - b);
  const sortedScores = [...scores].sort((a, b) => a - b);
  const mean = streaks.reduce((a, b) => a + b, 0) / runs;
  const variance = streaks.reduce((sum, x) => sum + (x - mean) ** 2, 0) / runs;
  // Share of runs that die in the single most common stage: 1.00 would be a
  // wall, low values mean the curve spreads the endings out.
  const histogram = new Map();
  for (const streak of streaks) histogram.set(streak, (histogram.get(streak) ?? 0) + 1);
  const peak = Math.max(...histogram.values()) / runs;

  return {
    streaks: sortedStreaks,
    p10: quantile(sortedStreaks, 0.1),
    p25: quantile(sortedStreaks, 0.25),
    median: quantile(sortedStreaks, 0.5),
    p75: quantile(sortedStreaks, 0.75),
    p90: quantile(sortedStreaks, 0.9),
    p99: quantile(sortedStreaks, 0.99),
    max: sortedStreaks[runs - 1],
    mean,
    sd: Math.sqrt(variance),
    scoreMedian: quantile(sortedScores, 0.5),
    scoreP90: quantile(sortedScores, 0.9),
    histogram,
    reached,
    peak,
  };
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 */
export function printTable(headers, rows) {
  const cells = [headers, ...rows.map((row) => row.map(String))];
  const widths = headers.map((_, column) => Math.max(...cells.map((row) => row[column].length)));
  const line = (row) => row
    .map((cell, i) => (i === 0 ? String(cell).padEnd(widths[i]) : String(cell).padStart(widths[i])))
    .join('  ');
  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));
}

const fmt = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  const runs = Number.parseInt(args.runs ?? '1000', 10);
  const firstSeed = Number.parseInt(args.seed ?? '1', 10);
  const blockedRatio = Number.parseFloat(args.blocked ?? String(ENDLESS_RUN.blockedRatio));
  const config = { ...ENDLESS_RUN, blockedRatio };

  // What the curve actually deals out.
  const shape = [];
  for (let stage = 1; stage <= 14; stage++) {
    const { nodeCount, ratio } = stageSpec(config, stage - 1);
    shape.push([stage, nodeCount, ratio.toFixed(3), Math.max(1, Math.round(nodeCount * ratio))]);
  }
  console.log('Kurve der Etappen');
  printTable(['Etappe', 'Knoten', 'Depotanteil', 'Depot'], shape);
  console.log();

  const bots = [['gierig', greedyChoice], ['vorausschauend', lookaheadChoice]];
  const results = [];
  for (const [label, choose] of bots) {
    const started = Date.now();
    const result = measure(config, choose, runs, firstSeed);
    results.push([label, result, (Date.now() - started) / 1000]);
  }

  console.log(`Streak (erreichte Etappe), ${runs} Partien je Bot, gleiche Seeds`
    + `, Blockadedichte ${blockedRatio}`);
  printTable(
    ['Bot', 'p10', 'p25', 'Median', 'p75', 'p90', 'p99', 'max', 'Mittel', 'SD',
     'haeufigstes Ende', 'Punkte Median', 'Punkte p90', 'Zeit'],
    results.map(([label, r, seconds]) => [
      label, fmt(r.p10), fmt(r.p25), fmt(r.median), fmt(r.p75), fmt(r.p90), fmt(r.p99),
      r.max, r.mean.toFixed(2), r.sd.toFixed(2), `${(100 * r.peak).toFixed(0)}%`,
      fmt(r.scoreMedian), fmt(r.scoreP90), `${seconds.toFixed(1)}s`,
    ]),
  );
  console.log();

  // Survival: share of runs that still start stage s.
  const maxStage = Math.max(...results.map(([, r]) => r.max));
  const stages = [];
  for (let stage = 1; stage <= Math.min(maxStage, 16); stage++) {
    const { nodeCount, ratio } = stageSpec(config, stage - 1);
    stages.push([
      `${stage} (${nodeCount} Knoten, Depot ${Math.max(1, Math.round(nodeCount * ratio))})`,
      ...results.map(([, r]) => `${((100 * (r.reached.get(stage) ?? 0)) / runs).toFixed(1)}%`),
      ...results.map(([, r]) => `${((100 * (r.histogram.get(stage) ?? 0)) / runs).toFixed(1)}%`),
    ]);
  }
  console.log('Ueberleben je Etappe: Anteil der Partien, die diese Etappe noch beginnen / dort enden');
  printTable(
    ['Etappe', 'gierig erreicht', 'voraus erreicht', 'gierig endet hier', 'voraus endet hier'],
    stages,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
