/**
 * The daily leaderboard: today's top ten, your own place, and entering your
 * result — straight from the browser to PocketBase, without an SDK.
 *
 * After the leaderboard of Landlines (src/game/leaderboard.ts there), carried
 * over in substance: the same request shapes, the same handling of a second
 * entry on the same device and day, the same "your row below the top ten".
 * What differs is the score: two numbers, `level` and `points`, both higher is
 * better, where Landlines has one time, lower is better.
 *
 * Not part of the pure game half. It talks to a server, waits on a timer and
 * keeps a name and a device id, so it is kept apart from run.js and friends —
 * but it does not touch the DOM either. Everything it reaches outside itself
 * (`fetch`, storage, `crypto`) is handed in by `createLeaderboard`, which is
 * what lets the tests run it against a mocked fetch in Node.
 *
 * Nothing here runs on its own. Creating a leaderboard sends no request; the
 * page asks only when the leaderboard is opened, and writes only when the
 * player presses the button.
 *
 * `level` is the number of levels *cleared*, as `levelsCleared` counts it: 4
 * for a day that ended in level 5, 25 for one played through. The page shows
 * the level a day ended in; that number never goes in here.
 */

import { points } from './share.js';

/** Where the leaderboard lives and how it is read — the one place to change it. */
export const LEADERBOARD = Object.freeze({
  baseUrl: 'https://api.thssn.dev',
  collection: 'funkloch_daily',
  /** Levels decide, points break a tie; both descending. */
  sort: '-level,-points',
  timeoutMs: 5000,
  topCount: 10,
  nameMin: 2,
  nameMax: 20,
});

/** What is kept on the device. The device id never appears on the page. */
export const LEADERBOARD_KEYS = Object.freeze({
  clientId: 'funkloch.geraet',
  name: 'funkloch.rangliste.name',
  entry: 'funkloch.rangliste.eintrag',
});

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
// C0/C1 control characters plus bidi overrides and isolates, which can
// reorder a name on screen.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/**
 * A name as it may be entered and shown: control and direction characters
 * removed, ends trimmed.
 * @param {string} input
 * @returns {string}
 */
export function sanitizeName(input) {
  return String(input).replace(CONTROL_CHARACTERS, '').trim();
}

/**
 * 2 to 20 characters, counted as the eye counts them (code points, so an
 * emoji is one).
 * @param {string} name
 * @returns {boolean}
 */
export function isValidName(name) {
  const length = [...name].length;
  return length >= LEADERBOARD.nameMin && length <= LEADERBOARD.nameMax;
}

/**
 * A row's result as the leaderboard shows it: "25 Level, 130 Punkte".
 * @param {number} level levels cleared
 * @param {number} score points
 * @returns {string}
 */
export function formatResult(level, score) {
  return `${level} Level, ${points(score)}`;
}

/**
 * Ranks a list already sorted by the server: equal level and equal points
 * share a rank, and the next different result takes its place in the list
 * (1, 2, 2, 4).
 * @param {Array<{level: number, points: number}>} scores
 * @returns {Array<object>} the same rows with `rank`
 */
export function rankScores(scores) {
  const ranked = [];
  scores.forEach((score, index) => {
    const previous = ranked[index - 1];
    const tied = previous !== undefined
      && previous.level === score.level && previous.points === score.points;
    ranked.push({ ...score, rank: tied ? previous.rank : index + 1 });
  });
  return ranked;
}

/**
 * The filter for one day. `date` may be a PocketBase date field (stored as
 * "YYYY-MM-DD 00:00:00.000Z") or plain text; a range from the day to the next
 * matches either.
 * @param {string} dateKey `YYYY-MM-DD`, as `boardDay` gives it
 * @returns {string}
 */
