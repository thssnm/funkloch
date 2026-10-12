/**
 * The text a finished daily run is shared as: a header with the result, a
 * strip with one mark per level — how many senders were left over there, on a
 * ramp from light to full — ending in a cross where the run died, and the
 * address of the game.
 *
 *   funkl○ch 06.10. — 15 Level geschafft, 77 Punkte
 *   ●●○·· ○○·○○
 *   ·○○·×
 *   funkloch.vercel.app
 *
 * Pure and DOM-free like the rest of the game half: it reads a run state and
 * returns a string, so the page, the tests and the smoke test's expectations
 * can all be checked against the same thing without a browser.
 *
 * Nothing in it gives the day away. Leftover counts say how well a board went,
 * not what it looked like or where anything was placed: two players who both
 * kept two senders on level 3 may have played it entirely differently.
 *
 * Why this strip, measured on 365 daily runs of the planning bot and in a
 * render test across three fonts with collapsed spacing (MESSUNGEN.md,
 * `tools/share-forms.js`):
 *
 * - **One character per level, always.** The block strip of 0.2.0 drew a level
 *   as a group of squares, and in a proportional font the gap between groups
 *   collapses: three squares could be one level with three left or three
 *   levels with one. Square glyphs run together even inside a group. Circles
 *   touch at a point at most and stay countable.
 * - **A picture, not a number.** `·` none left, `○` one, `●` two or more: a
 *   ramp from light to full that reads without a legend. Capping at two costs
 *   9 of 284 different strips over the first six levels, because three or more
 *   left over happens on 4 % of levels.
 * - **Three steps, not four.** No fourth circle (`◉ ◎ ⊙ ⦿`) came from the same
 *   font as `○` and `●` in the render test; drawn larger by a fallback font,
 *   the third step looked fuller than the fourth and the ramp tipped over.
 * - **Every font has them.** Emoji circles rendered as empty boxes; part-filled
 *   circles came without their outline. `·` and `×` are Latin-1, `○` and `●`
 *   held in every font tried.
 *
 * `○` means two things in the text: in the header it is the ring of the
 * wordmark, in the strip one sender left over. Taken knowingly — the one sits
 * inside a word, the other in a row of marks, and the context says which.
 *
 * The digit strip that came before (`form: 'digits'`) stays, in case the
 * decision turns: one digit per level, the exact count.
 *
 * The spaces split the strip into groups of five as a counting aid and carry no
 * meaning, so a chat box that collapses or wraps them changes nothing.
 */

/**
 * Where the game is played, as the last line of every shared result: whoever
 * reads it in a chat can follow it to today's board. Kept here and nowhere
 * else, so moving the game is a change to this line.
 *
 * Without a scheme on purpose: chat apps link a bare host anyway, and it reads
 * as a name rather than as an address. A domain of its own is planned; this is
 * the Vercel host until then.
 */
export const GAME_URL = 'funkloch.vercel.app';

/**
 * The name at the head of every shared result, written the way the wordmark
 * draws it: the o is the ring of a node with no signal. `○` (U+25CB) held in
 * every font of the render test (`tools/share-forms.js --render`), and sits at
 * the height of the lower-case letters around it.
 */
export const GAME_NAME = 'funkl○ch';

/** The ramp, by senders left over: none, one, two or more. */
export const RAMP = ['·', '○', '●'];

/** The level the run ended on. */
export const FAILED = '×';

/**
 * In the digit strip, stands in for ten or more left over, so that a level
 * stays one character. It cannot happen today: from level 2 on the curve deals
 * at most 9 senders and clearing a board takes at least one, so at most 8 are
 * left. `test/share.test.js` holds the curve to that; this is the floor under
 * it if the curve ever moves. The ramp caps at two and needs no such thing.
 */
export const TEN_OR_MORE = '+';

/** Levels to a group, and groups to a line. */
export const GROUP = 5;
export const GROUPS_PER_LINE = 2;

/**
 * The mark of a cleared level with `left` senders over, in either form.
 * @param {number} left
 * @param {'ramp'|'digits'} form
 * @returns {string}
 */
function mark(left, form) {
  if (form === 'digits') return left > 9 ? TEN_OR_MORE : String(left);
  return RAMP[Math.min(left, RAMP.length - 1)];
}

/**
 * A point count with its noun: "1 Punkt", otherwise "Punkte".
 * @param {number} count
 * @returns {string}
 */
export function points(count) {
  return `${count} ${count === 1 ? 'Punkt' : 'Punkte'}`;
}

/**
 * One character per level the strip shows, in order: the mark of each cleared
 * level, then `FAILED` for the level a lost run ended on.
 *
 * An onboarding level that does not score (`firstLevel.scores === false` in the
 * run's config) is left out once cleared: every run clears it with senders to
 * spare, so it would only put the same mark at the front of every strip. It
 * still counts in "N Level geschafft". A run that dies on it shows its cross.
 * @param {object} state a run state from run.js
 * @param {{form?: 'ramp'|'digits'}} [options]
 * @returns {Array<{level: number, mark: string}>}
 */
export function levelMarks(state, { form = 'ramp' } = {}) {
  const skipFirst = state.config?.endless && state.config.firstLevel?.scores === false;
  const marks = state.cleared
    .filter(({ level }) => !(skipFirst && level === 1))
    .map(({ level, left }) => ({ level, mark: mark(left, form) }));
  if (state.status === 'lost') marks.push({ level: state.level, mark: FAILED });
  return marks;
}

/**
 * The shared result.
 * @param {object} state a finished run state from run.js
 * @param {string} day the UTC day it was played, `YYYY-MM-DD`
 * @param {{form?: 'ramp'|'digits'}} [options]
 * @returns {string}
 */
export function shareText(state, day, { form = 'ramp' } = {}) {
  const [, month, date] = day.split('-');
  const header = `${GAME_NAME} ${date}.${month}. — ${state.cleared.length} Level geschafft, `
    + points(state.score);
  const marks = levelMarks(state, { form }).map((entry) => entry.mark);
  const groups = [];
  for (let i = 0; i < marks.length; i += GROUP) groups.push(marks.slice(i, i + GROUP).join(''));
  const lines = [];
  for (let i = 0; i < groups.length; i += GROUPS_PER_LINE) {
    lines.push(groups.slice(i, i + GROUPS_PER_LINE).join(' '));
  }
  return [header, ...lines, GAME_URL].join('\n');
}
