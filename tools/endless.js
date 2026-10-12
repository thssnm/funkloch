/**
 * How far the bots get in the endless mode.
 *
 *   node tools/endless.js [--runs=1000] [--seed=1] [--blocked=0]
 *   node tools/endless.js --curves          sweep over sender curves
 *
 * A run ends when the senders run out on an unfinished board; the streak is the
 * number of levels cleared before that, the score the sum of the transmitters
 * left over in the levels that were cleared. The question is whether the sender
 * curve produces a *distribution* — if every run dies at the same level the
 * mode has a wall, not a difficulty — and whether planning ahead still pays off
 * when the board grows.
 *
 * Until 2026-10-12 the streak was the level a run died *in*, i.e. one more than
 * it counts now. Every table in MESSUNGEN.md before that date is on the old
 * count; see the note under each of them.
 */

import {
  advance, createRun, dailySeed, ENDLESS_RUN, levelSpec, place,
} from '../src/run.js';
import { greedyChoice, lookaheadChoice } from './bot64.js';

/** Runs that clear this many levels are counted as capped, not as won.
 *  Exported so a sweep can say how much of its table is standing on the cap. */
export const LEVEL_CAP = 200;

/**
 * Plays one endless run to its end.
 *
 * `streak` is the number of levels cleared — what the end card and the shared
 * result show — so a run that dies on its first board has a streak of 0.
 * `diedIn` is the level it ended in, one more than that.
 * @param {number} seed
 * @param {object} config
 * @param {(state: object) => *} choose
 * @returns {{streak: number, score: number, diedIn: number}}
 */
export function playEndless(seed, config, choose) {
  let state = createRun({ seed, config });
  while (state.status === 'playing' || state.status === 'levelCleared') {
    if (state.status === 'levelCleared') {
      if (state.cleared.length >= LEVEL_CAP) break;
      state = advance(state);
      continue;
    }
    const choice = choose(state);
    if (choice === null) break;
    state = place(state, choice);
  }
  return { streak: state.cleared.length, score: state.score, diedIn: state.level };
}

/** First day of the daily seeds `--daily` plays, UTC. */
export const DAILY_FROM = Date.UTC(2026, 0, 1, 12);

/**
 * Seed of the `i`-th daily board from `DAILY_FROM` on. The daily mode is the
 * same curve on hashed seeds; playing these checks the hash does not pick out
 * boards that behave differently from consecutive ones.
 * @param {number} i
 * @returns {number}
 */
export const dailySeeds = (i) => dailySeed(DAILY_FROM + i * 86400000);

/** @param {number[]} sorted @param {number} q @returns {number} */
export function quantile(sorted, q) {
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
 * @param {(i: number) => number} [seedOf] the seed of run `i`; consecutive
 *        seeds from `firstSeed` unless given, e.g. `dailySeeds` for the boards
 *        the daily mode deals
 */
export function measure(config, choose, runs, firstSeed, seedOf = (i) => firstSeed + i) {
  const streaks = [];
  const scores = [];
  const reached = new Map(); // level -> runs that at least started it
  const endedIn = new Map(); // level -> runs that ended in it
  for (let i = 0; i < runs; i++) {
    const result = playEndless(seedOf(i), config, choose);
    streaks.push(result.streak);
    scores.push(result.score);
    for (let level = 1; level <= result.diedIn; level++) {
      reached.set(level, (reached.get(level) ?? 0) + 1);
    }
    endedIn.set(result.diedIn, (endedIn.get(result.diedIn) ?? 0) + 1);
  }
  const sortedStreaks = [...streaks].sort((a, b) => a - b);
  const sortedScores = [...scores].sort((a, b) => a - b);
  const mean = streaks.reduce((a, b) => a + b, 0) / runs;
  const variance = streaks.reduce((sum, x) => sum + (x - mean) ** 2, 0) / runs;
  // Share of runs that die in the single most common level: 1.00 would be a
  // wall, low values mean the curve spreads the endings out.
  const peak = Math.max(...endedIn.values()) / runs;

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
    endedIn,
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
  // --daily: the boards of consecutive days instead of consecutive seeds.
  const daily = 'daily' in args;
  const seedOf = daily ? dailySeeds : undefined;

  // What the curve actually deals out.
  const shape = [];
  for (let level = 1; level <= 14; level++) {
    const { nodeCount, ratio, senders } = levelSpec(config, level - 1);
    shape.push([level, nodeCount, ratio.toFixed(3), senders]);
  }
  console.log('Kurve der Level');
  printTable(['Level', 'Knoten', 'Senderanteil', 'Sender'], shape);
  console.log();

  const bots = [['gierig', greedyChoice], ['vorausschauend', lookaheadChoice]];
  const results = [];
  for (const [label, choose] of bots) {
    const started = Date.now();
    const result = measure(config, choose, runs, firstSeed, seedOf);
    results.push([label, result, (Date.now() - started) / 1000]);
  }

  console.log(`Streak (geschaffte Level), ${runs} Partien je Bot, gleiche Seeds`
    + `${daily ? `, Tagesbretter ab ${new Date(DAILY_FROM).toISOString().slice(0, 10)}` : ''}`
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

  // Survival: share of runs that still start level s.
  const maxLevel = Math.max(...results.map(([, r]) => r.max)) + 1;
  const levels = [];
  for (let level = 1; level <= Math.min(maxLevel, 16); level++) {
    const { nodeCount, senders } = levelSpec(config, level - 1);
    levels.push([
      `${level} (${nodeCount} Knoten, ${senders} Sender)`,
      ...results.map(([, r]) => `${((100 * (r.reached.get(level) ?? 0)) / runs).toFixed(1)}%`),
      ...results.map(([, r]) => `${((100 * (r.endedIn.get(level) ?? 0)) / runs).toFixed(1)}%`),
    ]);
  }
  console.log('Ueberleben je Level: Anteil der Partien, die dieses Level noch beginnen / dort enden');
  printTable(
    ['Level', 'gierig erreicht', 'voraus erreicht', 'gierig endet hier', 'voraus endet hier'],
    levels,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
