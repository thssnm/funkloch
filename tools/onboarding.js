#!/usr/bin/env node
/**
 * Can level 1 be lost? Sizes the onboarding board of the endless mode.
 *
 *   node tools/onboarding.js [--runs=1000] [--seed=1] [--nodes=8,9,10] [--senders=2,3,4,5]
 *   node tools/onboarding.js --full='heute;ersetzt;vorn' --first=9:6 [--daily]
 *   node tools/onboarding.js --points [--runs=1000]   share of the score from level 1
 *
 * The second form plays whole runs, to see what the onboarding level does to
 * the curve behind it; see `variant` for the ways it can be fitted in.
 *
 * Level 1 is meant to teach the rule by being won: tap places a sender, the
 * signal spreads, every node has to be lit. That only works if losing it is
 * practically impossible, and the bar for "practically" is the greedy bot —
 * a person meeting the game for the first time plays worse than greedy, so a
 * board greedy can lose is a board a newcomer will lose.
 *
 * Every candidate is played on level 1 alone, the same seeds for every bot:
 *
 *   gierig   `greedyChoice` — the bar; it has to clear every one.
 *   voraus   `lookaheadChoice` — for comparison.
 *   zufällig a free node drawn by `mulberry32` — a stand-in for tapping
 *            anywhere, below anything a person who looks at the board does.
 *            Not the bar, but it says how much slack a candidate really has.
 *
 * "Nötig" is the fewest senders greedy spent to clear the board; "übrig" what
 * it had left. The difference between the two and the senders dealt is the
 * margin the brief asks for: noticeably more than needed.
 */

import { mulberry32 } from '../src/generator.js';
import {
  advance, createRun, ENDLESS_RUN, levelSpec, place,
} from '../src/run.js';
import { greedyChoice, lookaheadChoice } from './bot64.js';
import { dailySeeds, measure, printTable } from './endless.js';

/** The curve as it stood before the onboarding level, for the comparison. */
const BEFORE = {
  levelNodes: { start: 18, growth: 4, max: 60 },
  senderCurve: { start: 0.24, floor: 0.15, tau: 4 },
};

/**
 * Whole runs with an onboarding level, in the ways it can be fitted in:
 *
 *   heute       no onboarding level, the curve as it was.
 *   ersetzt     the onboarding board replaces level 1; from level 2 on every
 *               board is what it was (22 nodes at level 2).
 *   vorn        the onboarding board is put in front; yesterday's level 1
 *               (18 nodes, 4 senders) becomes level 2 and the whole curve
 *               moves back one step. Same curve, so the run gets one level
 *               longer — and `vorn tau=…` / `vorn start=…` take that level
 *               back out of the curve from level 2 on.
 *
 * Moving the curve back one step means evaluating it at `index - 1`, which for
 * an exponential is the same curve with its start pushed up by `exp(1 / tau)`.
 */
const first = (nodes, senders) => ({ nodes, senders });
function variant(name, onboarding) {
  const base = { ...ENDLESS_RUN, ...BEFORE };
  if (name === 'heute') {
    const { firstLevel, ...plain } = base;
    return plain;
  }
  if (name === 'ersetzt') return { ...base, firstLevel: onboarding };
  // vorn[,tau=x][,floor=y]: the curve one step back, optionally re-tuned.
  const options = Object.fromEntries(name.split(',').slice(1).map((pair) => pair.split('=')));
  const tau = Number(options.tau ?? BEFORE.senderCurve.tau);
  const floor = Number(options.floor ?? BEFORE.senderCurve.floor);
  // Level 2 keeps yesterday's level 1 exactly: 18 nodes at 0.24.
  const start = floor + (BEFORE.senderCurve.start - floor) * Math.exp(1 / tau);
  return {
    ...base,
    firstLevel: onboarding,
    levelNodes: { ...BEFORE.levelNodes, start: BEFORE.levelNodes.start - BEFORE.levelNodes.growth },
    senderCurve: { start, floor, tau },
  };
}

/**
 * How much of a run's score the onboarding level hands out for free.
 *
 * Level 1 is generous on purpose, so its leftovers are points nobody worked
 * for. The score is played three ways, each as its own config, never computed
 * from another: level 1 counting (`scores: true`, as 0.2.0 shipped it); level 1
 * not counting (`scores: false`, the levels from 2 on weighted exactly as
 * before, so a sender saved on level 3 is still worth 3); and before the
 * onboarding level, for reference. The shares are taken from the counting
 * variant — they say what not counting takes away. From level 2 on the boards
 * are the same in all three, so the last two differ only by what the old
 * 18-node level 1 paid.
 */
