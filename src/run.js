/**
 * One run of the sender mode: three levels, a procedurally drawn board each
 * time, and a hand of senders of radius 1, 2 or 3 to clear it with.
 *
 * The loop: draw the sender at the front of the pile, see the next two, place
 * it. Clear the board before the senders run out and whatever is left over
 * counts as score, weighted by the level it was saved on; run out with nodes
 * still dark and the run is over.
 *
 * A placement is final. Lifting a placed transmitter back off the board was
 * allowed once — it stayed spent either way, so what the lift bought was the
 * *node*, not the card — and it is gone again: the planning bot reached for it
 * in 5.7% of runs and gained 0.5 percentage points of win rate for it, which
 * does not pay for blurring the one rule the whole mode rests on.
 *
 * Everything random is derived from `(seed, level)`, so no rng state has to be
 * carried around: the state stays pure, serializable and replayable, and a bot
 * can play thousands of runs without the board depending on how it played.
 *
 * `level` here is always a number, the board of the run being played. In the
 * puzzle modes (`game.js`, `levels/*.json`) a level is a stored puzzle object;
 * the two never meet in one state.
 */

import {
  amplifierNodes, bfsWithin, bfsWithinAmplified, bfsWithinBlocked, blockedNodes,
} from './graph.js';
import { generateCandidate, mulberry32, shuffled } from './generator.js';

/** @typedef {import('./graph.js').Graph} Graph */

/**
 * Share of the triangulation's edges the generator tries to delete again.
 * A config may override it with its own `edgeDeleteRatio`.
 *
 * Deleting less leaves a denser board: more edges, higher degree, and fewer of
 * the chains of degree-2 nodes on which a radius 2 always lights the same five
 * nodes, so only roughly where it goes matters and never exactly. That is a
 * real defect of the shipped board — at 0.2 nearly every second node has
 * degree 2 — and the obvious repair is to delete less. Measured with
 * `tools/density.js`, it does not pay: the chains go away, the reward for
 * planning does not grow.
 *
 * Board shape, 300 boards per row, node counts as the endless mode deals them:
 *
 *   0.00   degree 3.53   deg-2 23.0%   in chains  2.1%   ball 8.45
 *   0.05   degree 3.37   deg-2 27.1%   in chains  2.9%   ball 8.14
 *   0.10   degree 3.19   deg-2 32.5%   in chains  3.9%   ball 7.76
 *   0.15   degree 3.02   deg-2 38.8%   in chains  5.3%   ball 7.38
 *   0.20   degree 2.84   deg-2 46.3%   in chains  7.5%   ball 6.96   <- this one
 *   0.30   degree 2.50   deg-2 63.9%   in chains 17.2%   ball 6.06
 *
 * Density does not only add branchings, it also grows the ball, and a board
 * that is cheaper to clear is easier whatever its shape. Played with the
 * shipped senders the gap between the greedy and the planning bot therefore
 * explodes — 2.22x at 0.20 against 9.94x at 0.00 — but that is the planner
 * no longer dying, not the board rewarding thought: at 0.00 a quarter of its
 * runs stand on the 200-level cap, which makes the row a floor and not a
 * reading.
 *
 * With the senders scaled by the change in ball size, so that every density
 * costs about the same transmitters per node, the gap is flat. Ratio of mean
 * level reached, planning over greedy, 300 runs per bot and row, three starting
 * seeds (1, 1001, 2001):
 *
 *   0.00   2.09x / 1.93x / 1.97x
 *   0.05   2.01x / 2.05x / 1.91x
 *   0.10   1.96x / 1.91x / 1.95x
 *   0.15   2.56x / 2.58x / 2.53x
 *   0.20   2.22x / 2.24x / 2.20x   <- this one
 *   0.30   1.83x / 1.80x / 1.88x
 *
 * (Level *reached* — the level a run died in, i.e. levels cleared + 1 — which
 * is what the tools counted then. They now count levels cleared; that lowers
 * every mean by one but moves the ratios unevenly, so a repeat of this
 * measurement reads higher without the game having changed. See MESSUNGEN.md.)
 *
 * The median gap is +4 levels in every row and every seed, and the denser
 * boards (0.00 to 0.10) sit *below* today's 0.20. Less deleting buys
 * branchings but not a reason to think ahead: what a chain costs is not the
 * choice of where to put a transmitter, it is which transmitter to spend on it
 * and which to keep for the branching, and that choice survives however few
 * chains the board has.
 *
 * The bump at 0.15 reproduces across all three seeds, so it is not noise, but
 * it is one step between two lower neighbours rather than a trend, and it
 * carries the spread of a heavy tail (SD 8.5 to 8.9 against 3.2 to 6.6
 * elsewhere). Suspected cause: the sender count is `round(nodeCount * ratio)`,
 * and the 0.944 adjustment moves it by a whole transmitter on individual
 * levels. That deserves its own measurement; it is not an argument for moving
 * the default.
 */
