#!/usr/bin/env node
/**
 * Does weighting the leftovers by stage number change how the mode is best
 * played, or is it a different number on the same game?
 *
 *   node tools/score.js [--runs=500] [--seed=1]
 *
 * The change under test: a cleared stage used to add the transmitters left in
 * its depot, and now adds them multiplied by the stage's own number, summed
 * over the run.
 *
 * The weighting itself cannot reorder a single move, and that is worth stating
 * before any measurement: inside stage s every leftover is worth s, the same
 * positive constant for every decision on that board, and leftovers do not
 * carry into the next stage. A constant factor does not change which line is
 * best. So the only thing that could tell the two scorings apart is something
 * that was already there — that playing for leftovers is not the same as
 * playing to survive.
 *
 * That is what this sweep measures. Two bots over the same seeds:
 *
 *   Überleben   `lookaheadChoice`, the shipped one: maximise what is lit at the
 *               end of the visible horizon.
 *   Punkte      the same search with `frugal`, which among lines that clear the
 *               board prefers the one that clears it in fewer transmitters —
 *               and transmitters not spent are exactly the score.
 *
 * If the two never part company, the new scoring is a relabelling of the same
 * optimal play. If they do, the interesting questions are whether the score bot
 * pays for its points in survival, and whether it saves its transmitters where
 * they are worth most, which under the new rule is late.
 */

import { advance, createRun, ENDLESS_RUN, place } from '../src/run.js';
import { greedyChoice, lookaheadChoice } from './bot64.js';
import { printTable, quantile, STAGE_CAP } from './endless.js';

/** The two objectives, as the tool plays them. */
const BOTS = [
  ['Ueberleben', (state) => lookaheadChoice(state)],
  ['Punkte', (state) => lookaheadChoice(state, { frugal: true })],
];

/** Stage buckets for the "does it save late transmitters" table. */
const BUCKETS = [[1, 3], [4, 6], [7, 10], [11, Infinity]];

/**
 * Plays one endless run and reports what both scorings make of it.
 *
 * Both scores are read off `state.cleared`, which already records `{stage,
 * left}` per cleared stage — so the new rule can be measured before `run.js`
 * carries it, and the old one after.
 * @param {number} seed
 * @param {object} config
 * @param {(state: object) => *} choose
 */
function play(seed, config, choose) {
  let state = createRun({ seed, config });
  // Only transmitters spent on boards that actually went clear count towards
  // "per cleared stage"; the ones sunk into the board the run died on are not
  // part of any average that is compared with a leftover count.
  let spentHere = 0;
  let spentOnCleared = 0;
  while (state.status === 'playing' || state.status === 'stageCleared') {
    if (state.status === 'stageCleared') {
      spentOnCleared += spentHere;
      spentHere = 0;
      if (state.cleared.length >= STAGE_CAP) break;
      state = advance(state);
      continue;
    }
    const choice = choose(state);
    if (choice === null) break;
    state = place(state, choice);
    spentHere++;
  }
  const cleared = state.cleared;
  return {
    streak: state.stage,
    cleared,
    spentOnCleared,
    weighted: cleared.reduce((sum, { stage, left }) => sum + left * stage, 0),
    flat: cleared.reduce((sum, { left }) => sum + left, 0),
  };
}

/** @param {number[]} xs */
function stats(xs) {
  const sorted = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / xs.length;
  return {
    median: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    p99: quantile(sorted, 0.99),
    max: sorted[sorted.length - 1],
    mean,
    sd: Math.sqrt(variance),
  };
}

/**
 * Plays `runs` runs of one bot and collects everything the tables need.
 * @param {object} config
 * @param {(state: object) => *} choose
 * @param {number} runs
 * @param {number} firstSeed
 */
function measure(config, choose, runs, firstSeed) {
  const streaks = [];
  const weighted = [];
  const flat = [];
  let clearedStages = 0;
  let leftSum = 0;
  let placements = 0;
  // Leftovers per stage, so the late stages can be looked at on their own.
  const byBucket = BUCKETS.map(() => ({ stages: 0, left: 0 }));

  for (let i = 0; i < runs; i++) {
    const result = play(firstSeed + i, config, choose);
    streaks.push(result.streak);
    weighted.push(result.weighted);
    flat.push(result.flat);
    placements += result.spentOnCleared;
    for (const { stage, left } of result.cleared) {
      clearedStages++;
      leftSum += left;
      const bucket = byBucket[BUCKETS.findIndex(([from, to]) => stage >= from && stage <= to)];
      bucket.stages++;
      bucket.left += left;
    }
  }

  return {
    streaks,
    scores: weighted,
    streak: stats(streaks),
    weighted: stats(weighted),
    flat: stats(flat),
    /** Transmitters left per cleared stage — the score, per board. */
    leftPerStage: clearedStages === 0 ? 0 : leftSum / clearedStages,
    placementsPerStage: clearedStages === 0 ? 0 : placements / clearedStages,
    byBucket: byBucket.map(({ stages, left }) => (stages === 0 ? null : left / stages)),
  };
}

