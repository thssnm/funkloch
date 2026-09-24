#!/usr/bin/env node
/**
 * Builds a small exact-cover set into levels/exact/ and prints its metrics.
 *
 *   node tools/build-exact-levels.js [--seed=20260922] [--out=levels/exact]
 *
 * The 30 cover levels in levels/ are never touched by this script.
 *
 * Ordering is by `sumFeasible`: how many transmitter sets satisfy the sum
 * condition. Exactly one of them is the solution, so the rest are placements
 * the arithmetic allows and only the geometry rules out — which is precisely
 * the work the E2 step costs the player.
 */

import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateExactLevel, LevelGenerationError } from '../src/generator.js';
import { ballSizeStats, solveExactByTiers, sumFeasible } from '../src/tiers-exact.js';

/**
 * The three levels that open the set. These are kept from the first exact set
 * rather than regenerated to taste: they have `sumFeasible === 1`, so the sum
 * step costs nothing at all, which is exactly what an opening level wants.
 * Their parameters are pinned here — including the default `auto` topology,
 * because passing a topology explicitly would skip an rng draw and produce a
 * different board.
 * @type {Array<{count: number, k: number, seed: number}>}
 */
const ENTRY = [
  { count: 2, k: 1, seed: 20260922 },
  { count: 2, k: 1, seed: 20261935 },
  { count: 3, k: 1, seed: 20269854 },
];

/**
 * Slots the nine remaining levels are drawn from: [count, k, topology].
 *
 * Rectangular lattices are deliberately absent. Their nodes nearly all share a
 * degree, so nearly all balls come out the same size and the sum condition has
 * almost nothing to narrow down — measured over 400 candidates a rect board
 * reached `sumFeasible >= 8` four times, a hex or Delaunay board about sixty.
 * @type {Array<[number, number, string]>}
 */
const SLOTS = [
  [4, 1, 'delaunay'],
  [5, 1, 'delaunay'],
  [4, 1, 'hex'],
  [5, 1, 'hex'],
];

/** Boards larger than this stop being readable on a phone. */
const MAX_NODES = 30;

/**
 * Bounds on the work the E2 step costs. Below the floor the sum condition pins
 * the answer by itself and there is nothing to think about; above the ceiling
 * it stops being an insight and turns into counting. The ceiling is set well
 * under what the generator can reach on purpose.
 */
const MIN_SUM_FEASIBLE = 8;
const MAX_SUM_FEASIBLE = 60;

const WANTED_NEW = 9;
const PER_SLOT = 3;
const SEEDS_PER_SLOT = 60;

/**
 * Generates and vets levels for one slot.
 * @param {[number, number, string]} slot
 * @param {number} baseSeed
 * @returns {object[]} up to PER_SLOT keepers
 */
function harvest([count, k, lattice], baseSeed) {
  const keepers = [];
  for (let attempt = 0; attempt < SEEDS_PER_SLOT && keepers.length < PER_SLOT; attempt++) {
    const seed = baseSeed + attempt * 1013;
    let level;
    try {
      level = generateExactLevel({ count, k, seed, lattice, maxAttempts: 300 });
    } catch (error) {
      if (!(error instanceof LevelGenerationError)) throw error;
      continue;
    }
    if (level.nodeCount > MAX_NODES) continue;

    const stats = ballSizeStats(level.graph, k);
    // All balls the same size means the sum rule says nothing at all: the
    // condition collapses to count * size === n, true for every subset or none.
    if (stats.distinct <= 1) continue;

    const feasible = sumFeasible(level.graph, count, k);
    if (feasible < MIN_SUM_FEASIBLE || feasible > MAX_SUM_FEASIBLE) continue;

    const tiers = solveExactByTiers(level.graph, level.count, level.k);
    if (!tiers.solved) continue;

    keepers.push({ ...level, tiers, stats, sumFeasible: feasible, slot: `${count}/${k}/${lattice}` });
  }
  return keepers;
}

/**
 * Rebuilds the three opening levels from their pinned parameters.
 * @returns {object[]}
 */
function openers() {
  return ENTRY.map(({ count, k, seed }) => {
    const level = generateExactLevel({ count, k, seed, maxAttempts: 300 });
    return {
      ...level,
      tiers: solveExactByTiers(level.graph, level.count, level.k),
      stats: ballSizeStats(level.graph, k),
      sumFeasible: sumFeasible(level.graph, count, k),
      slot: `entry ${count}/${k}`,
    };
  });
}

