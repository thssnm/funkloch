import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGame, mark, reset, snapshot, toggle, toggleMark, undo, unmark } from '../src/game.js';

const levelDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'levels');
const loadLevel = (file) => JSON.parse(readFileSync(join(levelDir, file), 'utf8'));
const levelFiles = () => readdirSync(levelDir).filter((name) => /^\d\d\.json$/.test(name)).sort();

/** a - b - c, two transmitters at radius 1: b alone covers everything. */
const tiny = {
  id: 'tiny',
  count: 2,
  k: 1,
  graph: {
    nodes: [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 10, y: 0 },
      { id: 'c', x: 20, y: 0 },
    ],
    edges: [['a', 'b'], ['b', 'c']],
  },
};

/** The board as the player sees it — history deliberately excluded. */
const board = (state) => {
  const { transmitters, marks, covered, uncovered, violations, conflicts, isWon, isOverBudget, remaining } =
    snapshot(state);
  return { transmitters, marks, covered, uncovered, violations, conflicts, isWon, isOverBudget, remaining };
};

test('createGame', async (t) => {
  await t.test('starts empty with nothing supplied', () => {
    const state = createGame(tiny);
    assert.equal(state.transmitters.size, 0);
    assert.equal(state.covered.size, 0);
    assert.deepEqual(state.uncovered, ['a', 'b', 'c']);
    assert.equal(state.remaining, 2);
    assert.equal(state.isWon, false);
    assert.equal(state.isOverBudget, false);
    assert.equal(state.canUndo, false);
  });

  await t.test('rejects a malformed level', () => {
    assert.throws(() => createGame({}), TypeError);
    assert.throws(() => createGame({ graph: tiny.graph, count: 2 }), TypeError);
  });
});

test('toggle', async (t) => {
  await t.test('places and lifts a transmitter, recomputing coverage', () => {
    const placed = toggle(createGame(tiny), 'b');
    assert.deepEqual([...placed.transmitters], ['b']);
    assert.deepEqual([...placed.covered].sort(), ['a', 'b', 'c']);
    assert.deepEqual(placed.uncovered, []);
    assert.equal(placed.remaining, 1);
    assert.equal(placed.isWon, false, 'all covered but the budget is not spent yet');
  });

  await t.test('is idempotent when applied twice', () => {
    const start = createGame(tiny);
    for (const id of ['a', 'b', 'c']) {
      const twice = toggle(toggle(start, id), id);
      assert.deepEqual(board(twice), board(start), `toggling ${id} twice changed the board`);
    }
    // Two moves still happened, which is exactly what makes them undoable.
    assert.equal(toggle(toggle(start, 'b'), 'b').history.length, 2);
  });

  await t.test('is idempotent on top of an existing placement too', () => {
    const base = toggle(toggle(createGame(tiny), 'a'), 'c');
    const twice = toggle(toggle(base, 'b'), 'b');
    assert.deepEqual(board(twice), board(base));
  });

  await t.test('ignores unknown ids', () => {
    const start = createGame(tiny);
    assert.equal(toggle(start, 'ghost'), start);
    assert.equal(toggle(start, undefined), start);
  });

  await t.test('does not mutate the previous state or the level', () => {
    const start = createGame(tiny);
    const levelSnapshot = JSON.stringify(tiny);
    const before = snapshot(start);
    toggle(start, 'b');
    assert.deepEqual(snapshot(start), before);
    assert.equal(start.transmitters.size, 0);
    assert.equal(JSON.stringify(tiny), levelSnapshot);
  });
});