export function dateFilter(dateKey) {
  if (!DATE_KEY.test(dateKey)) throw new RangeError(`not a day: ${dateKey}`);
  const next = new Date(Date.parse(`${dateKey}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
  return `date>="${dateKey}" && date<"${next}"`;
}

/** A whole number that may go into a filter. */
function wholeNumber(value, what) {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${what} must be a whole number, got ${value}`);
  return value;
}

/**
 * The filter for everything ahead of a result on a day: more levels, or as
 * many levels and more points. Its count plus one is that result's rank —
 * a tie counts as nobody ahead.
 * @param {string} dateKey
 * @param {number} level
 * @param {number} score
 * @returns {string}
 */
export function aheadFilter(dateKey, level, score) {
  const l = wholeNumber(level, 'level');
  const p = wholeNumber(score, 'points');
  return `(${dateFilter(dateKey)}) && (level>${l} || (level=${l} && points>${p}))`;
}

/** One record from the server as a row, or null for anything else. */
function toScore(value) {
  if (value === null || typeof value !== 'object') return null;
  const { id, username, level, points: score } = value;
  if (typeof id !== 'string' || typeof username !== 'string'
    || !Number.isInteger(level) || !Number.isInteger(score)) return null;
  return { id, username: sanitizeName(username), level, points: score };
}

/** Whether a 400 from PocketBase says "this device already entered today". */
function isUniqueViolation(body) {
  const data = body?.data;
  if (data === null || typeof data !== 'object') return false;
  return Object.values(data).some((field) => field?.code === 'validation_not_unique');
}

/**
 * A v4 UUID. `randomUUID` needs a secure context; `getRandomValues` does not.
 * @param {Crypto} crypto
 */
function randomUuid(crypto) {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The leaderboard, wired to what it needs. Creating it does nothing else: no
 * request, no storage write.
 *
 * @param {object} deps
 * @param {typeof fetch} deps.fetch bound, e.g. `window.fetch.bind(window)`
 * @param {{get(key: string): string|null, set(key: string, value: string): void,
 *          remove(key: string): void}} deps.storage never throws
 * @param {Crypto} deps.crypto for the device id
 */
export function createLeaderboard({ fetch, storage, crypto }) {
  const recordsUrl = `${LEADERBOARD.baseUrl}/api/collections/${LEADERBOARD.collection}/records`;

  const readJson = (key) => {
    try {
      return JSON.parse(storage.get(key) ?? 'null');
    } catch {
      return null;
    }
  };

  /** This device's id, made on first use. Sent with an entry, shown nowhere. */
  const clientId = () => {
    const stored = storage.get(LEADERBOARD_KEYS.clientId);
    if (typeof stored === 'string' && stored.length > 0) return stored;
    const created = randomUuid(crypto);
    storage.set(LEADERBOARD_KEYS.clientId, created);
    return created;
  };

  /** A request that gives up after `timeoutMs`, or when `signal` aborts. */
  const request = async (url, init = {}, signal) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, LEADERBOARD.timeoutMs);
    signal?.addEventListener('abort', abort);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };

  const listUrl = (filter, perPage, sort) => {
    const params = new URLSearchParams({ perPage: String(perPage), filter, fields: 'id,username,level,points' });
    // `created` last: a stable order inside a tie, which shares its rank anyway.
    if (sort) params.set('sort', `${sort},created`);
    return `${recordsUrl}?${params}`;
  };

  const readList = async (url, signal) => {
    const response = await request(url, {}, signal);
    if (!response.ok) throw new Error(`leaderboard request failed: ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body?.items) || typeof body?.totalItems !== 'number') {
      throw new Error('unexpected leaderboard response');
    }
    return body;
  };

  /** The saved name, if it is still a valid one; '' otherwise. */
  const loadName = () => {
    const stored = storage.get(LEADERBOARD_KEYS.name);
    if (typeof stored !== 'string') return '';
    const name = sanitizeName(stored);
    return isValidName(name) ? name : '';
  };

  /** This device's entry for `dateKey`, or null. `id` is '' when the server
   *  refused a second entry and the first one's id is not known here. */
  const loadEntry = (dateKey) => {
    const stored = readJson(LEADERBOARD_KEYS.entry);
    if (stored?.date !== dateKey || typeof stored.id !== 'string'
      || !Number.isInteger(stored.level) || !Number.isInteger(stored.points)) return null;
    return { date: stored.date, id: stored.id, level: stored.level, points: stored.points };
  };

  const clearEntry = () => storage.remove(LEADERBOARD_KEYS.entry);

  /** The day's top ten, best first, and how many entered. */
  const fetchTop = async (dateKey, signal) => {
    const { items, totalItems } = await readList(
      listUrl(`(${dateFilter(dateKey)})`, LEADERBOARD.topCount, LEADERBOARD.sort), signal,
    );
    return { scores: items.map(toScore).filter((score) => score !== null), total: totalItems };
  };

  /** The rank a result has on a day: how many are ahead of it, plus one. */
  const fetchRank = async (dateKey, level, score, signal) => {
    const { totalItems } = await readList(listUrl(aheadFilter(dateKey, level, score), 1), signal);
    return totalItems + 1;
  };

  /**
   * Everything the leaderboard shows for a day: the ranked top ten, the total,
   * and this device's rank if it entered. An entry the server no longer has —
   * the list is shorter than ten and it is not in it — is forgotten here too.
   */
  const load = async (dateKey, signal) => {
    const top = await fetchTop(dateKey, signal);
    const scores = rankScores(top.scores);
    let entry = loadEntry(dateKey);
    let ownRank = null;
    if (entry !== null && entry.id !== '') {
      const listed = scores.find((score) => score.id === entry.id);
      if (listed) ownRank = listed.rank;
      else if (scores.length >= LEADERBOARD.topCount) {
        ownRank = await fetchRank(dateKey, entry.level, entry.points, signal).catch(() => null);
      } else {
        clearEntry();
        entry = null;
      }
    }
    const total = Math.max(top.total, ownRank ?? 0, scores.length);
    return { scores, total, ownRank, entry };
  };

  /**
   * Enters a day's result. Only ever called from a click. A second entry from
   * the same device on the same day is refused by the server's unique index
   * on (date, client_id) and reported as 'duplicate', not as a failure.
   * @param {string} dateKey
   * @param {string} name
   * @param {number} level levels cleared, not the level the day ended in
   * @param {number} score
   * @returns {Promise<{status: 'created'|'duplicate', entry: object}>}
   */
  const submit = async (dateKey, name, level, score) => {
    const username = sanitizeName(name);
    if (!isValidName(username)) throw new RangeError('invalid leaderboard name');
    dateFilter(dateKey);
    wholeNumber(level, 'level');
    wholeNumber(score, 'points');
    const response = await request(recordsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dateKey, username, level, points: score, client_id: clientId() }),
    });
    if (response.status === 400) {
      const body = await response.json().catch(() => null);
      if (isUniqueViolation(body)) {
        const entry = { date: dateKey, id: '', level, points: score };
        storage.set(LEADERBOARD_KEYS.name, username);
        storage.set(LEADERBOARD_KEYS.entry, JSON.stringify(entry));
        return { status: 'duplicate', entry };
      }
    }
    if (!response.ok) throw new Error(`leaderboard submit failed: ${response.status}`);
    const record = await response.json();
    const entry = { date: dateKey, id: typeof record?.id === 'string' ? record.id : '', level, points: score };
    storage.set(LEADERBOARD_KEYS.name, username);
    storage.set(LEADERBOARD_KEYS.entry, JSON.stringify(entry));
    return { status: 'created', entry };
  };

  return { loadName, loadEntry, clearEntry, fetchTop, fetchRank, load, submit };
}