/**
 * @param {string[]} argv
 * @returns {{seed: number, out: string}}
 */
function parseArgs(argv) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let seed = 20260922;
  let out = join(root, 'levels', 'exact');
  for (const arg of argv) {
    const [flag, value] = arg.split('=');
    if (flag === '--seed') seed = Number.parseInt(value, 10);
    else if (flag === '--out') out = resolve(root, value);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(seed)) throw new Error('--seed must be an integer');
  return { seed, out };
}

/**
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 * @returns {string}
 */
function table(headers, rows) {
  const cells = [headers, ...rows.map((row) => row.map(String))];
  const widths = headers.map((_, column) => Math.max(...cells.map((row) => row[column].length)));
  const line = (row) =>
    row.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ');
  return [line(cells[0]), widths.map((width) => '-'.repeat(width)).join('  '), ...cells.slice(1).map(line)].join('\n');
}

function main() {
  const { seed: baseSeed, out } = parseArgs(process.argv.slice(2));
  const started = Date.now();

  const perSlot = SLOTS.map((slot, index) => harvest(slot, baseSeed + index * 7919));

  // Round-robin across the slots, so the set stays varied rather than filling
  // up from whichever slot happens to be most productive.
  const picked = [];
  for (let round = 0; round < PER_SLOT && picked.length < WANTED_NEW; round++) {
    for (const slot of perSlot) {
      if (picked.length >= WANTED_NEW) break;
      if (slot[round]) picked.push(slot[round]);
    }
  }

  // The openers carry sumFeasible === 1, so sorting puts them first by itself.
  const levels = [...openers(), ...picked]
    .sort((a, b) => a.sumFeasible - b.sumFeasible || a.nodeCount - b.nodeCount);

  mkdirSync(out, { recursive: true });
  for (const stale of readdirSync(out).filter((name) => name.endsWith('.json'))) rmSync(join(out, stale));

  const index = [];
  levels.forEach((level, position) => {
    const id = String(position + 1).padStart(2, '0');
    const payload = {
      id,
      mode: 'exact',
      seed: level.seed,
      lattice: level.lattice,
      nodeCount: level.nodeCount,
      count: level.count,
      k: level.k,
      sumFeasible: level.sumFeasible,
      ballSizeSpread: level.stats.spread,
      ballSizesDistinct: level.stats.distinct,
      minBallSize: Math.min(...level.stats.sizes),
      maxBallSize: Math.max(...level.stats.sizes),
      tiers: {
        solved: level.tiers.solved,
        maxTier: level.tiers.maxTier,
        e1Steps: level.tiers.e1Steps,
        e2Steps: level.tiers.e2Steps,
      },
      solution: level.solution,
      graph: level.graph,
    };
    writeFileSync(join(out, `${id}.json`), `${JSON.stringify(payload, null, 2)}\n`);
    index.push({ id, file: `${id}.json`, nodeCount: level.nodeCount, count: level.count,
      k: level.k, sumFeasible: level.sumFeasible });
  });
  writeFileSync(join(out, 'index.json'), `${JSON.stringify({ mode: 'exact', levels: index }, null, 2)}\n`);

  console.log(table(
    ['file', 'n', 'count', 'k', 'topology', 'sumFeasible', 'ballSizeSpread', 'distinctSizes', 'ballRange', 'e2Steps'],
    levels.map((level, position) => [
      `${String(position + 1).padStart(2, '0')}.json`,
      level.nodeCount,
      level.count,
      level.k,
      level.lattice,
      level.sumFeasible,
      level.stats.spread.toFixed(2),
      level.stats.distinct,
      `${Math.min(...level.stats.sizes)}-${Math.max(...level.stats.sizes)}`,
      level.tiers.e2Steps,
    ]),
  ));

  const used = new Map();
  for (const level of levels) used.set(level.slot, (used.get(level.slot) ?? 0) + 1);
  console.log(`\nper slot: ${[...used].map(([slot, n]) => `${slot} x${n}`).join('   ')}`);
  console.log(
    `sumFeasible corridor: ${MIN_SUM_FEASIBLE}..${MAX_SUM_FEASIBLE}, boards up to ${MAX_NODES} nodes ` +
      '(the three openers sit below the floor on purpose)',
  );
  if (picked.length < WANTED_NEW) {
    console.log(`\nSHORT: wanted ${WANTED_NEW} levels in the corridor, found ${picked.length}. Not padded.`);
  }
  console.log(`\n${levels.length} exact levels written to ${out} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main();
