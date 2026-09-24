import test from 'node:test';
import assert from 'node:assert/strict';

import { coverage } from '../src/graph.js';
import { combinations, findAllSolutions, isUnique } from '../src/solver.js';

const line = (ids) => ({
  nodes: ids.map((id, index) => ({ id, x: index, y: 0 })),
  edges: ids.slice(1).map((id, index) => [ids[index], id]),
});

/** a - b - c - d - e */
const path5 = line(['a', 'b', 'c', 'd', 'e']);
/** a - b - c */
const path3 = line(['a', 'b', 'c']);

/** Two components: a - b   and   c - d - e */
const disconnected = {
  nodes: path5.nodes,
  edges: [
    ['a', 'b'],
    ['c', 'd'],
    ['d', 'e'],
  ],
};

const empty = { nodes: [], edges: [] };

/** Sorts solutions so assertions do not depend on enumeration order. */
const normalize = (solutions) =>
  solutions.map((s) => [...s].sort()).sort((l, r) => String(l).localeCompare(String(r)));

test('findAllSolutions', async (t) => {
  await t.test('finds every covering combination on a path', () => {
    // radius 1: a→{a,b} b→{a,b,c} c→{b,c,d} d→{c,d,e} e→{d,e}
    assert.deepEqual(normalize(findAllSolutions(path5, 2, 1)), [
      ['a', 'd'],
      ['b', 'd'],
      ['b', 'e'],
    ]);
  });

  await t.test('every returned combination really covers the graph', () => {
    for (const solution of findAllSolutions(path5, 2, 1)) {
      assert.equal(solution.length, 2);
      assert.equal(coverage(path5, solution, 1).size, path5.nodes.length);
    }
  });

  await t.test('finds the single centre solution', () => {
    assert.deepEqual(findAllSolutions(path3, 1, 1), [['b']]);
  });

  await t.test('returns [] when the requested count cannot cover the graph', () => {
    assert.deepEqual(findAllSolutions(path5, 1, 1), []);
  });

  await t.test('k = 0: only the full node set covers, so count must match exactly', () => {
    assert.deepEqual(findAllSolutions(path3, 3, 0), [['a', 'b', 'c']]);
    assert.deepEqual(findAllSolutions(path3, 2, 0), []);
    assert.deepEqual(findAllSolutions(path3, 1, 0), []);
  });

  await t.test('count larger than the node count returns []', () => {
    assert.deepEqual(findAllSolutions(path3, 4, 1), []);
    assert.deepEqual(findAllSolutions(path3, 99, 99), []);
    assert.deepEqual(findAllSolutions(empty, 1, 1), []);
  });

  await t.test('count = 0 only solves the empty graph', () => {
    assert.deepEqual(findAllSolutions(empty, 0, 1), [[]]);
    assert.deepEqual(findAllSolutions(empty, 0, 0), [[]]);
    assert.deepEqual(findAllSolutions(path3, 0, 1), []);
  });

  await t.test('rejects negative and non-integer counts', () => {
    assert.deepEqual(findAllSolutions(path3, -1, 1), []);
    assert.deepEqual(findAllSolutions(path3, 1.5, 1), []);
  });

  await t.test('a disconnected graph needs a transmitter per component', () => {
    // {a,b} needs one of a/b; {c,d,e} is only covered from d at radius 1.
    assert.deepEqual(normalize(findAllSolutions(disconnected, 2, 1)), [
      ['a', 'd'],
      ['b', 'd'],
    ]);
    // Even an unlimited radius cannot bridge components.
    assert.deepEqual(findAllSolutions(disconnected, 1, 99), []);
  });

  await t.test('isolated nodes must each carry a transmitter', () => {
    const dust = {
      nodes: [
        { id: 'p', x: 0, y: 0 },
        { id: 'q', x: 5, y: 5 },
      ],
      edges: [],
    };
    assert.deepEqual(findAllSolutions(dust, 2, 3), [['p', 'q']]);
    assert.deepEqual(findAllSolutions(dust, 1, 3), []);
  });

  await t.test('does not mutate the graph', () => {
    const snapshot = JSON.stringify(path5);
    findAllSolutions(path5, 2, 1);
    assert.equal(JSON.stringify(path5), snapshot);
  });

  await t.test('is deterministic across calls', () => {
    assert.deepEqual(findAllSolutions(path5, 2, 1), findAllSolutions(path5, 2, 1));
  });
});

