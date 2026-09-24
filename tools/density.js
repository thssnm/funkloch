#!/usr/bin/env node
/**
 * Does a denser board give a player more to think about?
 *
 *   node tools/density.js [--runs=500] [--seed=1] [--boards=400]
 *   node tools/density.js --ratios=0,0.1,0.2
 *
 * The complaint this sweep answers: a run of nodes that have two neighbours
 * each is not a decision. A radius 2 dropped anywhere along such a chain lights
 * the same five nodes, so only roughly where it goes matters, never exactly.
 * Branchings are where a placement can be right or wrong.
 *
 * `edgeDeleteRatio` is what thins the triangulation back out after it is built,
 * so deleting less leaves more edges, a higher degree and fewer chains. Whether
 * that is *better* is not a matter of taste: it is whether the distance between
 * a bot that takes the best move now and one that plans three deep grows with
 * the density. That distance is the whole reward for thinking ahead. If it
 * stays flat, a denser board is just a different board, and the 0.2 the mode
 * has always used stays.
 *
 * Three tables, because the obvious two do not settle it. Density does not
 * only add branchings, it also makes every ball bigger, and a board that is
 * cheaper to cover is easier whatever its shape. A gap that grows because the
 * planner has stopped losing is not a gap that rewards planning. So:
 *
 *   1. what the boards look like — degree, chains, ball size
 *   2. both bots at each density, with the depot the mode ships
 *   3. both bots again with the depot scaled by the change in ball size, so
 *      every density costs about the same number of transmitters per node
 *
 * Table 2 answers the question as asked. Table 3 is the one that says whether
 * the answer is about branchings or about difficulty.
 */

import { bfsWithin, neighbors } from '../src/graph.js';
import { generateCandidate, mulberry32 } from '../src/generator.js';
import { ENDLESS_RUN, stageSpec } from '../src/run.js';
import { greedyChoice, lookaheadChoice } from './bot64.js';
import { measure, printTable, STAGE_CAP } from './endless.js';

/** The setting the mode ships, and the reference every other one is read
 *  against. */
const SHIPPED = 0.2;

/** Less deleting than today on the left, today's value and one step past it on
 *  the right, so the reading has the current setting inside it and not at an
 *  end. 0 keeps the whole Delaunay triangulation. */
const RATIOS = [0, 0.05, 0.1, 0.15, 0.2, 0.3];

/**
 * A board of the family the endless mode deals, at a given edge density.
 *
 * Built here rather than through `run.js` because the shape table wants boards
 * without the cost of playing them; the parameters are the ones `drawBoard`
 * uses, and the runs in the second table do go through `run.js`.
 * @param {() => number} rng
 * @param {number} nodeCount
 * @param {string} lattice
 * @param {number} edgeDeleteRatio
 * @returns {import('../src/graph.js').Graph}
 */
function board(rng, nodeCount, lattice, edgeDeleteRatio) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const graph = generateCandidate({
      nodeCount, lattice, minDegree: 2, edgeDeleteRatio, k: 1, rng,
    });
    if (graph !== null) return graph;
  }
  throw new Error(`no board at edgeDeleteRatio ${edgeDeleteRatio}`);
}

/**
 * What the boards at one density look like, averaged over `boards` of them
 * across the node counts the endless mode actually deals.
 *
 * Three numbers. Mean degree is the blunt one. The share of degree-2 nodes is
 * the one the complaint names. The third is the complaint itself: a degree-2
 * node whose neighbours are *also* degree 2 sits inside a chain rather than
 * merely next to a branching, and a chain is what has no decision in it.
 *
 * The fourth number is not about shape but about price: the mean ball size
 * under the mode's own radius mix, which is how many nodes one transmitter
 * buys. It is what table 3 uses to hold the difficulty still.
 * @param {number} edgeDeleteRatio
 * @param {number} boards
 * @param {number} firstSeed
 * @returns {{degree: number, deg2: number, chained: number, edges: number,
 *            ball: number}}
 */
function shape(edgeDeleteRatio, boards, firstSeed) {
  const weights = ENDLESS_RUN.composition;
  const weightSum = weights.reduce((sum, [, weight]) => sum + weight, 0);
  let nodes = 0;
  let degreeSum = 0;
  let edgeSum = 0;
  let deg2 = 0;
  let chained = 0;
  let ballSum = 0;

  for (let i = 0; i < boards; i++) {
    const rng = mulberry32(firstSeed + i * 7919);
    // Walks the same stage shapes a run does, so the sample is the mode's own
    // spread of board sizes and not one arbitrary size.
    const { nodeCount } = stageSpec(ENDLESS_RUN, i % 14);
    const lattice = ENDLESS_RUN.lattices[Math.floor(rng() * ENDLESS_RUN.lattices.length)];
    const graph = board(rng, nodeCount, lattice, edgeDeleteRatio);

    const degree = new Map(graph.nodes.map((node) => [node.id, neighbors(graph, node.id).length]));
    for (const node of graph.nodes) {
      const own = degree.get(node.id);
      nodes++;
      degreeSum += own;
      for (const [radius, weight] of weights) {
        ballSum += (weight / weightSum) * bfsWithin(graph, node.id, radius).length;
      }
      if (own !== 2) continue;
      deg2++;
      if (neighbors(graph, node.id).every((other) => degree.get(other) === 2)) chained++;
    }
    edgeSum += graph.edges.length;
  }

  return {
    degree: degreeSum / nodes,
    deg2: deg2 / nodes,
    chained: chained / nodes,
    edges: edgeSum / boards,
    ball: ballSum / nodes,
  };
}

