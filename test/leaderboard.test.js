import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aheadFilter, createLeaderboard, dateFilter, formatResult, isValidName, LEADERBOARD,
  LEADERBOARD_KEYS, rankScores, sanitizeName,
} from '../src/leaderboard.js';

const DAY = '2026-11-10';

/**
 * A PocketBase stand-in that understands exactly the requests the module
 * sends: a list for a day sorted -level,-points,created, a count of those
 * ahead of a result, and a create with the unique index on (date, client_id).
 * Every call is logged, so a test can also say that none was made.
 */
function fakePocketBase({ fail = null } = {}) {
  const records = [];
  const calls = [];
  let next = 1;
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body });
    if (fail === 'network') throw new TypeError('Failed to fetch');
    if (fail === 'server') return json(500, { message: 'boom' });
    if (fail === 'garbage') return json(200, { nothing: true });
    if (fail === 'hang') {
      return new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    const parsed = new URL(url);
    if ((init.method ?? 'GET') === 'POST') {
      const body = JSON.parse(init.body);
      if (records.some((r) => r.date === body.date && r.client_id === body.client_id)) {
        return json(400, { data: { client_id: { code: 'validation_not_unique', message: 'not unique' } } });
      }
      const record = { id: `rec${next++}`, ...body };
      records.push(record);
      return json(200, { id: record.id, date: record.date, username: record.username });
    }
    const filter = parsed.searchParams.get('filter') ?? '';
    const day = filter.match(/date>="(\d{4}-\d{2}-\d{2})" && date<"(\d{4}-\d{2}-\d{2})"/);
    const ahead = filter.match(/level>(\d+) \|\| \(level=(\d+) && points>(\d+)\)/);
    let rows = records.filter((r) => day && r.date >= day[1] && r.date < day[2]);
    if (ahead) {
      const [l, p] = [Number(ahead[2]), Number(ahead[3])];
      rows = rows.filter((r) => r.level > l || (r.level === l && r.points > p));
    }
    if (parsed.searchParams.get('sort') === '-level,-points,created') {
      rows = [...rows].sort((a, b) => b.level - a.level || b.points - a.points);
    }
    const perPage = Number(parsed.searchParams.get('perPage'));
    const fields = (parsed.searchParams.get('fields') ?? '').split(',');
    const items = rows.slice(0, perPage)
      .map((r) => Object.fromEntries(fields.map((f) => [f, r[f]])));
    return json(200, { items, totalItems: rows.length, page: 1, perPage });
  };

  const seed = (rows) => {
    for (const row of rows) records.push({ id: `rec${next++}`, client_id: `other${next}`, ...row });
  };
  return { fetch, calls, records, seed };
}

/** localStorage as the page hands it in: strings in, strings out, never throws. */
function memoryStorage() {
  const map = new Map();
  return {
    map,
    get: (key) => (map.has(key) ? map.get(key) : null),
    set: (key, value) => { map.set(key, String(value)); },
    remove: (key) => { map.delete(key); },
  };
}

const setup = (options) => {
  const server = fakePocketBase(options);
  const storage = memoryStorage();
  const board = createLeaderboard({ fetch: server.fetch, storage, crypto: globalThis.crypto });
  return { server, storage, board };
};

/** Twelve results on DAY, all better than 4 levels / 9 points, and one on the day before. */
const twelve = () => Array.from({ length: 12 }, (_, i) => ({
  date: DAY, username: `Spieler ${i + 1}`, level: 25 - i, points: 100 - i,
}));

test('the leaderboard makes no request until asked', async () => {
  const { server, board } = setup();
  assert.equal(board.loadName(), '');
  assert.equal(board.loadEntry(DAY), null);
  assert.equal(server.calls.length, 0, 'creating it and reading what is stored locally sends nothing');
});