const EDGE_DELETE_RATIO = 0.2;

/** Default shape of a run: three boards, growing. */
export const DEFAULT_RUN = {
  /** Node count of each level, in order. */
  levelSizes: [18, 24, 30],
  /** Topologies to draw from. Rectangular lattices are left out: their uniform
   *  degree makes every placement worth about the same, which is dull. */
  lattices: ['delaunay', 'hex'],
  /**
   * Sender count as a share of the node count — the setting everything hinges
   * on. A single number applies to every level; an array gives each level its
   * own.
   *
   * Calibrated against the *planning* bot, not the greedy one: a person can see
   * the next two transmitters and will use them, so tuning against a bot that
   * ignores the preview sets the difficulty for a player who does not exist.
   * Measured over 1000 runs per setting, greedy vs. planning, re-run after the
   * `fillSenders` repair below (which made a hand of four carry a radius 3,
   * so all three settings came out easier than they first measured):
   *
   *   4/5/7 (flat 0.22)    86% / 99%   the planner is never troubled
   *   5/6/6 (0.28/../0.20) 90% / 100%  likewise, and level 1 becomes a formality
   *   4/5/5 (this one)     45% / 94%   the widest gap measured, +49 points
   *
   * The descending shape also moves failure late: only 18 of the 546 greedy
   * losses happened in level 1, against 418 in level 3.
   *
   * (Win rates and the level a run was lost *in*; neither moves when the tools
   * switch from levels reached to levels cleared.)
   */
  senderRatio: [0.22, 0.19, 0.17],
  /** Transmitter mix as [radius, weight] pairs. */
  composition: [[1, 4], [2, 4], [3, 2]],
};

/**
 * The endless shape: no last level, only the one you did not survive.
 *
 * Two dials move together as the levels go by. The board grows, and the
 * senders shrink relative to it — from 0.24 of the node count down towards 0.15
 * along an exponential, never quite arriving. 0.15 is chosen to sit just under
 * what a board of this family actually costs to clear (a ball averages about
 * six new nodes under the 4/4/2 mix, so roughly n/6 transmitters are needed,
 * i.e. 0.167 of the nodes). The curve therefore ends in a regime that is lost
 * eventually — the question a run asks is only how late.
 *
 * `max` caps the board at 60 nodes: the bots' bitmask search holds a board in
 * two 32-bit words, so 64 is the hard ceiling and 60 keeps a margin. Past the
 * cap the difficulty rides on the sender ratio alone.
 */
