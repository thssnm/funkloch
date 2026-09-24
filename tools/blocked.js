/**
 * What impermeable nodes do to a board.
 *
 *   node tools/blocked.js [--boards=400] [--seed=1]      reach and forced moves
 *   node tools/blocked.js --bots [--runs=400]            both bots, per density
 *   node tools/blocked.js --mixed [--runs=1000]          fixed vs. drawn density
 *
 * Two questions. First: does blocking take the choices away? A node that only
 * one placement can light is not a decision, it is an instruction, and a board
 * full of those plays itself. Second: does the wider gap between a greedy and a
 * planning player survive the blocking, or does it flatten out?
 */

import { bfsWithinBlocked, neighbors } from '../src/graph.js';
import { generateCandidate, mulberry32, shuffled } from '../src/generator.js';
import { ENDLESS_RUN } from '../src/run.js';
import { greedyChoice, lookaheadChoice } from './bot64.js';
import { measure, printTable } from './endless.js';

/**
 * A board of the family the endless mode deals, with a share of its nodes made
 * impermeable.
 * @param {() => number} rng
 * @param {number} nodeCount
 * @param {string} lattice
 * @param {number} density
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
    for (const node of graph.nodes) if (chosen.has(node.id)) node.blocked = true;
    return graph;
  }
  throw new Error('no board');
}

/**
 * For one board and one radius: how many nodes could light each node.
 *
 * Note the floor this can never go under. A transmitter reaches its own node
 * and all of its neighbours no matter what is blocked — blocking stops transit,
 * and neither the source nor the node reached is transit. So every node is
 * reachable from at least `degree + 1` candidates, which on these boards
 * (minimum degree 2) is at least three. What blocking removes is the reach from
 * *further away*, so the second count only looks at candidates at distance two
 * or more: those are the placements that let a player supply a node without
 * standing next to it.
 *
 * @param {import('../src/graph.js').Graph} graph
 * @param {number} radius
 * @returns {{reachers: Map<*, number>, distant: Map<*, number>}}
 */
function reachCounts(graph, radius) {
  const reachers = new Map(graph.nodes.map((node) => [node.id, 0]));
  const distant = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const source of graph.nodes) {
    const near = new Set([source.id, ...neighbors(graph, source.id)]);
    for (const reached of bfsWithinBlocked(graph, source.id, radius)) {
      reachers.set(reached, reachers.get(reached) + 1);
      if (!near.has(reached)) distant.set(reached, distant.get(reached) + 1);
    }
  }
  return { reachers, distant };
}

const DENSITIES = [0, 0.05, 0.1, 0.12, 0.15, 0.2, 0.3, 0.4];

function reachMain(boards, firstSeed) {
  for (const nodeCount of [30, 60]) {
    const rows = [];
    for (const density of DENSITIES) {
      for (const radius of [1, 2, 3]) {
        let ballSum = 0;
        let reachSum = 0;
        let distantSum = 0;
        let minSum = 0;
        let boardsWithSingle = 0;
        let boardsWithTwo = 0;
        let boardsWithNoDistant = 0;
        let nodesWithNoDistant = 0;
        let nodes = 0;
        for (let i = 0; i < boards; i++) {
          const rng = mulberry32(firstSeed + i * 7919 + radius);
          const lattice = ENDLESS_RUN.lattices[i % ENDLESS_RUN.lattices.length];
          const graph = board(rng, nodeCount, lattice, density);
          const { reachers, distant } = reachCounts(graph, radius);
          for (const node of graph.nodes) ballSum += bfsWithinBlocked(graph, node.id, radius).length;
          const counts = [...reachers.values()];
          const far = [...distant.values()];
          reachSum += counts.reduce((a, b) => a + b, 0);
          distantSum += far.reduce((a, b) => a + b, 0);
          minSum += Math.min(...counts);
          if (counts.some((c) => c === 1)) boardsWithSingle++;
          if (counts.some((c) => c <= 3)) boardsWithTwo++;
          if (far.some((c) => c === 0)) boardsWithNoDistant++;
          nodesWithNoDistant += far.filter((c) => c === 0).length;
          nodes += counts.length;
        }
        const pct = (x, of) => `${((100 * x) / of).toFixed(1)}%`;
        // At radius 1 there is no reach beyond the neighbourhood by definition,
        // so the three distant columns would only restate the radius.
        const far = radius === 1 ? ['-', '-', '-'] : [
          (distantSum / (boards * nodeCount)).toFixed(1),
          pct(boardsWithNoDistant, boards),
          pct(nodesWithNoDistant, nodes),
        ];
        rows.push([
          density.toFixed(2), radius,
          (ballSum / (boards * nodeCount)).toFixed(1),
          (reachSum / (boards * nodeCount)).toFixed(1),
          (minSum / boards).toFixed(1),
          pct(boardsWithSingle, boards),
          pct(boardsWithTwo, boards),
          ...far,
        ]);
      }
    }
    console.log(`Bretter mit ${nodeCount} Knoten, ${boards} je Zeile`);
    printTable(
      ['Dichte', 'Radius', 'Ballgroesse', 'Kandidaten je Knoten', 'min je Brett',
       'Brett mit Knoten =1', 'Brett mit Knoten <=3',
       'Fernkandidaten je Knoten', 'Brett mit Knoten ohne Fern', 'Knoten ohne Fern'],
      rows,
    );
    console.log();
  }
}

