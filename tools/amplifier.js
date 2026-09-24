#!/usr/bin/env node
/**
 * Does an amplifier node pay for the planning a player does?
 *
 *   node tools/amplifier.js [--runs=400] [--boards=400] [--seed=1]
 *   node tools/amplifier.js --densities=0,0.05,0.15
 *   node tools/amplifier.js --tables=1,5       only the tables asked for
 *   node tools/amplifier.js --plain            no equalisation, raw densities
 *
 * An amplifier is an ordinary node in every respect but one: a transmitter
 * standing on it reaches one step further (`bfsWithinAmplified` in graph.js).
 * It has to be supplied like any other node and it passes signal on like any
 * other node, so it adds no rule — it adds a reason to look at *where* a
 * transmitter goes, and to keep the right radius for the right node.
 *
 * The point is expressly not a harder mode. An amplifier makes every board
 * cheaper to clear, and a cheaper board is easier whatever else it does — the
 * same trap `tools/density.js` walked into. So the mix of transmitter radii is
 * tilted towards shorter reach until the price of a node is back where the
 * shipped mode has it, and only then are the two bots compared.
 *
 * Three anchors, because the obvious one does not hold:
 *
 *   A. the mean ball size over the whole board, 6.96 nodes per transmitter —
 *      the number `tools/density.js` equalised against, and the one the brief
 *      asks for. It is measured, printed and hit to three decimals.
 *   B. the greedy bot's mean streak. Anchor A turns out not to hold the
 *      difficulty still at all, because neither bot places on an average node:
 *      both stand on amplifiers several times more often than chance, so the
 *      ball they actually buy is bigger than the board's mean. Anchor B tilts
 *      the same mix further, until the unplanned player ends up exactly where
 *      it ends up today, and only then asks what planning is worth.
 *   C. the greedy bot's mean streak again, but held with the depot size while
 *      the mix stays the shipped 4/4/2. Anchor B pays for its honesty by
 *      flattening the mix towards radius 1, and choosing which radius to spend
 *      where is part of what planning is for — so a gap that shrinks under B
 *      alone could be the mix rather than the amplifier. Under B and C
 *      together it is the amplifier.
 *
 * The question is whether the ratio between the planning bot and the greedy one
 * grows along the density while the price stays put. If it does not, the
 * amplifier is a decoration and does not go in.
 *
 * The cheap tell is the last table: how often each bot puts a transmitter on an
 * amplifier. If greedy does it just as often, the amplifier is not a plan, it
 * is simply the better square, and both bots collect it by accident.
 */

import { bfsWithinAmplified } from '../src/graph.js';
import { generateCandidate, mulberry32, shuffled } from '../src/generator.js';
import { advance, createRun, ENDLESS_RUN, place, stageSpec } from '../src/run.js';
import { greedyChoice, lookaheadChoice } from './bot64.js';
import { printTable, quantile, STAGE_CAP } from './endless.js';

/** Densities swept: nothing, up to roughly one node in seven. */
const DENSITIES = [0, 0.03, 0.06, 0.09, 0.12, 0.15];

/**
 * Radii the ball table is measured for. 1 to 3 are the cards; 4 is there for
 * the diagnosis, because what an amplifier is *worth* to a card of radius r is
 * `ball(r + 1) - ball(r)` on that node, and that difference is what decides
 * whether keeping the long transmitter for the amplifier is a decision at all.
 */
const RADII = [1, 2, 3, 4];

/**
 * A board of the family the endless mode deals, with a share of its nodes made
 * amplifiers.
 *
 * Deliberately the same drawing as `tools/density.js` uses for its shape table,
 * down to the seed arithmetic and the absence of impermeable nodes: its ball
 * size of 6.96 is the reference this sweep equalises against, and a reference
 * measured on a different sample would not be one. The runs further down do go
 * through `run.js` and therefore do carry the mode's 5% of blocked nodes.
 * @param {() => number} rng
 * @param {number} nodeCount
 * @param {string} lattice
 * @param {number} density
 * @returns {import('../src/graph.js').Graph}
 */