function points(runs, firstSeed) {
  const quantile = (sorted, q) => {
    const pos = q * (sorted.length - 1);
    const low = Math.floor(pos);
    return sorted[low] + (sorted[Math.ceil(pos)] - sorted[low]) * (pos - low);
  };
  const play = (seed, config, choose) => {
    let state = createRun({ seed, config });
    while (state.status === 'playing' || state.status === 'levelCleared') {
      if (state.status === 'levelCleared') { state = advance(state); continue; }
      state = place(state, choose(state));
    }
    const fromFirst = state.cleared.find((entry) => entry.level === 1)?.left ?? 0;
    return { score: state.score, fromFirst };
  };
  const summary = (scores) => {
    const sorted = [...scores].sort((a, b) => a - b);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const sd = Math.sqrt(scores.reduce((sum, x) => sum + (x - mean) ** 2, 0) / scores.length);
    return [
      quantile(sorted, 0.1), quantile(sorted, 0.25), quantile(sorted, 0.5), quantile(sorted, 0.9),
      quantile(sorted, 0.99), sorted.at(-1), mean.toFixed(1), sd.toFixed(1),
      `${((100 * scores.filter((s) => s === 0).length) / scores.length).toFixed(1)}%`,
    ].map((x) => (typeof x === 'number' && !Number.isInteger(x) ? x.toFixed(1) : String(x)));
  };
  const pct = (x) => `${(100 * x).toFixed(1)}%`;

  const shareRows = [];
  const scoreRows = [];
  for (const [label, choose] of [['voraus', lookaheadChoice], ['gierig', greedyChoice]]) {
    const counting = { ...ENDLESS_RUN, firstLevel: { ...ENDLESS_RUN.firstLevel, scores: true } };
    const notCounting = { ...ENDLESS_RUN, firstLevel: { ...ENDLESS_RUN.firstLevel, scores: false } };
    const now = [];
    const without = [];
    const before = [];
    for (let i = 0; i < runs; i++) {
      now.push(play(firstSeed + i, counting, choose));
      without.push(play(firstSeed + i, notCounting, choose).score);
      before.push(play(firstSeed + i, variant('heute'), choose).score);
    }
    const shares = now.map(({ score, fromFirst }) => (score === 0 ? 0 : fromFirst / score));
    const byScore = [...now.keys()].sort((a, b) => now[a].score - now[b].score);
    const lowerQuartile = byScore.slice(0, Math.floor(runs / 4)).map((i) => shares[i]).sort((a, b) => a - b);
    const sortedShares = [...shares].sort((a, b) => a - b);
    const total = now.reduce((sum, r) => sum + r.score, 0);
    const free = now.reduce((sum, r) => sum + r.fromFirst, 0);
    shareRows.push([
      label,
      (free / runs).toFixed(2),
      pct(quantile(sortedShares, 0.5)),
      pct(quantile(lowerQuartile, 0.5)),
      pct(quantile(sortedShares, 0.75)),
      pct(free / total),
    ]);
    scoreRows.push([label, 'Level 1 zählt (0.2.0)', ...summary(now.map((r) => r.score))]);
    scoreRows.push([label, 'Level 1 zählt nicht', ...summary(without)]);
    scoreRows.push([label, 'vor dem Einstiegsbrett', ...summary(before)]);
  }

  console.log(`Punkte aus Level 1, ${runs} Partien je Bot ab Seed ${firstSeed}`);
  printTable(
    ['Bot', 'Punkte aus L1 Mittel', 'Anteil Median', 'Anteil Median im unteren Quartil (nach Endstand)',
     'Anteil p75', 'Anteil gesamt'],
    shareRows,
  );
  console.log('\nVerteilung des Endstands');
  printTable(
    ['Bot', 'Zählung', 'p10', 'p25', 'Median', 'p90', 'p99', 'max', 'Mittel', 'SD', 'null Punkte'],
    scoreRows,
  );
}

/** Runs every variant with both bots and prints the comparison. */
function full(names, onboarding, runs, firstSeed, daily) {
  const seedOf = daily ? dailySeeds : undefined;
  const fmt = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  const rows = [];
  const shapes = [];
  for (const name of names) {
    const config = variant(name, onboarding);
    const greedy = measure(config, greedyChoice, runs, firstSeed, seedOf);
    const plan = measure(config, lookaheadChoice, runs, firstSeed, seedOf);
    rows.push([
      name,
      fmt(greedy.median), greedy.mean.toFixed(2), greedy.sd.toFixed(2),
      `${((100 * (greedy.endedIn.get(1) ?? 0)) / runs).toFixed(1)}%`,
      fmt(plan.p10), fmt(plan.median), fmt(plan.p90), plan.mean.toFixed(2), plan.sd.toFixed(2),
      `+${fmt(plan.median - greedy.median)}`, `${(plan.mean / greedy.mean).toFixed(2)}x`,
      `${(100 * plan.peak).toFixed(0)}%`,
    ]);
    const spec = Array.from({ length: 8 }, (_, i) => levelSpec(config, i));
    shapes.push([name, ...spec.map(({ nodeCount, senders }) => `${nodeCount}/${senders}`)]);
  }
  console.log('Kurve: Knoten/Sender je Level');
  printTable(['Variante', ...Array.from({ length: 8 }, (_, i) => `L${i + 1}`)], shapes);
  console.log(`\nGanze Partien, geschaffte Level, ${runs} Partien je Bot und Variante, gleiche Seeds`
    + `${daily ? ', Tagesbretter' : ''}`);
  printTable(
    ['Variante', 'gierig Median', 'Mittel', 'SD', 'gierig endet in L1',
     'voraus p10', 'Median', 'p90', 'Mittel', 'SD', 'Abstand Median', 'Verhältnis', 'voraus häufigstes Ende'],
    rows,
  );
}