test('undo', async (t) => {
  await t.test('restores exactly the previous state', () => {
    const before = toggle(createGame(tiny), 'a');
    const after = toggle(before, 'c');
    const back = undo(after);
    assert.deepEqual(snapshot(back), snapshot(before));
    assert.deepEqual(back.transmitters, before.transmitters);
    assert.deepEqual(back.covered, before.covered);
    assert.deepEqual(back.history, before.history);
    assert.deepEqual(back, before);
  });

  await t.test('is unlimited', () => {
    const start = createGame(tiny);
    let state = start;
    const ids = ['a', 'b', 'c', 'b', 'a', 'c', 'a', 'b', 'c', 'a', 'b', 'c'];
    for (const id of ids) state = toggle(state, id);
    assert.equal(state.history.length, ids.length);
    for (let i = 0; i < ids.length; i++) state = undo(state);
    assert.deepEqual(snapshot(state), snapshot(start));
    assert.equal(state.canUndo, false);
  });

  await t.test('does nothing at the start of the game', () => {
    const start = createGame(tiny);
    assert.equal(undo(start), start);
  });

  await t.test('steps back through a win', () => {
    const won = toggle(toggle(createGame(tiny), 'a'), 'c');
    assert.equal(won.isWon, true);
    assert.equal(undo(won).isWon, false);
  });
});

test('reset', async (t) => {
  await t.test('clears the board but stays undoable', () => {
    const played = toggle(toggle(createGame(tiny), 'a'), 'b');
    const cleared = reset(played);
    assert.equal(cleared.transmitters.size, 0);
    assert.equal(cleared.covered.size, 0);
    assert.equal(cleared.canUndo, true);
    assert.deepEqual(snapshot(undo(cleared)), snapshot(played));
  });

  await t.test('does nothing on an empty board', () => {
    const start = createGame(tiny);
    assert.equal(reset(start), start);
  });
});

test('winning and over budget', async (t) => {
  await t.test('needs full coverage and exactly count transmitters', () => {
    // b alone covers a, b and c — but the level asks for two transmitters.
    assert.equal(toggle(createGame(tiny), 'b').isWon, false);
    assert.equal(toggle(toggle(createGame(tiny), 'a'), 'c').isWon, true);
  });

  await t.test('allows going over budget but flags it', () => {
    const over = ['a', 'b', 'c'].reduce(toggle, createGame(tiny));
    assert.equal(over.transmitters.size, 3);
    assert.equal(over.isOverBudget, true);
    assert.equal(over.remaining, -1);
    assert.equal(over.uncovered.length, 0);
    assert.equal(over.isWon, false, 'covering everything with too many is not a win');
    // Nothing is blocked: lifting one gets straight back to a win.
    assert.equal(toggle(over, 'b').isWon, true);
  });
});

test('serializable snapshots', async (t) => {
  await t.test('survive JSON and describe the board', () => {
    const state = toggle(createGame(tiny), 'b');
    const json = JSON.parse(JSON.stringify(state));
    assert.deepEqual(json, snapshot(state));
    assert.deepEqual(json, {
      level: 'tiny',
      mode: 'cover',
      count: 2,
      k: 1,
      transmitters: ['b'],
      marks: [],
      covered: ['a', 'b', 'c'],
      uncovered: [],
      violations: [],
      conflicts: [],
      remaining: 1,
      isOverBudget: false,
      isWon: false,
      canUndo: true,
      moves: 1,
    });
  });

  await t.test('let a whole game be replayed without a DOM', () => {
    const moves = ['a', 'b', 'b', 'c'];
    const replay = moves.reduce((state, id) => toggle(state, id), createGame(tiny));
    assert.deepEqual(snapshot(replay).transmitters, ['a', 'c']);
    assert.equal(replay.isWon, true);
  });
});

test('the stored solution wins every built level', () => {
  const files = levelFiles();
  assert.equal(files.length, 30, 'expected 30 built levels — run: node tools/build-levels.js');
  for (const file of files) {
    const level = loadLevel(file);
    const played = level.solution.reduce((state, id) => toggle(state, id), createGame(level));
    assert.equal(played.uncovered.length, 0, `${file}: solution left nodes unsupplied`);
    assert.equal(played.transmitters.size, level.count, `${file}: wrong number of transmitters`);
    assert.equal(played.isOverBudget, false, `${file}: solution is over budget`);
    assert.equal(played.isWon, true, `${file}: replaying the stored solution did not win`);
    // And taking it all back returns to the untouched board.
    let rewound = played;
    for (let i = 0; i < level.solution.length; i++) rewound = undo(rewound);
    assert.deepEqual(snapshot(rewound), snapshot(createGame(level)), `${file}: undo did not rewind`);
  }
});