/**
 * How often the two objectives want different things, and how often a whole run
 * passes without them parting company once.
 *
 * Walked along the surviving bot's line, which is the one the mode ships: once
 * the two disagree they are on different boards, and only a shared line can say
 * how often they disagree at all.
 * @param {object} config
 * @param {number} runs
 * @param {number} firstSeed
 */
function divergence(config, runs, firstSeed) {
  let moves = 0;
  let differ = 0;
  let identicalRuns = 0;
  let firstDiffStage = 0;
  let runsWithDiff = 0;

  for (let i = 0; i < runs; i++) {
    let state = createRun({ seed: firstSeed + i, config });
    let clean = true;
    while (state.status === 'playing' || state.status === 'stageCleared') {
      if (state.status === 'stageCleared') {
        if (state.cleared.length >= STAGE_CAP) break;
        state = advance(state);
        continue;
      }
      const surviving = lookaheadChoice(state);
      moves++;
      if (lookaheadChoice(state, { frugal: true }) !== surviving) {
        differ++;
        if (clean) {
          clean = false;
          runsWithDiff++;
          firstDiffStage += state.stage;
        }
      }
      if (surviving === null) break;
      state = place(state, surviving);
    }
    if (clean) identicalRuns++;
  }

  return {
    share: moves === 0 ? 0 : differ / moves,
    moves,
    identicalRuns: identicalRuns / runs,
    firstDiffStage: runsWithDiff === 0 ? null : firstDiffStage / runsWithDiff,
  };
}

/**
 * What a fixed divisor does to a set of scores.
 *
 * Dividing by a positive constant cannot invert two scores, so the ranking is
 * safe whatever the divisor. Rounding to a whole number afterwards can only
 * *tie* what used to be apart, and two things are then worth knowing: how often
 * that happens, and whether a run that actually scored can end up showing
 * nothing at all — which is the one collapse a player would call a bug.
 * @param {number[]} scores
 * @param {number} divisor
 */