export const ENDLESS_RUN = {
  endless: true,
  /**
   * Level 1 is the onboarding board, taken out of the curve: small, and with
   * far more senders than it needs, so that it teaches the rule by being won —
   * tap places a sender, the signal spreads, every node has to be lit. Nothing
   * explains the game before the first tap, and a hint under the board is not
   * read; a level that can be lost there teaches only that it can be lost.
   *
   * The bar is the greedy bot: a person meeting the game for the first time
   * plays worse than greedy, so greedy has to clear every board. Level 1 alone,
   * 5000 seeds, the same seeds for every bot; "random" taps any free node and
   * stands in for someone who has not yet looked (`tools/onboarding.js`):
   *
   *   nodes/senders  greedy fails  random fails  greedy needs (mean / max)
   *    8 / 4          0.0 %         2.0 %         1.63 / 3
   *    8 / 6          0.0 %         0.0 %         1.72 / 4
   *    9 / 4          0.0 %         7.1 %         1.84 / 3
   *    9 / 5          0.0 %         2.7 %         2.01 / 4
   *    9 / 6          0.0 %         0.3 %         1.98 / 4   <- this one
   *   10 / 5          0.0 %         9.6 %         2.15 / 4
   *   10 / 6          0.0 %         2.7 %         2.14 / 4
   *
   * At 1000 seeds, 10 nodes with 3 senders already lets greedy fail (0.2 %),
   * and 9 with 2 fails a third of the time. 9 / 6 leaves greedy two senders
   * even on its worst board and four on an average one.
   *
   * It *replaces* level 1; from level 2 on every board is the one the curve
   * dealt before, bit for bit, since level i is drawn from `seed + i * 7919`
   * alone. Whole runs, levels cleared, 1000 runs per bot, seeds 1 / 1001, and
   * 365 daily boards from 2026-01-01 (`tools/onboarding.js --full`):
   *
   *                    greedy mean   planner median / mean   gap    ratio
   *   before           4.15 / 4.25   8 / 10.68 · 8 / 10.70   +4 +4  2.57 2.52
   *   replaced         4.30 / 4.40   8 / 10.68 · 8 / 10.70   +4 +4  2.49 2.43  <- this
   *   in front         5.23          9 / 11.92               +4     2.28
   *   in front, tau 3  4.35          7 /  8.53               +3     1.96
   *   daily, before    4.09          9 / 10.76               +5     2.63
   *   daily, replaced  4.16          9 / 10.76               +5     2.58
   *
   * Replacing leaves the planner exactly where it was — it never died on the
   * old level 1 — and gives greedy back the 3.1 % of runs that ended there. The
   * curve needed no correction. Putting the board in front instead (yesterday's
   * 18-node level 1 becomes level 2) makes a gentler second step but every run
   * one level longer, and the curve cannot take that level back cleanly: the
   * sender counts are whole, `tau` 3 and 2.5 deal identical counts on all 14
   * levels, and the next step down overshoots to a median of 7 while the gap
   * shrinks to +3. What replacing costs is the step from 9 nodes to 22 at
   * level 2, where greedy ends 4.2 % of runs — about what the old first board
   * (3.1 %) asked of a newcomer who had not yet been shown anything.
   *
   * No blocked node: 5 % of 9 rounds to none, which keeps the first board to
   * the one rule it teaches.
   *
   * `scores: false` — its leftovers are worth nothing. The board is generous on
   * purpose, so what it leaves over is handed out, not earned: about four
   * points for every run, 10.6 % of the planner's median score and 27.8 % in
   * its lower quartile, and all of it for a weak run that ends on level 2
   * (`tools/onboarding.js --points`, 1000 runs). Not counting it puts the score
   * back where it stood before the onboarding level (planner median 31.5
   * against 32). It still counts as a level cleared.
   */
  firstLevel: { nodes: 9, senders: 6, scores: false },
  /** nodeCount(level) = min(max, start + growth * (level - 1)), from level 2 on */
  levelNodes: { start: 18, growth: 4, max: 60 },
  /** ratio(level) = floor + (start - floor) * exp(-(level - 1) / tau) */
  senderCurve: { start: 0.24, floor: 0.15, tau: 4 },
  lattices: ['delaunay', 'hex'],
  composition: [[1, 4], [2, 4], [3, 2]],
  /**
   * Share of nodes made impermeable — see `bfsWithinBlocked` in graph.js.
   * Here for board variation: an impermeable node changes what a placement is
   * worth without changing any rule, and no node can ever drop below
   * degree + 1 possible suppliers, because blocking stops transit and neither
   * the source nor the node reached is transit. Blocking shortens reach; it
   * never forces a move.
   *
   * Kept as low as board variation allows, because it is not free: blocking
   * hits the planning bot harder than the greedy one, so the reward for
   * thinking ahead shrinks with every node made opaque. Mean level reached,
   * greedy vs. planning, with the planner's spread; `tools/blocked.js --bots`.
   *
   * Every table in this comment counts the level a run died in — levels
   * cleared + 1 — which is what the tools counted when it was measured. They
   * now count levels cleared. The means drop by exactly one and the SD stays,
   * but the ratio does not shift evenly: 5.23 / 11.73 = 2.24x reached is
   * 4.23 / 10.73 = 2.54x cleared. A repeat run reads higher without anything
   * in the game having changed.
   *
   * Re-measured on the shipped tree, 500 runs per density, same tool and the
   * same run count as the table it replaces: at 0.12 the ratio between the bots
   * falls to 1.98 and the spread to SD 5.13, while 0.05 still holds 2.24 and
   * SD 7.18 — against 2.47 and SD 9.74 on a board with nothing blocked at all.
   *
   *   0.00   5.57 / 13.74   2.47x   SD 9.74
   *   0.05   5.23 / 11.73   2.24x   SD 7.18   <- this one
   *   0.12   4.80 /  9.51   1.98x   SD 5.13
   *   0.20   4.33 /  7.70   1.78x   SD 3.07
   *   0.40   3.26 /  5.61   1.72x   SD 1.57
   *
   * The same run also covered 0.10 (4.90 / 10.02, 2.04x, SD 5.26), 0.15
   * (4.62 / 8.91, 1.93x, SD 4.09) and 0.30 (3.76 / 6.58, 1.75x, SD 2.11).
   *
   * The table below is the one the density was originally chosen against. It
   * stays because that is what the choice was made on. Neither bot has ever
   * lifted a transmitter, so dropping that rule is not what moved the digits —
   * the ordering and the shape are unchanged either way:
   *
   *   0.00   5.8 / 14.5   2.49x   SD 9.37
   *   0.05   5.3 / 11.3   2.14x   SD 6.63   <- this one
   *   0.12   4.8 /  9.3   1.94x   SD 4.56
   *   0.20   4.4 /  7.9   1.80x   SD 2.91
   *   0.40   3.2 /  5.7   1.77x   SD 1.57
   *
   * (Measured against the older, truncating fillSenders the relative distance
   * looked constant at 2.5x across every density; it was the broken hand
   * holding it there, not the blocking. Re-measured over 1000 runs per density
   * on identical boards, the three that matter come out at 2.54x / 2.27x /
   * 1.93x for 0 / 0.05 / 0.15 — the same picture, a little sharper.)
   *
   * The endless sweep at the shipped density agrees with the fresh table:
   * 1000 runs at 0.05 give 5.15 / 11.68, 2.27x, SD 7.06
   * (`tools/endless.js --runs=1000`).
   *
   * An array instead of a number is drawn from uniformly, once per level, so
   * the density can vary from board to board rather than being a constant of
   * the mode. It does not buy the spread back: `[0, 0.05, 0.15]` measures at a
   * mean level of 10.5 with SD 5.81 and 2.11x, against 11.7 / 7.06 / 2.27x for
   * a flat 0.05 — worse than the average of its three parts, and worse than the
   * flat 0.067 it averages to. A run has to survive every board it is dealt, so
   * the hardest density in the mix weighs more than its third.
   */
  blockedRatio: 0.05,
};