/**
 * A bot that taps a random free node, drawn from its own seeded stream.
 * @param {number} seed
 */
function randomBot(seed) {
  const rng = mulberry32(seed ^ 0x5bd1e995);
  return (state) => {
    const free = state.graph.nodes.filter((node) => !state.radii.has(node.id));
    return free.length === 0 ? null : free[Math.floor(rng() * free.length)].id;
  };
}

/**
 * Plays level 1 of a run to its end.
 * @returns {{cleared: boolean, spent: number, left: number}}
 */
function playFirst(seed, config, choose) {
  let state = createRun({ seed, config });
  let spent = 0;
  while (state.status === 'playing') {
    const choice = choose(state);
    if (choice === null) break;
    state = place(state, choice);
    spent++;
  }
  return { cleared: state.status === 'levelCleared', spent, left: state.senders.length };
}

function main() {
  // Split at the first `=` only: a variant like `vorn,tau=3` carries its own.
  const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const flag = a.replace(/^--/, '');
    const at = flag.indexOf('=');
    return at < 0 ? [flag, ''] : [flag.slice(0, at), flag.slice(at + 1)];
  }));
  const runs = Number.parseInt(args.runs ?? '1000', 10);
  const firstSeed = Number.parseInt(args.seed ?? '1', 10);
  const nodeCounts = (args.nodes ?? '8,9,10').split(',').map(Number);
  const senderCounts = (args.senders ?? '2,3,4,5').split(',').map(Number);

  if ('full' in args) {
    // --full=heute;ersetzt;vorn;vorn,tau=3 --first=9:6 [--daily]
    const [nodes, senders] = (args.first ?? '9:6').split(':').map(Number);
    full(args.full.split(';'), first(nodes, senders), runs, firstSeed, 'daily' in args);
    return;
  }

  if ('points' in args) {
    points(runs, firstSeed);
    return;
  }

  const rows = [];
  for (const nodes of nodeCounts) {
    for (const senders of senderCounts) {
      const config = { ...ENDLESS_RUN, firstLevel: { nodes, senders } };
      const lost = { greedy: 0, plan: 0, random: 0 };
      let greedySpent = 0;
      let greedyMax = 0;
      let randomSpent = 0;
      let randomClears = 0;
      for (let i = 0; i < runs; i++) {
        const seed = firstSeed + i;
        const greedy = playFirst(seed, config, greedyChoice);
        const plan = playFirst(seed, config, lookaheadChoice);
        const random = playFirst(seed, config, randomBot(seed));
        if (!greedy.cleared) lost.greedy++;
        if (!plan.cleared) lost.plan++;
        if (!random.cleared) lost.random++;
        if (greedy.cleared) {
          greedySpent += greedy.spent;
          greedyMax = Math.max(greedyMax, greedy.spent);
        }
        if (random.cleared) {
          randomSpent += random.spent;
          randomClears++;
        }
      }
      const greedyClears = runs - lost.greedy;
      const pct = (count) => `${((100 * count) / runs).toFixed(1)}%`;
      rows.push([
        nodes, senders,
        pct(lost.greedy), pct(lost.plan), pct(lost.random),
        greedyClears ? (greedySpent / greedyClears).toFixed(2) : '-',
        greedyClears ? greedyMax : '-',
        greedyClears ? (senders - greedySpent / greedyClears).toFixed(2) : '-',
        randomClears ? (randomSpent / randomClears).toFixed(2) : '-',
      ]);
    }
  }

  console.log(`Level 1 allein, ${runs} Seeds ab ${firstSeed}, je Kandidat dieselben Seeds für alle Bots`);
  printTable(
    ['Knoten', 'Sender', 'gierig scheitert', 'voraus scheitert', 'zufällig scheitert',
     'gierig nötig Mittel', 'gierig nötig max', 'gierig übrig Mittel', 'zufällig nötig Mittel'],
    rows,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