/**
 * Plays both bots at one density and lays out the row.
 * @param {object} config
 * @param {number} runs
 * @param {number} firstSeed
 * @param {string} label
 * @returns {Array<string>}
 */
function duel(config, runs, firstSeed, label) {
  const started = Date.now();
  const greedy = measure(config, greedyChoice, runs, firstSeed);
  const plan = measure(config, lookaheadChoice, runs, firstSeed);
  // How much of the planner's column is standing on the cap rather than on a
  // run that actually ended. Anything above a few per cent makes the mean, the
  // p90 and the ratio floors rather than readings.
  const capped = plan.streaks.filter((streak) => streak >= STAGE_CAP).length / runs;
  return [
    label,
    greedy.median.toFixed(1), greedy.p90.toFixed(1), greedy.mean.toFixed(2), greedy.sd.toFixed(2),
    plan.median.toFixed(1), plan.p90.toFixed(1), plan.mean.toFixed(2), plan.sd.toFixed(2),
    `+${(plan.median - greedy.median).toFixed(1)}`,
    `${(plan.mean / Math.max(greedy.mean, 0.01)).toFixed(2)}x`,
    `${(100 * capped).toFixed(0)}%`,
    `${((Date.now() - started) / 1000).toFixed(0)}s`,
  ];
}

const DUEL_HEADERS = [
  'Loeschanteil',
  'gierig Median', 'gierig p90', 'gierig Mittel', 'gierig SD',
  'voraus Median', 'voraus p90', 'voraus Mittel', 'voraus SD',
  'Abstand Median', 'Verhaeltnis Mittel', 'voraus am Deckel', 'Zeit',
];

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  const runs = Number.parseInt(args.runs ?? '500', 10);
  const boards = Number.parseInt(args.boards ?? '400', 10);
  const firstSeed = Number.parseInt(args.seed ?? '1', 10);
  const ratios = args.ratios ? args.ratios.split(',').map(Number) : RATIOS;

  const wanted = [...new Set([...ratios, SHIPPED])];
  const shapes = new Map(wanted.map((ratio) => [ratio, shape(ratio, boards, firstSeed)]));
  const reference = shapes.get(SHIPPED).ball;

  console.log(`1. Brettform je Kantenloeschanteil, ${boards} Bretter je Stufe,`
    + ' Knotenzahlen wie im Endlosmodus');
  printTable(
    ['Loeschanteil', 'Kanten je Brett', 'Durchschnittsgrad', 'Anteil Grad 2',
     'davon in Ketten', 'Ballgroesse', 'Depotfaktor'],
    ratios.map((ratio) => {
      const s = shapes.get(ratio);
      return [
        ratio.toFixed(2),
        s.edges.toFixed(1),
        s.degree.toFixed(2),
        `${(100 * s.deg2).toFixed(1)}%`,
        `${(100 * s.chained).toFixed(1)}%`,
        s.ball.toFixed(2),
        (reference / s.ball).toFixed(3),
      ];
    }),
  );
  console.log();

  console.log(`2. Endlosmodus je Kantenloeschanteil mit dem ausgelieferten Depot,`
    + ` ${runs} Partien je Bot und Stufe, gleiche Seeds`);
  printTable(DUEL_HEADERS, ratios.map((ratio) =>
    duel({ ...ENDLESS_RUN, edgeDeleteRatio: ratio }, runs, firstSeed, ratio.toFixed(2))));
  console.log();

  // Same boards, but the depot scaled by the change in ball size, so every
  // density needs about the same number of transmitters per node. What is left
  // of the gap here is what the shape of the board is worth.
  console.log(`3. Dasselbe mit nach Ballgroesse angeglichenem Depot,`
    + ` ${runs} Partien je Bot und Stufe`);
  printTable(DUEL_HEADERS, ratios.map((ratio) => {
    const factor = reference / shapes.get(ratio).ball;
    const curve = ENDLESS_RUN.depotCurve;
    return duel({
      ...ENDLESS_RUN,
      edgeDeleteRatio: ratio,
      depotCurve: { ...curve, start: curve.start * factor, floor: curve.floor * factor },
    }, runs, firstSeed, ratio.toFixed(2));
  }));

  console.log('\nDie Frage steht in "Verhaeltnis Mittel". Waechst sie in Tabelle 3'
    + ' mit der Dichte, belohnt ein dichteres Brett das Vorausdenken wirklich.'
    + '\nWaechst sie nur in Tabelle 2, war es die Schwierigkeit und nicht die Form.');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