/**
 * Milliseconds in a calendar day as `Date.UTC` counts them. Used only to turn a
 * date into a day number; how long a day of the daily board actually lasts is
 * up to the time zone, and is 23 or 25 hours twice a year.
 */
const DAY_MS = 86400000;

/**
 * The one clock the daily board runs on: it turns over at midnight in Berlin.
 *
 * What matters is not that the zone is neutral but that it is the same for
 * everyone. The board is only worth playing if everyone plays the same one at
 * the same moment, so that two results can be compared; a device-local date
 * would hand New Zealand tomorrow's board while California is still on
 * yesterday's. Until 2026-10-12 that one clock was UTC, which put the change
 * at two in the morning in Germany, where the game is played. Berlin puts it on
 * the midnight its players actually have, and every one else still changes at
 * the same instant, just not at their own midnight.
 *
 * A real time zone and never a fixed offset: Berlin is UTC+1 in winter and
 * UTC+2 in summer, so a fixed two hours would put the change at one in the
 * morning for five months of the year. `Intl.DateTimeFormat` knows the rules.
 */
export const DAILY_TIME_ZONE = 'Europe/Berlin';

/** Reads the wall clock in `DAILY_TIME_ZONE`, to the second. */
const WALL_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: DAILY_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/**
 * The date and time on a Berlin wall clock at the moment `time`.
 * @param {number} time epoch milliseconds
 * @returns {{year: number, month: number, day: number, hour: number, minute: number, second: number}}
 */
function wallClock(time) {
  const parts = {};
  for (const { type, value } of WALL_CLOCK.formatToParts(new Date(time))) {
    if (type !== 'literal') parts[type] = Number(value);
  }
  return parts;
}

/**
 * How far Berlin's wall clock runs ahead of UTC at the moment `time`, in
 * milliseconds: one hour in winter, two in summer.
 * @param {number} time
 * @returns {number}
 */
