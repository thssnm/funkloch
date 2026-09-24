#!/usr/bin/env node
/**
 * Harvests levels into levels/ in ascending difficulty and prints a table plus
 * the tier distribution.
 *
 * Difficulty here means which inference rules a level forces a player to use,
 * not how large its search space is. Levels are ordered by the highest tier
 * they demand, then by how much of that tier, then by tier-1 bookkeeping.
 *
 *   node tools/build-levels.js [--seed=20260922] [--out=levels]
 *
 * Everything here is deterministic: the same base seed rebuilds byte-identical
 * files. Each slot is a (nodeCount, count, k) triple from the parameter window
 * that actually admits uniquely solvable levels — too many transmitters for too
 * few nodes almost never yields a *unique* solution, because a transmitter
 * sitting on a leaf can usually be moved to its neighbour for free.
 */

import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateLevel, LevelGenerationError } from '../src/generator.js';
import { solveByTiers } from '../src/tiers.js';

/**
 * Parameter slots to harvest from. Every one runs with minDegree 2: a node of
 * degree 1 can always be covered from its single neighbour, which hands the
 * player a free forced move and collapses the level to tier 1. Measured over
 * 321 samples, minDegree 1 produced not a single tier-2 level.
 * @type {Array<[number, number, number]>} [nodeCount, count, k]
 */
const SLOTS = [
  [10, 3, 1], [12, 3, 1], [14, 4, 1], [16, 4, 1], [18, 5, 1],
  [12, 2, 2], [16, 3, 2], [18, 3, 2], [24, 4, 2],
];

/** Edge densities to alternate between, for variety in the harvest. */
const EDGE_RATIOS = [0.15, 0];

/** How many of each kind the ladder wants: a third pure tier 1, two thirds
 *  demanding at least one packing-bound step. */
const TIER1_TARGET = 10;
const TIER2_TARGET = 20;

/** Give up after this many generation attempts rather than run forever. */
const MAX_ATTEMPTS = 2000;

/** Cap per slot, so the ladder does not fill up with near-identical boards from
 *  whichever parameter pocket happens to yield tier-2 levels most readily. */
const PER_SLOT_CAP = 4;

/**
 * Generates levels across the slots until both quotas are full or the attempt
 * budget runs out. Levels deduction cannot finish are discarded outright — a
 * level that needs guessing is not a level.
 * @param {number} baseSeed
 * @returns {{tier1: object[], tier2: object[], stats: object}}
 */
function harvest(baseSeed) {
  const tier1 = [];
  const tier2 = [];
  const taken = new Map(); // `${slotIndex}:${tier}` -> how many kept so far
  const stats = { attempts: 0, generated: 0, ungenerable: 0, unsolved: 0, capped: 0 };

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (tier1.length >= TIER1_TARGET && tier2.length >= TIER2_TARGET) break;
    stats.attempts++;

    const slotIndex = i % SLOTS.length;
    const [nodeCount, count, k] = SLOTS[slotIndex];
    const edgeDeleteRatio = EDGE_RATIOS[Math.floor(i / SLOTS.length) % EDGE_RATIOS.length];
    const seed = baseSeed + i * 1013;

    let level;
    try {
      level = generateLevel({ nodeCount, count, k, seed, edgeDeleteRatio, minDegree: 2, maxAttempts: 250 });
    } catch (error) {
      if (!(error instanceof LevelGenerationError)) throw error;
      stats.ungenerable++;
      continue;
    }
    stats.generated++;

    const tiers = solveByTiers(level.graph, level.count, level.k);
    if (!tiers.solved) {
      stats.unsolved++;
      continue;
    }
    const bucket = tiers.maxTier === 2 ? tier2 : tier1;
    const target = tiers.maxTier === 2 ? TIER2_TARGET : TIER1_TARGET;
    if (bucket.length >= target) continue;

    const key = `${slotIndex}:${tiers.maxTier}`;
    if ((taken.get(key) ?? 0) >= PER_SLOT_CAP) {
      stats.capped++;
      continue;
    }
    taken.set(key, (taken.get(key) ?? 0) + 1);
    bucket.push({ ...level, edgeDeleteRatio, tiers });
  }

  return { tier1, tier2, stats };
}

