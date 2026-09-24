/**
 * Game state machine. Pure, no DOM, no timers.
 *
 * The state is `{ level, transmitters: Set, marks: Set, history: [] }` plus
 * derived fields that are recomputed on every change. Coverage is never
 * reimplemented here — it always comes from `coverage()` in graph.js.
 *
 * A level is played under one of two rule sets, taken from `level.mode`:
 * `cover` (the default when the field is absent, which is what the levels
 * shipped so far rely on) asks only that every node be supplied, overlap
 * included. `exact` asks for a partition: every node reached by exactly one
 * transmitter, and a node with two signals is a conflict rather than a bonus.
 *
 * A node flagged `forbidden` must not be reached by any signal and does not
 * itself need supplying. Placing a transmitter that irradiates one is allowed —
 * nothing is ever blocked — it simply is not a win, and the offending node is
 * reported in `violations` so the board can show it.
 *
 * `marks` is the player's own notation for "no transmitter can go here". It is
 * purely cosmetic: it never enters the coverage computation or the win check, and the
 * game never tells the player a mark is wrong. Being wrong is part of thinking.
 *
 * Every action returns a new frozen state whose `toJSON()` yields a plain,
 * JSON-serializable snapshot, so moves can be replayed and compared in tests
 * without a browser.
 *
 * Deliberately absent, because this is meant to be a calm puzzle: no timer, no
 * score, no mistake counter, no losing, and no block on placing more
 * transmitters than allowed — going over budget is merely flagged.
 */

import { coverage, forbiddenNodes, requiredNodes, signalCounts } from './graph.js';

/** @typedef {import('./graph.js').Graph} Graph */
/** @typedef {{count: number, k: number, graph: Graph, id?: string, solution?: Array<*>}} Level */

/**
 * Builds the derived state around a set of transmitters.
 * @param {Level} level
 * @param {Set<*>} transmitters
 * @param {Set<*>} marks nodes the player has ruled out by hand
 * @param {Array<{transmitters: Array<*>, marks: Array<*>}>} history oldest first
 * @returns {object} frozen state
 */
function build(level, transmitters, marks, history) {
  const mode = level.mode ?? 'cover';
  const covered = coverage(level.graph, transmitters, level.k);
  const signals = signalCounts(level.graph, transmitters, level.k);
  const forbidden = forbiddenNodes(level.graph);
  const required = requiredNodes(level.graph);
  const uncovered = required.filter((id) => !covered.has(id));
  const violations = new Set([...forbidden].filter((id) => covered.has(id)));
  // Overlap is only a mistake under the exact rules; in cover mode it is fine
  // and this stays empty, so nothing downstream has to know about the mode.
  const conflicts =
    mode === 'exact' ? new Set(required.filter((id) => (signals.get(id) ?? 0) >= 2)) : new Set();

  const state = {
    level,
    mode,
    transmitters,
    marks,
    history,
    covered,
    signals,
    uncovered,
    forbidden,
    /** Nodes lit by two or more transmitters. Must be empty to win in exact mode. */
    conflicts,
    /** Forbidden nodes a signal currently reaches. Must be empty to win. */
    violations,
    /** How many transmitters the player may still place; negative when over budget. */
    remaining: level.count - transmitters.size,
    isOverBudget: transmitters.size > level.count,
    canUndo: history.length > 0,
    /** Won means everything supplied *and* the transmitter budget hit exactly. */
    isWon:
      uncovered.length === 0 &&
      violations.size === 0 &&
      conflicts.size === 0 &&
      transmitters.size === level.count,
  };
  Object.defineProperty(state, 'toJSON', { value: () => snapshot(state) });
  return Object.freeze(state);
}

/**
 * Starts a level with no transmitters placed.
 * @param {Level} level a level object as stored in levels/*.json
 * @returns {object} frozen state
 */
export function createGame(level) {
  if (!level?.graph || !Number.isInteger(level.count) || !Number.isInteger(level.k)) {
    throw new TypeError('createGame: level needs a graph plus integer count and k');
  }
  return build(level, new Set(), new Set(), []);
}