function offsetAt(time) {
  const second = time - (((time % 1000) + 1000) % 1000);
  const { year, month, day, hour, minute, second: s } = wallClock(second);
  return Date.UTC(year, month - 1, day, hour, minute, s) - second;
}

/**
 * Normalises a `Date` or an epoch millisecond count to a number.
 * @param {Date|number} at
 * @returns {number}
 */
function toTime(at) {
  const time = at instanceof Date ? at.getTime() : at;
  if (!Number.isFinite(time)) throw new RangeError(`not a moment in time: ${String(at)}`);
  return time;
}

/**
 * The day of the daily board a moment falls in, as `YYYY-MM-DD` — the date on
 * a wall clock in `DAILY_TIME_ZONE`, the same for every player wherever they
 * are; see there for why one zone and not the device's own.
 *
 * `at` is required rather than defaulting to the current time, so that this
 * half of the code reads no clock and a test can ask about any day it likes.
 * @param {Date|number} at
 * @returns {string}
 */
export function boardDay(at) {
  const { year, month, day } = wallClock(toTime(at));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Seed of the daily board for the day `at` falls in (`boardDay`).
 *
 * The seed hangs on the date alone — its day number counted from 1970-01-01 —
 * not on the instant. So a date keeps the board it always had: moving the change
 * from UTC midnight to Berlin midnight moved *when* each board comes, not which
 * board belongs to which date, and the stored attempt, which is keyed by the
 * same date string, always matches the board it was played on.
 *
 * Hashed rather than used directly, because the level seeds are `seed + level *
 * 7919`: consecutive days would otherwise deal boards from neighbouring corners
 * of the same PRNG stream, and the first board of Tuesday would be a near miss
 * of the second board of Monday. The mix is the finaliser of murmur3, which
 * scatters two inputs one apart across the whole range.
 * @param {Date|number} at
 * @returns {number} integer in [0, 2^32), suitable as a `createRun` seed
 */
export function dailySeed(at) {
  const { year, month, day } = wallClock(toTime(at));
  return mix32(Date.UTC(year, month - 1, day) / DAY_MS);
}

/**
 * The finaliser of murmur3: scatters inputs one apart across the whole 32-bit
 * range. A bijection on 32-bit integers, so distinct inputs below 2^32 never
 * share an output.
 * @param {number} value
 * @returns {number} integer in [0, 2^32)
 */
function mix32(value) {
  let hash = Math.imul(value ^ (value >>> 16), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

/**
 * Seed of a free run started at the moment `at`.
 *
 * Taken from the clock rather than from `Math.random`, so that a free run has a
 * seed like every other run: one the page can show on the end card and hand
 * back through `?seed=`, which replays the run board for board. The clock is
 * read by the caller — this half of the code reads none.
 *
 * Hashed, never the timestamp itself, for the reason `dailySeed` is: level `i`
 * of a run is drawn from `seed + i * 7919`, so two runs started 7919 ms apart
 * would deal the same boards one level out of step. The millisecond count is
 * wider than 32 bits, so its high part is mixed in on its own first; within any
 * span of 2^32 ms (about 50 days) two different moments always get two
 * different seeds.
 * @param {Date|number} at
 * @returns {number} integer in [0, 2^32), suitable as a `createRun` seed
 */
export function freeSeed(at) {
  const time = Math.floor(toTime(at));
  const high = Math.floor(time / 2 ** 32);
  return mix32((time >>> 0) ^ mix32(high));
}

/**
 * Milliseconds from `at` until the next midnight in `DAILY_TIME_ZONE`, i.e.
 * until the next daily board — the same clock `boardDay` reads, so the countdown
 * and the change cannot drift apart.
 *
 * Never zero: at midnight exactly the day has already turned and a whole new
 * one is ahead. A whole one is usually 24 hours, but 23 on the day the clocks
 * go forward and 25 on the day they go back. Berlin changes its clocks at two
 * and three in the morning, never at midnight, so every date has exactly one.
 *
 * Found by asking the zone rather than by adding an offset: the next date's
 * midnight, written as if it were UTC, minus the offset in force at that
 * instant. The offset is looked up twice, because the first guess may sit on
 * the other side of a change.
 * @param {Date|number} at
 * @returns {number}
 */
export function msUntilNextDay(at) {
  const time = toTime(at);
  const { year, month, day } = wallClock(time);
  const asIfUtc = Date.UTC(year, month - 1, day + 1);
  let midnight = asIfUtc - offsetAt(asIfUtc);
  midnight = asIfUtc - offsetAt(midnight);
  return midnight - time;
}

/**
 * Node count, sender ratio and sender count for level `index` (0-based), for
 * either shape of run. The fixed shape reads them off its arrays; the endless
 * one computes them from its two curves, except for a `firstLevel` it is given
 * outright.
 * @param {object} config
 * @param {number} index
 * @returns {{nodeCount: number, ratio: number, senders: number}}
 */
export function levelSpec(config, index) {
  let nodeCount;
  let ratio;
  if (config.endless && index === 0 && config.firstLevel) {
    const { nodes, senders } = config.firstLevel;
    return { nodeCount: nodes, ratio: senders / nodes, senders };
  }
  if (config.endless) {
    const { start, growth, max } = config.levelNodes;
    const curve = config.senderCurve;
    nodeCount = Math.min(max, start + growth * index);
    ratio = curve.floor + (curve.start - curve.floor) * Math.exp(-index / curve.tau);
  } else {
    ratio = Array.isArray(config.senderRatio) ? config.senderRatio[index] : config.senderRatio;
    nodeCount = config.levelSizes[index];
  }
  return { nodeCount, ratio, senders: Math.max(1, Math.round(nodeCount * ratio)) };
}

/**
 * Whether the leftovers of `level` (1-based) count towards the score. They do
 * on every level but an onboarding level marked `scores: false`: what a
 * deliberately generous board leaves over is not something the player did.
 * Exported so the page can say so instead of knowing it a second time.
 * @param {object} config
 * @param {number} level
 * @returns {boolean}
 */
export function levelScores(config, level) {
  return !(level === 1 && config.endless && config.firstLevel?.scores === false);
}

/**
 * Draws a board, retrying until the generator yields one.
 * @param {() => number} rng
 * @param {{nodeCount: number, lattice: string}} spec
 * @returns {Graph}
 */
function drawBoard(
  rng,
  {
    nodeCount, lattice, blockedRatio = null, amplifierRatio = null,
    edgeDeleteRatio = EDGE_DELETE_RATIO,
  },
) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const graph = generateCandidate({
      nodeCount, lattice, minDegree: 2, edgeDeleteRatio, k: 1, rng,
    });
    if (graph === null) continue;
    // Impermeable nodes are sprinkled on the finished board. They never make it
    // unsolvable: a transmitter standing on a node always lights that node.
    //
    // A mode that deals them at all draws the order even at density zero, so
    // that two densities played on the same seed differ in what is blocked and
    // in nothing else — same board, same senders. A mode that has never heard
    // of them (`blockedRatio` absent) keeps its random stream untouched.
    if (blockedRatio !== null) {
      const order = shuffled(rng, graph.nodes.map((node) => node.id));
      const chosen = new Set(order.slice(0, Math.round(nodeCount * blockedRatio)));
      for (const node of graph.nodes) if (chosen.has(node.id)) node.blocked = true;
    }
    // Amplifiers are sprinkled the same way and drawn from their own order, so
    // the two flags are independent and a node may carry both. Same rule as
    // above: a mode that deals them draws even at density zero, a mode that has
    // never heard of them leaves the random stream alone.
    if (amplifierRatio !== null) {
      const order = shuffled(rng, graph.nodes.map((node) => node.id));
      const chosen = new Set(order.slice(0, Math.round(nodeCount * amplifierRatio)));
      for (const node of graph.nodes) if (chosen.has(node.id)) node.amplifier = true;
    }
    return graph;
  }
  throw new Error(`could not draw a ${lattice} board of ${nodeCount} nodes`);
}

/**
 * The density of a sprinkled node flag — impermeable or amplifier — for one
 * level. A number applies to every board; an array is drawn from uniformly,
 * once per level, which makes the density itself part of what a board can
 * surprise you with.
 *
 * The draw happens either way, so a fixed density and a drawn one walk through
 * the same random stream and therefore the same boards.
 * @param {() => number} rng
 * @param {number|number[]|undefined} configured
 * @returns {number|null} null when the mode does not know the flag at all
 */
function drawDensity(rng, configured) {
  if (configured === undefined) return null;
  const draw = rng();
  return Array.isArray(configured) ? configured[Math.floor(draw * configured.length)] : configured;
}

/**
 * Deals the senders of one level, holding the composition as closely as the
 * rounding allows, then shuffles them.
 *
 * Largest remainder, not rounding-and-truncating. Rounding each share on its
 * own overshoots or undershoots the size, and cutting the overshoot off the end
 * of the list always took from the *last* entry of the composition — the rarest
 * and longest-reaching radius. A hand of nine came out as 4x r1, 4x r2, 1x r3
 * and carried less total reach than a hand of eight at 3/3/2, so a level that
 * dealt one more transmitter could be harder than the one before it.
 *
 * Every share is therefore floored first, and the slots left over go to the
 * largest fractions, ties to the longer radius. That keeps each radius within
 * one of its exact share and keeps a bigger hand from ever carrying less.
 * @param {() => number} rng
 * @param {number} size
 * @param {Array<[number, number]>} composition
 * @returns {number[]} radii, in draw order
 */
function fillSenders(rng, size, composition) {
  const total = composition.reduce((sum, [, weight]) => sum + weight, 0);
  const shares = composition.map(([radius, weight]) => {
    const exact = (size * weight) / total;
    return { radius, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let left = size - shares.reduce((sum, share) => sum + share.count, 0);
  for (const share of [...shares].sort((a, b) => b.remainder - a.remainder || b.radius - a.radius)) {
    if (left <= 0) break;
    share.count++;
    left--;
  }

  const senders = [];
  for (const { radius, count } of shares) for (let i = 0; i < count; i++) senders.push(radius);
  return shuffled(rng, senders);
}

/**
 * Builds level `index` (0-based) from the run seed alone.
 * @param {number} seed
 * @param {number} index
 * @param {object} config
 * @returns {{graph: Graph, lattice: string, senders: number[]}}
 */
function buildLevel(seed, index, config) {
  const rng = mulberry32(seed + index * 7919);
  const { nodeCount, ratio, senders } = levelSpec(config, index);
  const lattice = config.lattices[Math.floor(rng() * config.lattices.length)];
  const blockedRatio = drawDensity(rng, config.blockedRatio);
  const amplifierRatio = drawDensity(rng, config.amplifierRatio);
  const graph = drawBoard(rng, {
    nodeCount, lattice, blockedRatio, amplifierRatio, edgeDeleteRatio: config.edgeDeleteRatio,
  });
  if (!Number.isFinite(ratio)) throw new RangeError(`no senderRatio for level ${index + 1}`);
  return { graph, lattice, senders: fillSenders(rng, senders, config.composition) };
}

/**
 * Recomputes everything derived from the placements.
 * @param {object} base fields that survive a placement unchanged
 * @param {Array<{id: *, radius: number}>} placed
 * @param {number[]} senders
 * @returns {object} frozen state
 */
function build(base, placed, senders) {
  // The three walks agree node for node on a board that carries neither flag;
  // the checks only keep the ordinary board off the slower paths.
  let ball = bfsWithin;
  if (amplifierNodes(base.graph).size > 0) ball = bfsWithinAmplified;
  else if (blockedNodes(base.graph).size > 0) ball = bfsWithinBlocked;
  const covered = new Set();
  const radii = new Map();
  for (const { id, radius } of placed) {
    radii.set(id, radius);
    for (const reached of ball(base.graph, id, radius)) covered.add(reached);
  }
  const uncovered = base.graph.nodes.filter((node) => !covered.has(node.id)).map((node) => node.id);

  const cleared = uncovered.length === 0;
  // An endless run has no last level: clearing one always leads to the next.
  const lastLevel = !base.config.endless && base.level === base.config.levelSizes.length;
  const status = cleared
    ? (lastLevel ? 'won' : 'levelCleared')
    : (senders.length === 0 ? 'lost' : 'playing');
  // Leftovers only score once the board is actually clear, and they count for
  // the level they were saved on: a transmitter spared on level 12 is worth
  // twelve, one spared on level 1 is worth one. The run's score is the sum over
  // its cleared levels of leftovers times level number.
  //
  // The obvious alternative — keep the plain sum and multiply by the level
  // reached at the very end — is wrong twice over. It counts endurance twice,
  // because the points already grow with the level: a run that lasts twice as
  // long clears twice as many boards and banks the leftovers of all of them, so
  // multiplying on top squares exactly what it means to reward. And it hangs
  // the whole run on a single factor, which makes zero points annul everything:
  // a player who reached level 30 sparing nothing would score the same as one
  // who never left level 1. Weighting inside the run avoids both — every level
  // contributes what it was worth where it stood, and a level that contributed
  // nothing costs nothing.
  //
  // It does not change how the mode is best played. Inside level s every
  // leftover is worth s, the same positive constant for every decision on that
  // board, and leftovers do not carry into the next level, so no weighting can
  // reorder a move. Measured rather than assumed; see `MESSUNGEN.md`.
  //
  // The one exception is an onboarding level marked `scores: false`; see
  // `levelScores`.
  const score = base.score
    + (cleared && levelScores(base.config, base.level) ? senders.length * base.level : 0);

  const state = {
    ...base,
    placed,
    senders,
    covered,
    uncovered,
    radii,
    score,
    status,
    /** The transmitter in hand, and the two the player is allowed to see. */
    current: status === 'playing' ? senders[0] : null,
    preview: status === 'playing' ? senders.slice(1, 3) : [],
  };
  Object.defineProperty(state, 'toJSON', { value: () => snapshot(state) });
  return Object.freeze(state);
}

/**
 * Starts a run.
 * @param {{seed?: number, config?: object}} [options]
 * @returns {object} frozen state
 */
export function createRun({ seed = 1, config = DEFAULT_RUN } = {}) {
  if (!Number.isInteger(seed)) throw new RangeError(`seed must be an integer, got ${seed}`);
  if (!config.endless && (!Array.isArray(config.levelSizes) || config.levelSizes.length === 0)) {
    throw new RangeError('config.levelSizes must be a non-empty array of node counts');
  }
  if (config.endless && !(config.levelNodes?.start >= 2 && config.senderCurve?.start > 0)) {
    throw new RangeError('an endless config needs levelNodes and senderCurve');
  }
  const { graph, lattice, senders } = buildLevel(seed, 0, config);
  return build(
    { seed, config, level: 1, graph, lattice, score: 0, cleared: [] },
    [],
    senders,
  );
}

/**
 * Places the transmitter in hand on `id`. Final: there is no way back.
 * Placing on an occupied node, an unknown node, or once the run is over is a
 * no-op rather than an error, so a stray tap cannot corrupt a run.
 * @param {object} state
 * @param {*} id
 * @returns {object}
 */
export function place(state, id) {
  if (state.status !== 'playing') return state;
  if (!state.graph.nodes.some((node) => node.id === id)) return state;
  if (state.radii.has(id)) return state;

  const [radius, ...rest] = state.senders;
  const placed = [...state.placed, { id, radius }];
  const next = build(state, placed, rest);
  return next.status === 'playing' || next.status === 'lost'
    ? next
    : { ...next, cleared: [...state.cleared, { level: state.level, left: rest.length }] };
}

/**
 * Moves on to the next level once the current one is clear.
 * @param {object} state
 * @returns {object}
 */
export function advance(state) {
  if (state.status !== 'levelCleared') return state;
  const index = state.level;
  const { graph, lattice, senders } = buildLevel(state.seed, index, state.config);
  return build(
    { ...state, level: state.level + 1, graph, lattice },
    [],
    senders,
  );
}

/**
 * Levels a run has cleared — the number a run is counted by once it is over.
 * Whoever fails in level 10 has cleared 9. The level being played is
 * `state.level`; this is the one before it, unless the last board was cleared
 * too, which only a fixed-length run can end on.
 * @param {object} state
 * @returns {number}
 */
export function levelsCleared(state) {
  return state.cleared.length;
}

/**
 * Plain, JSON-serializable view of a run.
 * @param {object} state
 * @returns {object}
 */
export function snapshot(state) {
  return {
    seed: state.seed,
    /** The level currently being played. */
    level: state.level,
    levels: state.config.endless ? null : state.config.levelSizes.length,
    /** Levels cleared so far — what a finished run is counted by. */
    levelsCleared: levelsCleared(state),
    nodeCount: state.graph.nodes.length,
    lattice: state.lattice,
    status: state.status,
    score: state.score,
    current: state.current,
    preview: [...state.preview],
    sendersLeft: state.senders.length,
    placed: state.placed.map(({ id, radius }) => ({ id: String(id), radius })),
    uncovered: state.uncovered.length,
    cleared: state.cleared.map((entry) => ({ ...entry })),
  };
}