/**
 * Ladder order: which rules a level forces, then how much of the harder rule,
 * then how much bookkeeping.
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
function byDifficulty(a, b) {
  return (
    a.tiers.maxTier - b.tiers.maxTier ||
    a.tiers.tier2Steps - b.tiers.tier2Steps ||
    a.tiers.tier1Steps - b.tiers.tier1Steps ||
    a.nodeCount - b.nodeCount
  );
}

/**
 * @param {string[]} argv
 * @returns {{seed: number, out: string}}
 */
function parseArgs(argv) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let seed = 20260922;
  let out = join(root, 'levels');
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
 * Renders rows as a fixed-width table.
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

  const { tier1, tier2, stats } = harvest(baseSeed);
  const levels = [...tier1, ...tier2].sort(byDifficulty);

  mkdirSync(out, { recursive: true });
  for (const stale of readdirSync(out).filter((name) => name.endsWith('.json'))) {
    rmSync(join(out, stale));
  }

  const index = [];
  levels.forEach((level, position) => {
    const id = String(position + 1).padStart(2, '0');
    const file = `${id}.json`;
    // `solution` is included on purpose: the game needs it to verify and to
    // offer a hint. It is not a secret — count and k make it brute-forceable.
    const payload = {
      id,
      seed: level.seed,
      lattice: level.lattice,
      nodeCount: level.nodeCount,
      count: level.count,
      k: level.k,
      minDegree: 2,
      tiers: {
        solved: level.tiers.solved,
        maxTier: level.tiers.maxTier,
        tier1Steps: level.tiers.tier1Steps,
        tier2Steps: level.tiers.tier2Steps,
        trace: level.tiers.trace,
      },
      solution: level.solution,
      graph: level.graph,
    };
    writeFileSync(join(out, file), `${JSON.stringify(payload, null, 2)}\n`);
    index.push({
      id,
      file,
      nodeCount: level.nodeCount,
      count: level.count,
      k: level.k,
      maxTier: level.tiers.maxTier,
      tier2Steps: level.tiers.tier2Steps,
    });
  });
  writeFileSync(join(out, 'index.json'), `${JSON.stringify({ levels: index }, null, 2)}\n`);

  const rows = levels.map((level, position) => [
    `${String(position + 1).padStart(2, '0')}.json`,
    level.nodeCount,
    level.graph.edges.length,
    level.count,
    level.k,
    level.lattice,
    level.tiers.maxTier,
    level.tiers.tier2Steps,
    level.tiers.tier1Steps,
    level.attempts,
  ]);
  console.log(
    table(
      ['file', 'nodes', 'edges', 'count', 'k', 'lattice', 'tier', 'tier2Steps', 'tier1Steps', 'tries'],
      rows,
    ),
  );

  const perTier = new Map();
  for (const level of levels) {
    perTier.set(level.tiers.maxTier, (perTier.get(level.tiers.maxTier) ?? 0) + 1);
  }
  console.log('\nlevels per tier:');
  for (const tier of [...perTier.keys()].sort()) {
    const hits = perTier.get(tier);
    console.log(`  tier ${tier} | ${'#'.repeat(hits).padEnd(TIER2_TARGET)} ${hits}`);
  }
  console.log(
    `\nharvest: ${stats.attempts} attempts -> ${stats.generated} unique levels, ` +
      `${stats.ungenerable} parameter/seed pairs admitted none, ` +
      `${stats.unsolved} discarded as not deducible, ${stats.capped} skipped by the per-slot cap`,
  );
  if (tier2.length < TIER2_TARGET) {
    console.log(
      `\nSHORT: wanted ${TIER2_TARGET} tier-2 levels, found ${tier2.length} in ${stats.attempts} ` +
        'attempts. The ladder is NOT padded with tier-1 levels to make up the difference — ' +
        `it ships ${levels.length} levels instead of 30.`,
    );
  }
  if (tier1.length < TIER1_TARGET) {
    console.log(`\nSHORT: wanted ${TIER1_TARGET} tier-1 levels, found ${tier1.length}.`);
  }
  console.log(`\n${levels.length} levels written to ${out} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main();