function board(rng, nodeCount, lattice, density) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const graph = generateCandidate({
      nodeCount, lattice, minDegree: 2, edgeDeleteRatio: 0.2, k: 1, rng,
    });
    if (graph === null) continue;
    const chosen = new Set(
      shuffled(rng, graph.nodes.map((node) => node.id)).slice(0, Math.round(nodeCount * density)),
    );
    for (const node of graph.nodes) if (chosen.has(node.id)) node.amplifier = true;
    return graph;
  }
  throw new Error(`no board at amplifier density ${density}`);
}

/**
 * Mean ball size per card radius at one amplifier density: how many nodes a
 * transmitter of radius 1, 2 or 3 buys, averaged over every node of every
 * board. The amplified nodes are in that average with their bonus, which is
 * exactly the price the density lowers.
 *
 * Keeping the three radii apart rather than averaging straight away is what
 * makes the equalisation cheap: the ball size under any mix is the weighted
 * mean of these three numbers, so a mix can be solved for instead of measured.
 * @param {number} density
 * @param {number} boards
 * @param {number} firstSeed
 * @returns {number[]} indexed by radius, entry 0 unused
 */
function ballsByRadius(density, boards, firstSeed) {
  const sums = RADII.map(() => 0);
  sums.unshift(0);
  let nodes = 0;
  for (let i = 0; i < boards; i++) {
    const rng = mulberry32(firstSeed + i * 7919);
    // Walks the same stage shapes a run does, so the sample is the mode's own
    // spread of board sizes and not one arbitrary size.
    const { nodeCount } = stageSpec(ENDLESS_RUN, i % 14);
    const lattice = ENDLESS_RUN.lattices[Math.floor(rng() * ENDLESS_RUN.lattices.length)];
    const graph = board(rng, nodeCount, lattice, density);
    for (const node of graph.nodes) {
      nodes++;
      for (const radius of RADII) sums[radius] += bfsWithinAmplified(graph, node.id, radius).length;
    }
  }
  return sums.map((sum) => sum / nodes);
}

// ---------------------------------------------------------------------------
// Equalising the mix
// ---------------------------------------------------------------------------

/**
 * The transmitter mix tilted towards shorter reach by one knob.
 *
 * `weight(r) = base(r) * exp(-t * r)`: at `t = 0` this is the shipped mix, and
 * every step up moves weight from the long radii to the short ones without ever
 * dropping one of them entirely. One knob and monotone, which is what lets a
 * bisection solve for it; and it is the mildest shape that answers the brief —
 * shift the mix towards shorter reach, do not redesign it.
 * @param {number} t
 * @returns {Array<[number, number]>} composition, weights normalised to sum 10
 */
function tilted(t) {
  const raw = ENDLESS_RUN.composition
    .map(([radius, weight]) => [radius, weight * Math.exp(-t * radius)]);
  const total = raw.reduce((sum, [, weight]) => sum + weight, 0);
  return raw.map(([radius, weight]) => [radius, (10 * weight) / total]);
}

/**
 * Mean ball size under a mix, given the three per-radius means.
 * @param {Array<[number, number]>} composition
 * @param {number[]} balls
 * @returns {number}
 */
function ballOf(composition, balls) {
  const total = composition.reduce((sum, [, weight]) => sum + weight, 0);
  return composition.reduce((sum, [radius, weight]) => sum + (weight / total) * balls[radius], 0);
}

/**
 * Bisects a knob until `value(knob)` has fallen to `target`. `low` is the end
 * where the value is too high and `high` the end where it is too low, which is
 * a matter of the knob's direction and not of which number is bigger: a tilt
 * runs 0 -> 2 and a depot factor runs 1.3 -> 0.5.
 * @param {(knob: number) => number} value
 * @param {number} target
 * @param {number} low
 * @param {number} high
 * @param {number} steps
 * @returns {number}
 */
