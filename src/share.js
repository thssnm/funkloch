/**
 * The text a finished daily run is shared as: a header with the result, and a
 * picture of how it went — one mark per level played, as many blocks as
 * senders were left over there, and a cross where the run ended.
 *
 * Pure and DOM-free like the rest of the game half: it reads a run state and
 * returns a string, so the page, the tests and the smoke test's expectations
 * can all be checked against the same thing without a browser.
 *
 * The last line is the address of the game, `GAME_URL`.
 *
 * Nothing in it gives the day away. Leftover counts say how well a board went,
 * not what it looked like or where anything was placed: two players who both
 * kept two senders on level 3 may have played it entirely differently.
 *
 * The characters are chosen to survive being pasted anywhere:
 *
 * - `■` (U+25A0) and not `█` (U+2588): full blocks touch and run together into
 *   one bar, so "three left" has to be measured rather than counted; squares
 *   keep a gap. And not an emoji square like 🟩: emoji carry the line-break
 *   class ID, which allows a break between *every* pair, so a row of them can
 *   wrap in the middle of a level. U+25A0 is in WGL4 and in every system font
 *   that matters, and it breaks like a letter.
 * - `·` (U+00B7) for a level cleared with nothing to spare, and `×` (U+00D7)
 *   for the one the run died on. Both Latin-1, so there is no font they are
 *   missing from.
 * - Inside a row and between the groups of the one-line form, the spaces are
 *   no-break spaces (U+00A0), so a chat box wraps a long result between words
 *   of the header, never through a level.
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

/** One sender left over on a level. */
export const BLOCK = '■';
/** A level cleared with nothing to spare. */
export const NOTHING_LEFT = '·';
/** The level the run ended on. */
export const FAILED = '×';

const NBSP = ' ';
/** As wide as a digit wherever digits are tabular, so level numbers line up. */
const FIGURE_SPACE = ' ';

/**
 * A point count with its noun: "1 Punkt", otherwise "Punkte".
 * @param {number} count
 * @returns {string}
 */
export function points(count) {
  return `${count} ${count === 1 ? 'Punkt' : 'Punkte'}`;
}

/**
 * The marks of every level a run has played, in order: blocks for the leftover
 * senders of a cleared level (or `NOTHING_LEFT` for none), then `FAILED` for the
 * level a lost run ended on.
 * @param {object} state a run state from run.js
 * @returns {Array<{level: number, mark: string}>}
 */
export function levelMarks(state) {
  const marks = state.cleared.map(({ level, left }) => ({
    level,
    mark: left > 0 ? BLOCK.repeat(left) : NOTHING_LEFT,
  }));
  if (state.status === 'lost') marks.push({ level: state.level, mark: FAILED });
  return marks;
}

/**
 * The shared result.
 *
 * `rows` is the long form, one line per level with its number in front. It
 * reads well for a short run and badly for a long one: a run that reaches level
 * 15 is fifteen lines, more than a chat message should be. `line` is the
 * dense form — the marks in order, separated by a space, no numbers; the
 * position *is* the number, and the header says how many there are.
 *
 * Ten levels to a line, not all of them on one. The spaces do not break, so a
 * single line cannot be wrapped by a chat box, and played by the planning bot a
 * 33-level daily run is 68 characters wide — twice a phone's chat bubble. At
 * ten a line no line passes about 30 characters, a run of ten or fewer is the
 * plain single line, and the levels can still be counted off in tens.
 * @param {object} state a finished run state from run.js
 * @param {string} day the UTC day it was played, `YYYY-MM-DD`
 * @param {{form?: 'line'|'rows'}} [options]
 * @returns {string}
 */
export function shareText(state, day, { form = 'line' } = {}) {
  const [, month, date] = day.split('-');
  const header = `funkloch ${date}.${month}. — ${state.cleared.length} Level geschafft, `
    + points(state.score);
  const marks = levelMarks(state);
  if (form === 'rows') {
    const width = String(marks.at(-1)?.level ?? 1).length;
    const rows = marks.map(({ level, mark }) =>
      `${String(level).padStart(width, FIGURE_SPACE)}${NBSP}${mark}`);
    return [header, ...rows, GAME_URL].join('\n');
  }
  const lines = [];
  for (let i = 0; i < marks.length; i += LEVELS_PER_LINE) {
    lines.push(marks.slice(i, i + LEVELS_PER_LINE).map(({ mark }) => mark).join(NBSP));
  }
  return [header, ...lines, GAME_URL].join('\n');
}

/** How many levels the one-line form puts on a line before starting the next. */
export const LEVELS_PER_LINE = 10;
