/**
 * The text a finished daily run is shared as: a header with the result and the
 * address of the game, and nothing else.
 *
 *   funkl○ch 06.10. — 15 Level geschafft, 77 Punkte
 *   https://funkloch.thssn.dev
 *
 * Pure and DOM-free like the rest of the game half: it reads a run state and
 * returns a string, so the page, the tests and the smoke test's expectations
 * can all be checked against the same thing without a browser.
 *
 * Nothing in it gives the day away: how far a run got and what it scored, not
 * what the board looked like or where anything was placed.
 *
 * No strip below the header, on purpose (MESSUNGEN.md, "Die Rest-Grafik fliegt
 * raus"). Three strips of senders left over per level came and went — blocks,
 * digits, a ramp of circles. They told runs apart, but meant nothing to anyone
 * who does not know the rules, and the one quantity that varies per level is
 * zero on 38.5 % of levels. That is the game, not the glyphs: there is no
 * solution path to show and nothing else to draw, so no other strip would do
 * better. A bar of one mark per level was tried as well; it only repeats the
 * count in the header and takes several lines on a long run.
 */

/**
 * Where the game is played, as the last line of every shared result: whoever
 * reads it in a chat can follow it to today's board. Kept here, so moving the
 * game is a change to this line — and to the og:url and og:image tags in
 * index.html, which preview services read without running any script and
 * which therefore cannot import it. test/meta.test.js fails if the two part
 * ways.
 *
 * With the scheme, so that it is a link everywhere. A bare host was linked by
 * most chat apps but not all, and only by guessing from the top-level domain;
 * `https://` takes the guess away. Until 2026-10-12 it was written bare, and
 * before that it was the Vercel host, funkloch.vercel.app.
 */
export const GAME_URL = 'https://funkloch.thssn.dev';

/**
 * The name at the head of every shared result, written the way the wordmark
 * draws it: the o is the ring of a node with no signal. `○` (U+25CB) held in
 * every font of the render test (`tools/share-forms.js --render`), and sits at
 * the height of the lower-case letters around it.
 */
export const GAME_NAME = 'funkl○ch';

/**
 * A point count with its noun: "1 Punkt", otherwise "Punkte".
 * @param {number} count
 * @returns {string}
 */
export function points(count) {
  return `${count} ${count === 1 ? 'Punkt' : 'Punkte'}`;
}

/**
 * The shared result.
 *
 * A run that cleared its last level says so in words, not only in its count:
 *
 *   funkl○ch 06.10. — durchgespielt, alle 25 Level, 143 Punkte
 *   funkl○ch 06.10. — 24 Level geschafft, 98 Punkte
 *
 * "25 Level geschafft" next to "24 Level geschafft" would leave it to the
 * reader to know that 25 is the end; the daily board has had one since
 * 2026-11-10, and whoever reached it should not have to explain that.
 * @param {object} state a finished run state from run.js
 * @param {string} day the day of the board it was played on, `YYYY-MM-DD` (`boardDay`)
 * @returns {string}
 */
export function shareText(state, day) {
  const [, month, date] = day.split('-');
  const result = state.status === 'won'
    ? `durchgespielt, alle ${state.cleared.length} Level`
    : `${state.cleared.length} Level geschafft`;
  const header = `${GAME_NAME} ${date}.${month}. — ${result}, ${points(state.score)}`;
  return [header, GAME_URL].join('\n');
}
