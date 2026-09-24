/**
 * Checks the wide bots against the ones they replace.
 *
 *   node tools/verify-bot64.js [--runs=200]
 *
 * Everything measured in endless mode is played by `tools/bot64.js`, so the
 * numbers only mean something if that module plays the same game as the 32-bit
 * original on the boards where both apply. Three claims are tested, move by
 * move along a greedily played line over the standard three-stage run:
 *
 *   1. greedy agrees, node for node;
 *   2. the wide search with an unbounded beam agrees with the exact one;
 *   3. how often the narrow beam (8) picks something else.
 */

import { advance, createRun, DEFAULT_RUN, place } from '../src/run.js';
import * as narrow from '../src/../tools/bot.js';
import * as wide from './bot64.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const runs = Number.parseInt(args.runs ?? '200', 10);

let moves = 0;
let greedyDiffers = 0;
let exactDiffers = 0;
let beamDiffers = 0;
let beamWorse = 0;

for (let seed = 1; seed <= runs; seed++) {
  let state = createRun({ seed, config: DEFAULT_RUN });
  while (state.status === 'playing' || state.status === 'stageCleared') {
    if (state.status === 'stageCleared') { state = advance(state); continue; }
    moves++;
    if (narrow.greedyChoice(state) !== wide.greedyChoice(state)) greedyDiffers++;
    const exact = narrow.lookaheadChoice(state);
    if (exact !== wide.lookaheadChoice(state, { beam: Infinity })) exactDiffers++;
    const beamed = wide.lookaheadChoice(state, { beam: wide.BEAM });
    if (beamed !== exact) {
      beamDiffers++;
      // Is the narrow pick actually a worse opening, or just a different one of
      // equal value? Compare what each leaves lit after the visible horizon.
      const after = (id) => {
        const next = place(state, id);
        return next.graph.nodes.length - next.uncovered.length;
      };
      if (after(beamed) < after(exact)) beamWorse++;
    }
    state = place(state, narrow.greedyChoice(state));
  }
}

const pct = (x) => `${((100 * x) / moves).toFixed(2)}%`;
console.log(`${moves} Zuege ueber ${runs} Partien (Standardlauf 18/24/30)`);
console.log(`gierig weicht ab:                 ${greedyDiffers}  (${pct(greedyDiffers)})`);
console.log(`voraus exakt vs. 32-Bit exakt:    ${exactDiffers}  (${pct(exactDiffers)})`);
console.log(`voraus Beam ${wide.BEAM} vs. exakt:        ${beamDiffers}  (${pct(beamDiffers)})`);
console.log(`davon sofort schlechter:          ${beamWorse}  (${pct(beamWorse)})`);