test('marking nodes', async (t) => {
  await t.test('mark and unmark are recorded without touching the board', () => {
    const marked = mark(createGame(tiny), 'a');
    assert.deepEqual([...marked.marks], ['a']);
    assert.equal(marked.transmitters.size, 0);
    assert.equal(marked.covered.size, 0);
    assert.equal(marked.canUndo, true);

    const lifted = unmark(marked, 'a');
    assert.equal(lifted.marks.size, 0);
    assert.deepEqual(board(lifted), board(createGame(tiny)));
  });

  await t.test('toggleMark goes both ways', () => {
    const start = createGame(tiny);
    const once = toggleMark(start, 'c');
    assert.deepEqual([...once.marks], ['c']);
    assert.deepEqual(board(toggleMark(once, 'c')), board(start));
  });

  await t.test('marks never affect coverage or the win check', () => {
    const won = toggle(toggle(createGame(tiny), 'a'), 'c');
    assert.equal(won.isWon, true);
    // Mark the one node with no transmitter on it — wrongly, as it happens.
    const annotated = mark(won, 'b');
    assert.equal(annotated.isWon, true, 'a note must not unseat a win');
    assert.deepEqual([...annotated.covered].sort(), ['a', 'b', 'c']);
    assert.equal(annotated.remaining, 0);
  });

  await t.test('the game never argues with a wrong mark', () => {
    // 'a' is in the only solution, and marking it is allowed anyway.
    const wrong = mark(createGame(tiny), 'a');
    assert.deepEqual([...wrong.marks], ['a']);
    // And the node stays tappable: placing a transmitter retracts the note.
    const placed = toggle(wrong, 'a');
    assert.deepEqual([...placed.transmitters], ['a']);
    assert.equal(placed.marks.size, 0);
  });

  await t.test('marking a node that holds a transmitter lifts it', () => {
    const placed = toggle(createGame(tiny), 'b');
    const marked = mark(placed, 'b');
    assert.equal(marked.transmitters.size, 0);
    assert.deepEqual([...marked.marks], ['b']);
    assert.equal(marked.covered.size, 0);
  });

  await t.test('ignores unknown ids and redundant calls', () => {
    const start = createGame(tiny);
    assert.equal(mark(start, 'ghost'), start);
    assert.equal(unmark(start, 'a'), start, 'unmarking an unmarked node is a no-op');
    const marked = mark(start, 'a');
    assert.equal(mark(marked, 'a'), marked, 'marking twice is a no-op');
  });

  await t.test('does not mutate the previous state', () => {
    const start = createGame(tiny);
    const before = snapshot(start);
    mark(start, 'a');
    assert.deepEqual(snapshot(start), before);
    assert.equal(start.marks.size, 0);
  });
});

test('undo over marked states', async (t) => {
  await t.test('restores exactly the previous state', () => {
    const before = mark(toggle(createGame(tiny), 'a'), 'c');
    const after = unmark(before, 'c');
    assert.deepEqual(undo(after), before);
    assert.deepEqual(snapshot(undo(after)), snapshot(before));
  });

  await t.test('rewinds an interleaved run of moves and notes', () => {
    const start = createGame(tiny);
    const moves = [
      (s) => mark(s, 'a'),
      (s) => toggle(s, 'b'),
      (s) => toggleMark(s, 'c'),
      (s) => mark(s, 'b'), // lifts the transmitter placed above
      (s) => toggle(s, 'a'), // retracts the note on a
      (s) => unmark(s, 'c'),
      (s) => toggle(s, 'c'),
    ];
    let state = moves.reduce((acc, move) => move(acc), start);
    assert.equal(state.history.length, moves.length);
    assert.equal(state.isWon, true, 'a and c placed, everything supplied');
    assert.deepEqual([...state.marks].sort(), ['b']);

    for (let i = 0; i < moves.length; i++) state = undo(state);
    assert.deepEqual(snapshot(state), snapshot(start));
    assert.equal(state.canUndo, false);
  });

  await t.test('undo steps back through a mark that lifted a transmitter', () => {
    const placed = toggle(createGame(tiny), 'b');
    const marked = mark(placed, 'b');
    assert.deepEqual(snapshot(undo(marked)), snapshot(placed));
  });
});