function divided(scores, divisor) {
  const shown = scores.map((score) => Math.round(score / divisor));
  // Pairs that were apart before and are equal after: the resolution actually
  // lost. Counted over all pairs, which at these run counts is cheap.
  let tied = 0;
  let pairs = 0;
  for (let i = 0; i < scores.length; i++) {
    for (let j = i + 1; j < scores.length; j++) {
      pairs++;
      if (scores[i] !== scores[j] && shown[i] === shown[j]) tied++;
    }
  }
  const scoring = scores.filter((score) => score > 0).length;
  const vanished = scores.filter((score, i) => score > 0 && shown[i] === 0).length;
  return {
    ...stats(shown),
    tied: pairs === 0 ? 0 : tied / pairs,
    vanished: scoring === 0 ? 0 : vanished / scoring,
  };
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  const runs = Number.parseInt(args.runs ?? '500', 10);
  const firstSeed = Number.parseInt(args.seed ?? '1', 10);
  const divisors = (args.divisors ?? '1,2,3,4,5,10').split(',').map(Number);
  const config = ENDLESS_RUN;

  const results = BOTS.map(([label, choose]) => {
    const started = Date.now();
    return [label, measure(config, choose, runs, firstSeed), (Date.now() - started) / 1000];
  });

  console.log(`1. Beide Ziele ueber dieselben Seeds, ${runs} Partien je Bot`);
  printTable(
    ['Bot', 'Etappe Median', 'p90', 'Mittel', 'SD',
     'Punkte neu Median', 'p90', 'p99', 'max', 'Mittel',
     'Rest je geraeumter Etappe', 'Sender je geraeumter Etappe', 'Zeit'],
    results.map(([label, r, seconds]) => [
      label,
      r.streak.median.toFixed(1), r.streak.p90.toFixed(1), r.streak.mean.toFixed(2),
      r.streak.sd.toFixed(2),
      r.weighted.median.toFixed(1), r.weighted.p90.toFixed(1), r.weighted.p99.toFixed(1),
      String(r.weighted.max), r.weighted.mean.toFixed(1),
      r.leftPerStage.toFixed(2), r.placementsPerStage.toFixed(2),
      `${seconds.toFixed(0)}s`,
    ]),
  );
  console.log();

  console.log('2. Alte gegen neue Zaehlung, damit die Groessenordnung lesbar wird');
  printTable(
    ['Bot', 'Zaehlung', 'Median', 'p90', 'p99', 'max', 'Mittel', 'SD'],
    results.flatMap(([label, r]) => [
      [label, 'alt (Summe Reste)', r.flat.median.toFixed(1), r.flat.p90.toFixed(1),
       r.flat.p99.toFixed(1), String(r.flat.max), r.flat.mean.toFixed(1), r.flat.sd.toFixed(1)],
      [label, 'neu (mal Etappe)', r.weighted.median.toFixed(1), r.weighted.p90.toFixed(1),
       r.weighted.p99.toFixed(1), String(r.weighted.max), r.weighted.mean.toFixed(1),
       r.weighted.sd.toFixed(1)],
    ]),
  );
  console.log();

  console.log('3. Wo die Sender liegen bleiben: Rest je geraeumter Etappe nach Etappenblock');
  printTable(
    ['Bot', ...BUCKETS.map(([from, to]) => (to === Infinity ? `ab ${from}` : `${from}-${to}`))],
    results.map(([label, r]) => [
      label, ...r.byBucket.map((value) => (value === null ? '-' : value.toFixed(2))),
    ]),
  );
  console.log();

  // Paired, seed by seed: the blunt answer to whether points cost distance.
  const [, survive] = results[0];
  const [, points] = results[1];
  let worse = 0;
  let better = 0;
  let scoreWorse = 0;
  for (let i = 0; i < runs; i++) {
    if (points.streaks[i] < survive.streaks[i]) worse++;
    if (points.streaks[i] > survive.streaks[i]) better++;
    if (points.scores[i] < survive.scores[i]) scoreWorse++;
  }
  console.log('4. Paarweise, Seed fuer Seed');
  printTable(
    ['Vergleich', 'Punkte-Bot kommt weniger weit', 'kommt weiter',
     'Punkte-Bot hat weniger Punkte', 'mittlerer Etappenunterschied'],
    [[
      `${runs} Seeds`,
      `${(100 * worse) / runs}%`,
      `${(100 * better) / runs}%`,
      `${((100 * scoreWorse) / runs).toFixed(1)}%`,
      (points.streak.mean - survive.streak.mean).toFixed(3),
    ]],
  );
  console.log();

  const diff = divergence(config, runs, firstSeed);
  console.log(`5. Wie oft die beiden Ziele auseinandergehen, ${runs} Partien auf der Linie`
    + ' des ueberlebenden Bots');
  printTable(
    ['Zuege', 'davon abweichend', 'Partien ohne jede Abweichung', 'erste Abweichung in Etappe'],
    [[
      String(diff.moves),
      `${(100 * diff.share).toFixed(2)}%`,
      `${(100 * diff.identicalRuns).toFixed(1)}%`,
      diff.firstDiffStage === null ? '-' : diff.firstDiffStage.toFixed(1),
    ]],
  );

  console.log();

  // 6. Teiler: bringt eine feste Division die Verteilung ins Lesbare?
  //
  // Drei Spielstärken, weil die beiden Bedingungen an verschiedenen Enden
  // hängen. „Median zweistellig" muss für den *schwächsten* Spieler halten, den
  // es gibt, sonst steht ein Teil der Spielerschaft vor einstelligen Punkten;
  // dafür steht der gierige Bot als Untergrenze. „p99 nicht vierstellig" reisst
  // zuerst der stärkste, also der Punkte-Bot. Der planende Bot dazwischen ist
  // der Spieler, gegen den dieses Projekt kalibriert.
  const greedy = measure(config, greedyChoice, runs, firstSeed);
  const ladder = [['gierig', greedy], ...results.map(([label, r]) => [label, r])];
  console.log(`6. Feste Teiler auf den neuen Score, gerundet, ${runs} Partien je Stufe`
    + ` (${ladder.map(([label]) => label).join(' / ')})`);
  printTable(
    ['Teiler', 'Median', 'p90', 'p99', 'max', 'Median >= 10 (voraus)',
     'p99 < 1000 (Punkte)', 'neue Bindungen', 'punktende Partien auf 0 (gierig)'],
    divisors.map((divisor) => {
      const [weak, mid, strong] = ladder.map(([, r]) => divided(r.scores, divisor));
      const trio = (key, digits = 1) =>
        [weak, mid, strong].map((r) => r[key].toFixed(digits)).join(' / ');
      return [
        String(divisor),
        trio('median'), trio('p90'), trio('p99'), trio('max', 0),
        // Judged on the planning bot: it is the player this project calibrates
        // against. The greedy column is the floor and is already single-digit
        // undivided, so no divisor can lift it.
        mid.median >= 10 ? 'ja' : 'NEIN',
        strong.p99 < 1000 ? 'ja' : 'NEIN',
        `${(100 * mid.tied).toFixed(2)}%`,
        `${(100 * weak.vanished).toFixed(1)}%`,
      ];
    }),
  );

  console.log('\nGehen die beiden nie auseinander, ist die neue Zaehlung eine andere Zahl'
    + ' auf demselben Spiel.');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