function botMain(runs, firstSeed) {
  const rows = [];
  for (const density of DENSITIES) {
    const config = { ...ENDLESS_RUN, blockedRatio: density };
    const greedy = measure(config, greedyChoice, runs, firstSeed);
    const plan = measure(config, lookaheadChoice, runs, firstSeed);
    rows.push([
      density.toFixed(2),
      greedy.median.toFixed(1), greedy.p90.toFixed(1), greedy.mean.toFixed(2),
      plan.median.toFixed(1), plan.p90.toFixed(1), plan.mean.toFixed(2),
      `+${(plan.median - greedy.median).toFixed(1)}`,
      `${(plan.mean / Math.max(greedy.mean, 0.01)).toFixed(2)}x`,
      plan.sd.toFixed(2),
      `${(100 * plan.peak).toFixed(0)}%`,
    ]);
  }
  console.log(`Endlosmodus je Blockadedichte, ${runs} Partien je Bot und Dichte, gleiche Seeds`);
  printTable(
    ['Dichte', 'gierig Median', 'gierig p90', 'gierig Mittel',
     'voraus Median', 'voraus p90', 'voraus Mittel',
     'Abstand Median', 'Verhaeltnis Mittel', 'voraus SD', 'voraus haeufigstes Ende'],
    rows,
  );
}

/**
 * A fixed density against one drawn per stage. Same seeds, and — because the
 * order of the blocked nodes is drawn even at density zero — the same boards
 * and the same bags, so the only difference is which nodes are opaque.
 *
 * The question is whether varying the density keeps the spread that a low fixed
 * density has, or whether the hard boards simply end runs early and the mix
 * lands where its mean density lands.
 * @param {number} runs
 * @param {number} firstSeed
 */
function mixedMain(runs, firstSeed) {
  const variants = [
    ['fest 0', 0],
    ['fest 0,05', 0.05],
    ['fest 0,15', 0.15],
    ['gemischt {0; 0,05; 0,15}', [0, 0.05, 0.15]],
  ];
  const rows = [];
  for (const [label, blockedRatio] of variants) {
    const config = { ...ENDLESS_RUN, blockedRatio };
    const greedy = measure(config, greedyChoice, runs, firstSeed);
    const plan = measure(config, lookaheadChoice, runs, firstSeed);
    rows.push([
      label,
      greedy.median.toFixed(1), greedy.mean.toFixed(2),
      plan.median.toFixed(1), plan.p90.toFixed(1), plan.p99.toFixed(1), plan.max,
      plan.mean.toFixed(2), plan.sd.toFixed(2),
      (plan.sd / plan.mean).toFixed(2),
      `${(plan.mean / greedy.mean).toFixed(2)}x`,
      `${(100 * plan.peak).toFixed(0)}%`,
      plan.scoreMedian.toFixed(1),
    ]);
  }
  console.log(`Feste gegen gezogene Dichte, ${runs} Partien je Bot und Variante,`
    + ' gleiche Seeds, gleiche Bretter');
  printTable(
    ['Variante', 'gierig Median', 'gierig Mittel',
     'voraus Median', 'voraus p90', 'voraus p99', 'voraus max',
     'voraus Mittel', 'voraus SD', 'SD/Mittel', 'Verhaeltnis', 'haeufigstes Ende',
     'Punkte Median'],
    rows,
  );
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  const firstSeed = Number.parseInt(args.seed ?? '1', 10);
  if ('mixed' in args) mixedMain(Number.parseInt(args.runs ?? '1000', 10), firstSeed);
  else if ('bots' in args) botMain(Number.parseInt(args.runs ?? '400', 10), firstSeed);
  else reachMain(Number.parseInt(args.boards ?? '400', 10), firstSeed);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