function bisect(value, target, low, high, steps = 40) {
  if (value(low) <= target) return low;
  let lo = low;
  let hi = high;
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    if (value(mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The mix as readable percentages, e.g. `40/40/20`. */
const mixLabel = (composition) => composition
  .map(([, weight]) => `${Math.round(10 * weight)}`)
  .join('/');

/**
 * The config one row of a table is played on. `depotFactor` scales both ends of
 * the depot curve, which is how a row can be made to cost the same number of
 * transmitters per node as another one — the knob `tools/density.js` uses.
 */
const configFor = (density, mix, depotFactor = 1) => ({
  ...ENDLESS_RUN,
  amplifierRatio: density,
  composition: mix,
  depotCurve: {
    ...ENDLESS_RUN.depotCurve,
    start: ENDLESS_RUN.depotCurve.start * depotFactor,
    floor: ENDLESS_RUN.depotCurve.floor * depotFactor,
  },
});

// ---------------------------------------------------------------------------
// Playing
// ---------------------------------------------------------------------------

/**
 * Plays one endless run and reports, besides the streak, how the bot spent its
 * transmitters: how many went onto an amplifier, how many would have if it had
 * placed blindly, and how big the balls it bought actually were.
 *
 * The blind share is not the density — nodes fill up as a stage goes on, so the
 * share of *free* nodes that amplify drifts — and without it a usage rate says
 * nothing. The ball actually bought is the number that decides whether
 * equalising the board's mean ball size equalises anything a player feels.
 * @param {number} seed
 * @param {object} config
 * @param {(state: object) => *} choose
 */
function play(seed, config, choose) {
  let state = createRun({ seed, config });
  let placements = 0;
  let onAmplifier = 0;
  let blindly = 0;
  let ballSum = 0;
  while (state.status === 'playing' || state.status === 'stageCleared') {
    if (state.status === 'stageCleared') {
      if (state.cleared.length >= STAGE_CAP) break;
      state = advance(state);
      continue;
    }
    const choice = choose(state);
    if (choice === null) break;
    const free = state.graph.nodes.filter((node) => !state.radii.has(node.id));
    if (free.length > 0) {
      blindly += free.filter((node) => node.amplifier === true).length / free.length;
      ballSum += bfsWithinAmplified(state.graph, choice, state.current).length;
      placements++;
      if (state.graph.nodes.find((node) => node.id === choice)?.amplifier === true) onAmplifier++;
    }
    state = place(state, choice);
  }
  return { streak: state.stage, placements, onAmplifier, blindly, ballSum };
}

/**
 * Plays `runs` runs of one bot and summarises them.
 * @param {object} config
 * @param {(state: object) => *} choose
 * @param {number} runs
 * @param {number} firstSeed
 */
function measure(config, choose, runs, firstSeed) {
  const streaks = [];
  let placements = 0;
  let onAmplifier = 0;
  let blindly = 0;
  let ballSum = 0;
  for (let i = 0; i < runs; i++) {
    const result = play(firstSeed + i, config, choose);
    streaks.push(result.streak);
    placements += result.placements;
    onAmplifier += result.onAmplifier;
    blindly += result.blindly;
    ballSum += result.ballSum;
  }
  const sorted = [...streaks].sort((a, b) => a - b);
  const mean = streaks.reduce((a, b) => a + b, 0) / runs;
  const variance = streaks.reduce((sum, x) => sum + (x - mean) ** 2, 0) / runs;
  const per = (x) => (placements === 0 ? 0 : x / placements);
  return {
    median: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    mean,
    sd: Math.sqrt(variance),
    capped: streaks.filter((streak) => streak >= STAGE_CAP).length / runs,
    usage: per(onAmplifier),
    blind: per(blindly),
    effective: per(ballSum),
  };
}

/**
 * How often the two bots want different things.
 *
 * Walked along the *planning* bot's line, not the greedy one: that is the line
 * the mode is calibrated against, and it is the only one that reaches the later
 * stages where the boards are large. A position the greedy bot never survives
 * to see cannot say anything about planning there.
 * @param {object} config
 * @param {number} runs
 * @param {number} firstSeed
 * @returns {{share: number, moves: number}}
 */
function divergence(config, runs, firstSeed) {
  let moves = 0;
  let differ = 0;
  for (let i = 0; i < runs; i++) {
    let state = createRun({ seed: firstSeed + i, config });
    while (state.status === 'playing' || state.status === 'stageCleared') {
      if (state.status === 'stageCleared') {
        if (state.cleared.length >= STAGE_CAP) break;
        state = advance(state);
        continue;
      }
      const planned = lookaheadChoice(state);
      moves++;
      if (greedyChoice(state) !== planned) differ++;
      if (planned === null) break;
      state = place(state, planned);
    }
  }
  return { share: moves === 0 ? 0 : differ / moves, moves };
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const DUEL_HEADERS = [
  'Dichte', 'Mischung', 'Ballgroesse', 'genutzter Ball g/v',
  'gierig Median', 'gierig p90', 'gierig Mittel', 'gierig SD',
  'voraus Median', 'voraus p90', 'voraus Mittel', 'voraus SD',
  'Abstand Median', 'Verhaeltnis Mittel', 'voraus am Deckel', 'Zuege abweichend', 'Zeit',
];

/**
 * One row of a duel table: both bots over the same seeds and the same boards,
 * plus how often they disagree.
 * @returns {{row: Array<string>, greedy: object, plan: object}}
 */
function duel(density, mix, ball, runs, diffRuns, firstSeed, depotFactor = 1) {
  const config = configFor(density, mix, depotFactor);
  const started = Date.now();
  const greedy = measure(config, greedyChoice, runs, firstSeed);
  const plan = measure(config, lookaheadChoice, runs, firstSeed);
  const diff = divergence(config, diffRuns, firstSeed);
  return {
    greedy,
    plan,
    row: [
      density.toFixed(2), mixLabel(mix), ball.toFixed(2),
      `${greedy.effective.toFixed(1)}/${plan.effective.toFixed(1)}`,
      greedy.median.toFixed(1), greedy.p90.toFixed(1), greedy.mean.toFixed(2), greedy.sd.toFixed(2),
      plan.median.toFixed(1), plan.p90.toFixed(1), plan.mean.toFixed(2), plan.sd.toFixed(2),
      `+${(plan.median - greedy.median).toFixed(1)}`,
      `${(plan.mean / Math.max(greedy.mean, 0.01)).toFixed(2)}x`,
      `${(100 * plan.capped).toFixed(0)}%`,
      `${(100 * diff.share).toFixed(1)}%`,
      `${((Date.now() - started) / 1000).toFixed(0)}s`,
    ],
  };
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  const runs = Number.parseInt(args.runs ?? '400', 10);
  const boards = Number.parseInt(args.boards ?? '400', 10);
  const diffRuns = Number.parseInt(args.diffruns ?? '150', 10);
  const pinRuns = Number.parseInt(args.pinruns ?? '300', 10);
  const firstSeed = Number.parseInt(args.seed ?? '1', 10);
  const densities = args.densities ? args.densities.split(',').map(Number) : DENSITIES;
  const equalise = !('plain' in args);
  /** Which tables to print; table 1 is always computed, its numbers feed the rest. */
  const tables = new Set((args.tables ?? '1,2,3,4,5,6').split(',').map(Number));

  // 1. What the densities do to the price of a node, and what mix puts it back.
  const balls = new Map(densities.map((d) => [d, ballsByRadius(d, boards, firstSeed)]));
  const bare = balls.get(0) ?? ballsByRadius(0, boards, firstSeed);
  const reference = ballOf(ENDLESS_RUN.composition, bare);
  const tilts = new Map(densities.map((d) =>
    [d, equalise ? bisect((t) => ballOf(tilted(t), balls.get(d)), reference, 0, 2) : 0]));
  const mixes = new Map(densities.map((d) => [d, tilted(tilts.get(d))]));

  console.log(`1. Angleichung der Sendermischung ueber die mittlere Ballgroesse, ${boards} Bretter`
    + ' je Stufe, Knotenzahlen wie im Endlosmodus, ohne undurchlaessige Knoten');
  printTable(
    ['Verstaerkerdichte', 'Ball r1', 'Ball r2', 'Ball r3', '(r4)', 'Ball bei 4/4/2',
     'Tilt t', 'Mischung', 'erreichte Ballgroesse', 'Abweichung'],
    densities.map((density) => {
      const b = balls.get(density);
      const achieved = ballOf(mixes.get(density), b);
      return [
        density.toFixed(2), b[1].toFixed(2), b[2].toFixed(2), b[3].toFixed(2), b[4].toFixed(2),
        ballOf(ENDLESS_RUN.composition, b).toFixed(2),
        tilts.get(density).toFixed(3), mixLabel(mixes.get(density)),
        achieved.toFixed(3),
        `${achieved - reference >= 0 ? '+' : ''}${(achieved - reference).toFixed(3)}`,
      ];
    }),
  );
  console.log(`   Bezugswert (heutige Mischung 4/4/2, keine Verstaerker): ${reference.toFixed(3)}`);
  console.log();

  // 2. Both bots at each density, on the same seeds and the same boards.
  if (tables.has(2) || tables.has(3)) {
    console.log(`2. Endlosmodus je Verstaerkerdichte${equalise ? ', Mischung nach Ballgroesse angeglichen' : ', ohne Angleichung'},`
      + ` ${runs} Partien je Bot und Stufe, gleiche Seeds und gleiche Bretter,`
      + ` Abweichung ueber ${diffRuns} Partien auf der Linie des planenden Bots`);
    const duels = densities.map((density) =>
      duel(density, mixes.get(density), ballOf(mixes.get(density), balls.get(density)),
        runs, diffRuns, firstSeed));
    printTable(DUEL_HEADERS, duels.map((d) => d.row));
    console.log();

    // 3. Who stands on the amplifiers.
    console.log('3. Wer stellt auf einen Verstaerker? Anteil der gesetzten Sender,'
      + ' gegen den Anteil der Verstaerker unter den freien Knoten');
    printTable(
      ['Dichte', 'gierig setzt darauf', 'blind erwartet', 'Faktor',
       'voraus setzt darauf', 'blind erwartet', 'Faktor'],
      densities.map((density, i) => {
        const { greedy, plan } = duels[i];
        const lift = (bot) => `${(bot.usage / Math.max(bot.blind, 1e-9)).toFixed(2)}x`;
        return [
          density.toFixed(2),
          `${(100 * greedy.usage).toFixed(1)}%`, `${(100 * greedy.blind).toFixed(1)}%`, lift(greedy),
          `${(100 * plan.usage).toFixed(1)}%`, `${(100 * plan.blind).toFixed(1)}%`, lift(plan),
        ];
      }),
    );
    console.log();
  }

  if (!equalise || !(tables.has(4) || tables.has(5) || tables.has(6))) return;

  // What the unplanned player gets out of the mode today. Both anchors below
  // tilt one knob until they are back at this number.
  const target = measure(configFor(0, tilted(0)), greedyChoice, pinRuns, firstSeed).mean;

  // 4. The same sweep with the mix tilted until the greedy bot is back where it
  //    is today. Anchor A holds the board's mean price still; this one holds
  //    still what the unplanned player actually gets out of the mode.
  if (tables.has(4)) {
    console.log('4. Dasselbe, aber die Mischung so weit gekippt, dass der gierige Bot bei'
      + ` ${target.toFixed(2)} Etappen bleibt (${pinRuns} Partien je Bisektionsschritt)`);
    printTable([DUEL_HEADERS[0], 'Tilt t', ...DUEL_HEADERS.slice(1)], densities.map((density) => {
      const t = bisect(
        (tilt) => measure(configFor(density, tilted(tilt)), greedyChoice, pinRuns, firstSeed).mean,
        target, 0, 2, 9,
      );
      const mix = tilted(t);
      const { row } = duel(density, mix, ballOf(mix, balls.get(density)), runs, diffRuns, firstSeed);
      return [row[0], t.toFixed(3), ...row.slice(1)];
    }));
    console.log();
  }

  // 5. The same pin, but held with the depot instead of the mix.
  //
  // Table 4 answers the question at an honest difficulty, but it answers it
  // with a mix that has been flattened towards radius 1 — and part of what
  // planning is *for* is deciding which radius to spend where, so a shrinking
  // gap there could be the mix and not the amplifier. Here the mix stays the
  // shipped 4/4/2 and the depot is scaled instead, which leaves the choice of
  // radius intact. If the gap shrinks in both tables, it is the amplifier.
  if (tables.has(5)) {
    console.log('5. Gegenprobe: Mischung bleibt 4/4/2, stattdessen wird das Depot skaliert,'
      + ` bis der gierige Bot wieder bei ${target.toFixed(2)} Etappen steht`);
    printTable([DUEL_HEADERS[0], 'Depotfaktor', ...DUEL_HEADERS.slice(1)], densities.map((density) => {
      // Nothing to compensate without amplifiers, and the row is the reference
      // the others are read against: it keeps the depot the mode ships.
      const factor = density === 0 ? 1 : bisect(
        (f) => measure(configFor(density, ENDLESS_RUN.composition, f), greedyChoice, pinRuns, firstSeed).mean,
        target, 1.3, 0.4, 9,
      );
      const { row } = duel(density, ENDLESS_RUN.composition,
        ballOf(ENDLESS_RUN.composition, balls.get(density)), runs, diffRuns, firstSeed, factor);
      return [row[0], factor.toFixed(3), ...row.slice(1)];
    }));
    console.log();
  }

  // 6. The yardstick: a board with no amplifiers at all, made easier by handing
  //    out a bigger depot.
  //
  // Both pins land near the target rather than on it, because the depot holds
  // four to nine transmitters and neither knob moves it in less than whole
  // ones — so a row can end up easier than the baseline and its ratio is
  // flattered by that alone. This table says how much flattery a given amount
  // of easiness is worth *without* amplifiers, which is what every row of
  // tables 2, 4 and 5 has to beat before it counts as a reward for planning.
  if (tables.has(6)) {
    // Read off table 2 and handed in: the difficulty each amplifier row
    // actually ended up at, in greedy mean stages.
    const targets = (args.targets ?? String(target)).split(',').map(Number);
    console.log('6. Massstab: keine Verstaerker, nur ein groesseres Depot —'
      + ' wieviel Verhaeltnis kauft blosse Leichtigkeit?');
    printTable(['Zielschwierigkeit', 'Depotfaktor', ...DUEL_HEADERS.slice(1)], targets.map((wanted) => {
      const factor = bisect(
        (f) => -measure(configFor(0, ENDLESS_RUN.composition, f), greedyChoice, pinRuns, firstSeed).mean,
        -wanted, 0.4, 1.4, 9,
      );
      const { row } = duel(0, ENDLESS_RUN.composition, reference, runs, diffRuns, firstSeed, factor);
      return [wanted.toFixed(2), factor.toFixed(3), ...row.slice(1)];
    }));
  }

  console.log('\nDie Frage steht in "Verhaeltnis Mittel", waehrend der Preis eines Knotens'
    + ' stillsteht.\nWaechst sie in den Tabellen 4 und 5 nicht, ist der Verstaerker Zierde'
    + ' und kommt nicht ins Spiel.');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