test('isUnique', async (t) => {
  await t.test('true when exactly one solution exists', () => {
    assert.equal(isUnique(path3, 1, 1), true);
    assert.equal(isUnique(path3, 3, 0), true);
  });

  await t.test('false when several solutions exist', () => {
    assert.equal(isUnique(path5, 2, 1), false);
  });

  await t.test('false when no solution exists', () => {
    assert.equal(isUnique(path5, 1, 1), false);
    assert.equal(isUnique(path3, 2, 0), false);
    assert.equal(isUnique(path3, 4, 1), false);
    assert.equal(isUnique(path3, -1, 1), false);
  });

  await t.test('empty graph: the empty transmitter set is the unique solution', () => {
    assert.equal(isUnique(empty, 0, 1), true);
    assert.equal(isUnique(empty, 1, 1), false);
  });

  await t.test('disconnected graph with one forced choice per component', () => {
    assert.equal(isUnique(disconnected, 2, 1), false);
    // At radius 2 either of a/b covers the first component and any of c/d/e
    // covers the second, so there are six solutions.
    assert.equal(isUnique(disconnected, 2, 2), false);
  });

  await t.test('agrees with findAllSolutions', () => {
    const cases = [
      [path5, 2, 1],
      [path3, 1, 1],
      [path3, 3, 0],
      [empty, 0, 1],
      [path5, 1, 1],
      [path3, 4, 1],
    ];
    for (const [graph, count, k] of cases) {
      assert.equal(
        isUnique(graph, count, k),
        findAllSolutions(graph, count, k).length === 1,
        `mismatch for count=${count}, k=${k}`,
      );
    }
  });
});

test('combinations', async (t) => {
  await t.test('yields every combination in lexicographic order', () => {
    assert.deepEqual([...combinations(['a', 'b', 'c'], 2)], [
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ]);
  });

  await t.test('count = 0 yields exactly one empty combination', () => {
    assert.deepEqual([...combinations(['a', 'b'], 0)], [[]]);
    assert.deepEqual([...combinations([], 0)], [[]]);
  });

  await t.test('yields nothing for impossible counts', () => {
    assert.deepEqual([...combinations(['a'], 2)], []);
    assert.deepEqual([...combinations(['a'], -1)], []);
    assert.deepEqual([...combinations(['a'], 1.5)], []);
  });

  await t.test('produces C(n, count) results and accepts any iterable', () => {
    assert.equal([...combinations([1, 2, 3, 4, 5, 6], 3)].length, 20);
    assert.deepEqual([...combinations(new Set(['x', 'y']), 1)], [['x'], ['y']]);
  });
});

test('forbidden nodes in the solver', async (t) => {
  /** a - b - c - d - e at radius 1, with e off limits. */
  const guarded = {
    nodes: ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({
      id,
      x: index,
      y: 0,
      ...(id === 'e' ? { forbidden: true } : {}),
    })),
    edges: [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e']],
  };

  await t.test('only admissible positions are offered', () => {
    // d and e are out: both would irradiate e. a, b and c remain, and the pairs
    // that supply a, b, c and d are {a,c} and {b,c}.
    assert.deepEqual(findAllSolutions(guarded, 2, 1), [
      ['a', 'c'],
      ['b', 'c'],
    ]);
    assert.equal(isUnique(guarded, 2, 1), false);
  });

  await t.test('no solution ever irradiates a forbidden node', () => {
    for (const solution of findAllSolutions(guarded, 2, 1)) {
      assert.equal(coverage(guarded, solution, 1).has('e'), false);
    }
  });

  await t.test('the forbidden node itself need not be supplied', () => {
    const [solution] = findAllSolutions(guarded, 2, 1);
    const covered = coverage(guarded, solution, 1);
    for (const id of ['a', 'b', 'c', 'd']) assert.ok(covered.has(id), `${id} unsupplied`);
  });

  await t.test('a bigger radius narrows the admissible positions', () => {
    // At radius 2 only a and b stay clear of e, which leaves exactly one pair —
    // b alone already supplies a, b, c and d, so the level becomes unique.
    assert.deepEqual(findAllSolutions(guarded, 2, 2), [['a', 'b']]);
    assert.equal(isUnique(guarded, 2, 2), true);
    assert.equal(coverage(guarded, ['a', 'b'], 2).has('e'), false);
  });

  await t.test('count above the number of admissible positions yields nothing', () => {
    assert.deepEqual(findAllSolutions(guarded, 4, 1), []);
  });

  await t.test('the same graph without the flag behaves as before', () => {
    const open = { nodes: guarded.nodes.map(({ forbidden, ...rest }) => rest), edges: guarded.edges };
    assert.deepEqual(normalize(findAllSolutions(open, 2, 1)), [
      ['a', 'd'],
      ['b', 'd'],
      ['b', 'e'],
    ]);
  });
});