test('the top ten', async (t) => {
  const { server, board } = setup();
  server.seed(twelve());
  server.seed([{ date: '2026-11-09', username: 'Gestern', level: 25, points: 999 }]);

  const { scores, total, ownRank } = await board.load(DAY);
  await t.test('are ten, best first, of this day only', () => {
    assert.equal(scores.length, 10);
    assert.equal(total, 12, 'the total counts everyone who entered that day');
    assert.deepEqual(scores.map((s) => s.username), Array.from({ length: 10 }, (_, i) => `Spieler ${i + 1}`));
    assert.ok(!scores.some((s) => s.username === 'Gestern'));
    assert.deepEqual(scores.map((s) => s.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(ownRank, null, 'nobody entered from this device');
  });

  await t.test('are asked for with the one sort and no more than the fields shown', () => {
    const url = new URL(server.calls[0].url);
    assert.equal(url.origin + url.pathname, `${LEADERBOARD.baseUrl}/api/collections/funkloch_daily/records`);
    assert.equal(url.searchParams.get('sort'), '-level,-points,created');
    assert.equal(url.searchParams.get('perPage'), '10');
    assert.equal(url.searchParams.get('fields'), 'id,username,level,points', 'no client_id ever comes back');
  });
});

test('a rank outside the top ten', async () => {
  const { server, board } = setup();
  server.seed(twelve());
  const { entry } = await board.submit(DAY, 'Ich', 4, 9);
  const { scores, total, ownRank } = await board.load(DAY);
  assert.equal(ownRank, 13, 'twelve ahead of it');
  assert.equal(total, 13);
  assert.ok(!scores.some((s) => s.id === entry.id), 'it is not in the list itself');
  assert.equal(server.calls.length, 3, 'one write, the top ten, one count of those ahead');
});

test('a tie on levels goes to the points; a full tie shares the rank', async () => {
  const { server, board } = setup();
  server.seed([
    { date: DAY, username: 'A', level: 12, points: 40 },
    { date: DAY, username: 'B', level: 12, points: 55 },
    { date: DAY, username: 'C', level: 12, points: 40 },
    { date: DAY, username: 'D', level: 13, points: 1 },
  ]);
  const { scores } = await board.load(DAY);
  assert.deepEqual(scores.map((s) => `${s.username}${s.rank}`), ['D1', 'B2', 'A3', 'C3'],
    'more levels first however few points, then points, then equal results share');
  assert.deepEqual(rankScores([
    { level: 5, points: 9 }, { level: 5, points: 9 }, { level: 5, points: 8 }, { level: 4, points: 50 },
  ]).map((s) => s.rank), [1, 1, 3, 4]);
  assert.equal(await board.fetchRank(DAY, 12, 40), 3, 'two ahead: D on levels, B on points');
  assert.equal(await board.fetchRank(DAY, 12, 55), 2);
});

test('entering', async (t) => {
  const { server, storage, board } = setup();

  await t.test('the first time sends name, levels cleared, points and the device id', async () => {
    const result = await board.submit(DAY, '  Ada  ', 4, 9);
    assert.equal(result.status, 'created');
    const sent = JSON.parse(server.calls.at(-1).body);
    assert.deepEqual(Object.keys(sent).sort(), ['client_id', 'date', 'level', 'points', 'username']);
    assert.equal(sent.username, 'Ada', 'trimmed');
    assert.equal(sent.date, DAY);
    assert.equal(sent.level, 4);
    assert.equal(sent.points, 9);
    assert.match(sent.client_id, /^[0-9a-f-]{36}$/);
    assert.equal(storage.get(LEADERBOARD_KEYS.clientId), sent.client_id, 'and keeps the id');
    assert.equal(board.loadName(), 'Ada', 'and the name, for next time');
    assert.deepEqual(board.loadEntry(DAY), { date: DAY, id: result.entry.id, level: 4, points: 9 });
  });

  await t.test('the next day goes under the saved name and the same device id', async () => {
    const result = await board.submit('2026-11-11', board.loadName(), 25, 130);
    assert.equal(result.status, 'created');
    const [first, second] = server.records;
    assert.equal(second.username, 'Ada');
    assert.equal(second.client_id, first.client_id);
    assert.equal(board.loadEntry(DAY), null, 'only the latest entry is remembered');
  });

  await t.test('a second entry on the same day from the same device is refused, not lost', async () => {
    storage.remove(LEADERBOARD_KEYS.entry);
    const result = await board.submit('2026-11-11', 'Ada', 25, 130);
    assert.equal(result.status, 'duplicate');
    assert.equal(result.entry.id, '');
    assert.equal(server.records.length, 2, 'nothing was added');
    assert.deepEqual(board.loadEntry('2026-11-11'), { date: '2026-11-11', id: '', level: 25, points: 130 });
  });

  await t.test('refuses a name it could not show, before asking the server', async () => {
    const before = server.calls.length;
    await assert.rejects(board.submit(DAY, 'A', 1, 1), RangeError);
    await assert.rejects(board.submit(DAY, 'x'.repeat(21), 1, 1), RangeError);
    await assert.rejects(board.submit(DAY, 'Ada', 4.5, 1), RangeError);
    assert.equal(server.calls.length, before);
  });
});

test('an entry the server no longer has is forgotten', async () => {
  const { server, board } = setup();
  const { entry } = await board.submit(DAY, 'Ada', 4, 9);
  server.records.splice(server.records.findIndex((r) => r.id === entry.id), 1);
  const { ownRank, entry: after } = await board.load(DAY);
  assert.equal(ownRank, null);
  assert.equal(after, null);
  assert.equal(board.loadEntry(DAY), null);
});

test('when the server cannot be reached', async (t) => {
  for (const fail of ['network', 'server']) {
    await t.test(`(${fail}) reading and entering fail as rejected promises, and nothing is stored`, async () => {
      const { storage, board } = setup({ fail });
      await assert.rejects(board.load(DAY));
      await assert.rejects(board.submit(DAY, 'Ada', 4, 9));
      assert.equal(board.loadEntry(DAY), null);
      assert.equal(storage.get(LEADERBOARD_KEYS.name), null, 'a failed entry does not save the name');
    });
  }

  await t.test('(garbage) a list that is not one is refused', async () => {
    const { board } = setup({ fail: 'garbage' });
    await assert.rejects(board.load(DAY), /unexpected leaderboard response/);
  });

  await t.test('gives up after the timeout', async (tt) => {
    tt.mock.timers.enable({ apis: ['setTimeout'] });
    const { board } = setup({ fail: 'hang' });
    const pending = assert.rejects(board.load(DAY), { name: 'AbortError' });
    tt.mock.timers.tick(LEADERBOARD.timeoutMs);
    await pending;
  });
});

test('names and numbers', async (t) => {
  await t.test('names lose control and direction characters and are 2 to 20 long', () => {
    assert.equal(sanitizeName('‮Ada\u0007 '), 'Ada');
    assert.ok(isValidName('Al'));
    assert.ok(!isValidName('A'));
    assert.ok(isValidName('x'.repeat(20)));
    assert.ok(!isValidName('x'.repeat(21)));
    assert.ok(isValidName('🙂🙂'), 'counted as seen, not in UTF-16 units');
  });

  await t.test('a result reads "25 Level, 130 Punkte"', () => {
    assert.equal(formatResult(25, 130), '25 Level, 130 Punkte');
    assert.equal(formatResult(4, 1), '4 Level, 1 Punkt');
  });

  await t.test('nothing but a day and whole numbers goes into a filter', () => {
    assert.throws(() => dateFilter('2026-11-10" || true || "'), RangeError);
    assert.throws(() => aheadFilter(DAY, '4) || (1=1', 9), RangeError);
    assert.equal(dateFilter('2026-12-31'), 'date>="2026-12-31" && date<"2027-01-01"');
  });
});