test('reset clears notes as well', async (t) => {
  await t.test('and stays undoable', () => {
    const played = mark(toggle(createGame(tiny), 'a'), 'c');
    const cleared = reset(played);
    assert.equal(cleared.transmitters.size, 0);
    assert.equal(cleared.marks.size, 0);
    assert.deepEqual(snapshot(undo(cleared)), snapshot(played));
  });

  await t.test('does nothing on a board with neither', () => {
    const start = createGame(tiny);
    assert.equal(reset(start), start);
    // But a board with only notes is worth clearing.
    const noted = mark(start, 'a');
    assert.notEqual(reset(noted), noted);
  });
});

test('the stored solution still wins with notes on the board', () => {
  for (const file of levelFiles()) {
    const level = loadLevel(file);
    const spare = level.graph.nodes.find((node) => !level.solution.includes(node.id));
    let state = mark(createGame(level), spare.id);
    for (const id of level.solution) state = toggle(state, id);
    assert.equal(state.isWon, true, `${file}: a note blocked the win`);
    assert.deepEqual([...state.marks], [spare.id], `${file}: the note did not survive`);
  }
});

test('forbidden nodes', async (t) => {
  /**
   * a - b - c - d - e, radius 1, two transmitters, and e must stay dark.
   * Admissible positions are therefore a, b and c: a transmitter on d or e
   * would reach e. {a, c} is the only pair that supplies a, b, c and d.
   */
  const withForbidden = {
    id: 'guarded',
    count: 2,
    k: 1,
    graph: {
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 10, y: 0 },
        { id: 'c', x: 20, y: 0 },
        { id: 'd', x: 30, y: 0 },
        { id: 'e', x: 40, y: 0, forbidden: true },
      ],
      edges: [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e']],
    },
  };

  await t.test('a forbidden node does not have to be supplied', () => {
    const state = toggle(toggle(createGame(withForbidden), 'a'), 'c');
    assert.deepEqual(state.uncovered, [], 'a, b, c and d are all supplied');
    assert.equal(state.covered.has('e'), false);
    assert.equal(state.isWon, true);
  });

  await t.test('irradiating a forbidden node is allowed but is not a win', () => {
    // d reaches e, which is forbidden. Nothing blocks the move.
    const state = toggle(toggle(createGame(withForbidden), 'a'), 'd');
    assert.deepEqual([...state.transmitters].sort(), ['a', 'd']);
    assert.deepEqual([...state.violations], ['e']);
    assert.equal(state.isWon, false, 'a violated node must not count as a win');
    // And it is undoable like anything else.
    assert.equal(undo(state).violations.size, 0);
  });

  await t.test('a forbidden node is inert', () => {
    const start = createGame(withForbidden);
    assert.equal(toggle(start, 'e'), start, 'cannot hold a transmitter');
    assert.equal(mark(start, 'e'), start, 'nothing to note on it either');
    assert.deepEqual([...start.forbidden], ['e']);
  });

  await t.test('the win still needs the full budget', () => {
    // b alone supplies a, b and c but leaves d dark; c alone leaves a dark.
    assert.equal(toggle(createGame(withForbidden), 'b').isWon, false);
  });

  await t.test('levels without the flag behave exactly as before', () => {
    const state = createGame(tiny);
    assert.equal(state.forbidden.size, 0);
    assert.equal(state.violations.size, 0);
    assert.deepEqual(state.uncovered, ['a', 'b', 'c']);
    assert.equal(toggle(toggle(state, 'a'), 'c').isWon, true);
  });
});