/**
 * Snapshots the current board for the history stack.
 * @param {object} state
 * @returns {{transmitters: Array<*>, marks: Array<*>}}
 */
const previous = (state) => ({ transmitters: [...state.transmitters], marks: [...state.marks] });

/**
 * @returns {boolean} whether the graph has a node with this id that the player
 *   may act on. A forbidden node can never hold a transmitter — its own ball
 *   contains itself — so it is inert.
 */
const known = (state, id) =>
  state.level.graph.nodes.some((node) => node.id === id) && !state.forbidden.has(id);

/**
 * Turns the transmitter at `id` on or off. Unknown ids are ignored, so a stray
 * click can never corrupt the state.
 * @param {object} state
 * @param {*} id
 * @returns {object} the new state, or the unchanged one for an unknown id
 */
export function toggle(state, id) {
  if (!known(state, id)) return state;

  const transmitters = new Set(state.transmitters);
  const marks = new Set(state.marks);
  if (!transmitters.delete(id)) {
    transmitters.add(id);
    marks.delete(id); // placing a transmitter retracts the note against it
  }
  return build(state.level, transmitters, marks, [...state.history, previous(state)]);
}

/**
 * Notes a node as "no transmitter can go here". Purely the player's own
 * bookkeeping — the game neither checks it nor acts on it.
 *
 * Marking a node that currently holds a transmitter lifts that transmitter:
 * asserting both at once would be self-contradictory, and "no, not here after
 * all" is the natural reading of the gesture. Undo covers it either way.
 * @param {object} state
 * @param {*} id
 * @returns {object}
 */
export function mark(state, id) {
  if (!known(state, id) || state.marks.has(id)) return state;

  const transmitters = new Set(state.transmitters);
  transmitters.delete(id);
  return build(state.level, transmitters, new Set(state.marks).add(id), [...state.history, previous(state)]);
}

/**
 * Removes the player's note from a node.
 * @param {object} state
 * @param {*} id
 * @returns {object}
 */
export function unmark(state, id) {
  if (!state.marks.has(id)) return state;

  const marks = new Set(state.marks);
  marks.delete(id);
  return build(state.level, new Set(state.transmitters), marks, [...state.history, previous(state)]);
}

/**
 * Convenience for the one gesture the UI offers: note it, or take the note back.
 * @param {object} state
 * @param {*} id
 * @returns {object}
 */
export function toggleMark(state, id) {
  return state.marks.has(id) ? unmark(state, id) : mark(state, id);
}

/**
 * Steps back one move. Unlimited — there is no undo budget.
 * @param {object} state
 * @returns {object} the previous state, or the unchanged one at the start
 */
export function undo(state) {
  if (state.history.length === 0) return state;
  const restored = state.history.at(-1);
  return build(state.level, new Set(restored.transmitters), new Set(restored.marks), state.history.slice(0, -1));
}

/**
 * Clears the board. Itself undoable, so a misplaced reset is not punished.
 * @param {object} state
 * @returns {object}
 */
export function reset(state) {
  if (state.transmitters.size === 0 && state.marks.size === 0) return state;
  return build(state.level, new Set(), new Set(), [...state.history, previous(state)]);
}

/**
 * Plain, JSON-serializable view of a state. Ids are sorted so two states with
 * the same board compare equal regardless of the order they were placed in.
 * @param {object} state
 * @returns {object}
 */
export function snapshot(state) {
  const sorted = (ids) => [...ids].map(String).sort();
  return {
    level: state.level.id ?? null,
    mode: state.mode,
    count: state.level.count,
    k: state.level.k,
    transmitters: sorted(state.transmitters),
    marks: sorted(state.marks),
    covered: sorted(state.covered),
    uncovered: sorted(state.uncovered),
    violations: sorted(state.violations),
    conflicts: sorted(state.conflicts),
    remaining: state.remaining,
    isOverBudget: state.isOverBudget,
    isWon: state.isWon,
    canUndo: state.canUndo,
    moves: state.history.length,
  };
}
