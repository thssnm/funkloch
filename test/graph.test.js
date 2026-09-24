import test from 'node:test';
import assert from 'node:assert/strict';

import {
  admissibleCandidates,
  amplifierNodes,
  bfsWithin,
  bfsWithinAmplified,
  bfsWithinBlocked,
  blockedNodes,
  coverage,
  coverageAmplified,
  coverageBlocked,
  forbiddenNodes,
  neighbors,
  requiredNodes,
  validateGraph,
} from '../src/graph.js';

/** Helper: node ids sorted, so BFS order does not make assertions brittle. */
const sorted = (ids) => [...ids].sort();

/** a - b - c - d - e */
const path5 = {
  nodes: [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 1, y: 0 },
    { id: 'c', x: 2, y: 0 },
    { id: 'd', x: 3, y: 0 },
    { id: 'e', x: 4, y: 0 },
  ],
  edges: [
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'd'],
    ['d', 'e'],
  ],
};

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

/** A single node with no edges at all. */
const solo = { nodes: [{ id: 'x', x: 0, y: 0 }], edges: [] };

test('neighbors', async (t) => {
  await t.test('returns the directly connected ids', () => {
    assert.deepEqual(sorted(neighbors(path5, 'b')), ['a', 'c']);
    assert.deepEqual(neighbors(path5, 'a'), ['b']);
    assert.deepEqual(neighbors(path5, 'e'), ['d']);
  });

  await t.test('returns [] for an unknown id', () => {
    assert.deepEqual(neighbors(path5, 'zzz'), []);
  });

  await t.test('returns [] for an isolated node and for an empty graph', () => {
    assert.deepEqual(neighbors(solo, 'x'), []);
    assert.deepEqual(neighbors(empty, 'a'), []);
  });

  await t.test('ignores self-loops, duplicates and edges to unknown nodes', () => {
    const messy = {
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 1, y: 0 },
      ],
      edges: [
        ['a', 'b'],
        ['b', 'a'],
        ['a', 'a'],
        ['a', 'ghost'],
      ],
    };
    assert.deepEqual(neighbors(messy, 'a'), ['b']);
    assert.deepEqual(neighbors(messy, 'b'), ['a']);
  });

  await t.test('does not mutate the graph', () => {
    const snapshot = JSON.stringify(path5);
    neighbors(path5, 'b');
    assert.equal(JSON.stringify(path5), snapshot);
  });
});

test('bfsWithin', async (t) => {
  await t.test('k = 0 yields only the node itself', () => {
    assert.deepEqual(bfsWithin(path5, 'c', 0), ['c']);
    assert.deepEqual(bfsWithin(solo, 'x', 0), ['x']);
  });

  await t.test('k = 1 yields the node and its neighbours', () => {
    assert.deepEqual(sorted(bfsWithin(path5, 'c', 1)), ['b', 'c', 'd']);
    assert.deepEqual(sorted(bfsWithin(path5, 'a', 1)), ['a', 'b']);
  });

  await t.test('k = 2 reaches two edges out', () => {
    assert.deepEqual(sorted(bfsWithin(path5, 'c', 2)), ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(sorted(bfsWithin(path5, 'a', 2)), ['a', 'b', 'c']);
  });

  await t.test('is capped by the component, not by k', () => {
    assert.deepEqual(sorted(bfsWithin(path5, 'a', 99)), ['a', 'b', 'c', 'd', 'e']);
  });

  await t.test('starts with the source node and grows by distance', () => {
    const order = bfsWithin(path5, 'a', 99);
    assert.deepEqual(order, ['a', 'b', 'c', 'd', 'e']);
  });

  await t.test('never leaves the own component', () => {
    assert.deepEqual(sorted(bfsWithin(disconnected, 'a', 99)), ['a', 'b']);
    assert.deepEqual(sorted(bfsWithin(disconnected, 'd', 99)), ['c', 'd', 'e']);
  });

  await t.test('returns [] for unknown ids, empty graphs and negative k', () => {
    assert.deepEqual(bfsWithin(path5, 'zzz', 2), []);
    assert.deepEqual(bfsWithin(empty, 'a', 2), []);
    assert.deepEqual(bfsWithin(path5, 'a', -1), []);
  });

  await t.test('does not mutate the graph', () => {
    const snapshot = JSON.stringify(path5);
    bfsWithin(path5, 'a', 3);
    assert.equal(JSON.stringify(path5), snapshot);
  });
});

test('coverage', async (t) => {
  await t.test('returns a Set', () => {
    assert.ok(coverage(path5, ['a'], 1) instanceof Set);
  });

  await t.test('unions the k-neighbourhoods of all transmitters', () => {
    assert.deepEqual(sorted(coverage(path5, ['b', 'e'], 1)), ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(sorted(coverage(path5, ['a', 'e'], 1)), ['a', 'b', 'd', 'e']);
  });

  await t.test('k = 0 covers exactly the transmitters', () => {
    assert.deepEqual(sorted(coverage(path5, ['a', 'd'], 0)), ['a', 'd']);
  });

  await t.test('no transmitters means nothing is covered', () => {
    assert.equal(coverage(path5, [], 1).size, 0);
    assert.equal(coverage(empty, [], 1).size, 0);
  });

  await t.test('unknown transmitters contribute nothing', () => {
    assert.deepEqual(sorted(coverage(path5, ['ghost'], 2)), []);
    assert.deepEqual(sorted(coverage(path5, ['ghost', 'a'], 1)), ['a', 'b']);
  });

  await t.test('overlapping transmitters are counted once', () => {
    assert.deepEqual(sorted(coverage(path5, ['b', 'b', 'c'], 1)), ['a', 'b', 'c', 'd']);
  });

  await t.test('a disconnected graph needs a transmitter per component', () => {
    assert.deepEqual(sorted(coverage(disconnected, ['a'], 99)), ['a', 'b']);
    assert.deepEqual(
      sorted(coverage(disconnected, ['a', 'd'], 99)),
      ['a', 'b', 'c', 'd', 'e'],
    );
  });

  await t.test('accepts any iterable and does not mutate the graph', () => {
    const snapshot = JSON.stringify(path5);
    assert.deepEqual(sorted(coverage(path5, new Set(['a']), 1)), ['a', 'b']);
    assert.equal(JSON.stringify(path5), snapshot);
  });
});

test('validateGraph', async (t) => {
  await t.test('accepts well-formed graphs and returns them', () => {
    assert.equal(validateGraph(path5), path5);
    assert.equal(validateGraph(empty), empty);
    assert.equal(validateGraph(solo), solo);
  });

  await t.test('rejects a missing or malformed shell', () => {
    assert.throws(() => validateGraph(null), TypeError);
    assert.throws(() => validateGraph({ edges: [] }), /nodes must be an array/);
    assert.throws(() => validateGraph({ nodes: [] }), /edges must be an array/);
  });

  await t.test('rejects duplicate node ids', () => {
    const graph = {
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'a', x: 1, y: 1 },
      ],
      edges: [],
    };
    assert.throws(() => validateGraph(graph), /duplicate node id "a"/);
  });

  await t.test('rejects NaN and other non-finite coordinates', () => {
    const at = (x, y) => ({ nodes: [{ id: 'a', x, y }], edges: [] });
    assert.throws(() => validateGraph(at(Number.NaN, 0)), /non-finite x/);
    assert.throws(() => validateGraph(at(0, Number.NaN)), /non-finite y/);
    assert.throws(() => validateGraph(at(Number.POSITIVE_INFINITY, 0)), /non-finite x/);
    assert.throws(() => validateGraph(at(undefined, 0)), /non-finite x/);
    assert.throws(() => validateGraph({ nodes: [{ x: 0, y: 0 }], edges: [] }), /has no id/);
  });

  await t.test('rejects edges pointing at unknown ids', () => {
    const graph = { nodes: [{ id: 'a', x: 0, y: 0 }], edges: [['a', 'ghost']] };
    assert.throws(() => validateGraph(graph), /unknown node id "ghost"/);
  });

  await t.test('rejects malformed edges', () => {
    const node = [{ id: 'a', x: 0, y: 0 }];
    assert.throws(() => validateGraph({ nodes: node, edges: ['a'] }), /must be a pair/);
    assert.throws(() => validateGraph({ nodes: node, edges: [['a']] }), /must be a pair/);
    assert.throws(() => validateGraph({ nodes: node, edges: [['a', 'a', 'a']] }), /must be a pair/);
  });

  await t.test('names the offending index', () => {
    const graph = {
      nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }],
      edges: [['a', 'b'], ['b', 'ghost']],
    };
    assert.throws(() => validateGraph(graph), /edge at index 1/);
  });
});

test('forbidden nodes', async (t) => {
  /** a - b - c - d - e with e off limits. */
  const guarded = {
    nodes: path5.nodes.map((node) => (node.id === 'e' ? { ...node, forbidden: true } : node)),
    edges: path5.edges,
  };

  await t.test('are listed, and everything else is required', () => {
    assert.deepEqual([...forbiddenNodes(guarded)], ['e']);
    assert.deepEqual(requiredNodes(guarded), ['a', 'b', 'c', 'd']);
  });

  await t.test('a candidate is admissible only if its ball avoids them', () => {
    // B(d) = {c,d,e} and B(e) = {d,e} both touch e.
    assert.deepEqual(admissibleCandidates(guarded, 1), ['a', 'b', 'c']);
    // At radius 2 only a and b stay clear.
    assert.deepEqual(admissibleCandidates(guarded, 2), ['a', 'b']);
    // At radius 0 a node only reaches itself, so everything but e is fine.
    assert.deepEqual(admissibleCandidates(guarded, 0), ['a', 'b', 'c', 'd']);
  });

  await t.test('a graph without the flag is completely unaffected', () => {
    assert.equal(forbiddenNodes(path5).size, 0);
    assert.deepEqual(requiredNodes(path5), ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(admissibleCandidates(path5, 1), ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(admissibleCandidates(empty, 1), []);
  });

  await t.test('every node forbidden leaves nothing to stand on', () => {
    const sealed = { nodes: path5.nodes.map((node) => ({ ...node, forbidden: true })), edges: path5.edges };
    assert.deepEqual(admissibleCandidates(sealed, 1), []);
    assert.deepEqual(requiredNodes(sealed), []);
  });

  await t.test('validateGraph insists the flag is a boolean', () => {
    const bad = { nodes: [{ id: 'a', x: 0, y: 0, forbidden: 'yes' }], edges: [] };
    assert.throws(() => validateGraph(bad), /non-boolean forbidden flag/);
    assert.equal(validateGraph(guarded), guarded);
    // Absent and explicitly false are both fine.
    assert.doesNotThrow(() => validateGraph({ nodes: [{ id: 'a', x: 0, y: 0, forbidden: false }], edges: [] }));
  });
});

// ---------------------------------------------------------------------------
// Impermeable nodes
// ---------------------------------------------------------------------------

/** a - b - c - d - e, with c impermeable. */
const blockedPath = {
  nodes: path5.nodes.map((node) => (node.id === 'c' ? { ...node, blocked: true } : { ...node })),
  edges: path5.edges,
};

test('bfsWithinBlocked', async (t) => {
  await t.test('is bfsWithin on a board without blocked nodes', () => {
    for (const graph of [path5, disconnected, solo]) {
      for (const node of graph.nodes) {
        for (let k = 0; k <= 4; k++) {
          assert.deepEqual(
            bfsWithinBlocked(graph, node.id, k),
            bfsWithin(graph, node.id, k),
            `${node.id} within ${k}`,
          );
        }
      }
    }
  });

  await t.test('lights the blocked node but stops there', () => {
    // From a, radius 3 would reach d without the block; c absorbs the signal.
    assert.deepEqual(sorted(bfsWithinBlocked(blockedPath, 'a', 3)), ['a', 'b', 'c']);
    assert.deepEqual(sorted(bfsWithin(blockedPath, 'a', 3)), ['a', 'b', 'c', 'd']);
    assert.ok(bfsWithinBlocked(blockedPath, 'a', 2).includes('c'), 'c is reached, just not passed');
  });

  await t.test('a transmitter on a blocked node radiates unhindered', () => {
    assert.deepEqual(sorted(bfsWithinBlocked(blockedPath, 'c', 2)), ['a', 'b', 'c', 'd', 'e']);
  });

  await t.test('blocks in both directions', () => {
    assert.deepEqual(sorted(bfsWithinBlocked(blockedPath, 'e', 3)), ['c', 'd', 'e']);
  });

  await t.test('coverageBlocked unions the walks', () => {
    assert.deepEqual(sorted(coverageBlocked(blockedPath, ['a', 'e'], 2)), ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(sorted(coverageBlocked(blockedPath, ['a'], 2)), ['a', 'b', 'c']);
    assert.equal(coverageBlocked(blockedPath, ['ghost'], 2).size, 0);
  });

  await t.test('blockedNodes reads the flag', () => {
    assert.deepEqual(sorted(blockedNodes(blockedPath)), ['c']);
    assert.equal(blockedNodes(path5).size, 0);
  });
});

// ---------------------------------------------------------------------------
// Amplifier nodes
// ---------------------------------------------------------------------------

/** a - b - c - d - e, with a amplifying. */
const amplifierPath = {
  nodes: path5.nodes.map((node) => (node.id === 'a' ? { ...node, amplifier: true } : { ...node })),
  edges: path5.edges,
};

test('bfsWithinAmplified', async (t) => {
  await t.test('is bfsWithinBlocked on a board without amplifiers', () => {
    for (const graph of [path5, disconnected, solo, blockedPath]) {
      for (const node of graph.nodes) {
        for (let k = -1; k <= 4; k++) {
          assert.deepEqual(
            bfsWithinAmplified(graph, node.id, k),
            bfsWithinBlocked(graph, node.id, k),
            `${node.id} within ${k}`,
          );
        }
      }
    }
  });

  await t.test('a transmitter on an amplifier reaches one step further', () => {
    assert.deepEqual(sorted(bfsWithinAmplified(amplifierPath, 'a', 1)), ['a', 'b', 'c']);
    assert.deepEqual(sorted(bfsWithinAmplified(amplifierPath, 'a', 3)), ['a', 'b', 'c', 'd', 'e']);
    // Radius 0 is still a step: the amplifier lends one to whatever it is given.
    assert.deepEqual(sorted(bfsWithinAmplified(amplifierPath, 'a', 0)), ['a', 'b']);
  });

  await t.test('lends nothing to a signal merely passing through', () => {
    // b is not an amplifier, and walking over a buys nothing.
    assert.deepEqual(sorted(bfsWithinAmplified(amplifierPath, 'b', 1)), ['a', 'b', 'c']);
    assert.deepEqual(sorted(bfsWithinAmplified(amplifierPath, 'c', 2)), ['a', 'b', 'c', 'd', 'e']);
  });

  await t.test('the bonus and the blocking are independent', () => {
    // c blocks, a amplifies: radius 2 from a becomes 3 and still stops at c.
    const both = {
      nodes: path5.nodes.map((node) => {
        if (node.id === 'a') return { ...node, amplifier: true };
        if (node.id === 'c') return { ...node, blocked: true };
        return { ...node };
      }),
      edges: path5.edges,
    };
    assert.deepEqual(sorted(bfsWithinAmplified(both, 'a', 2)), ['a', 'b', 'c']);
    // One node carrying both flags radiates unhindered, one step further.
    const same = {
      nodes: path5.nodes.map((node) =>
        (node.id === 'c' ? { ...node, amplifier: true, blocked: true } : { ...node })),
      edges: path5.edges,
    };
    assert.deepEqual(sorted(bfsWithinAmplified(same, 'c', 1)), ['a', 'b', 'c', 'd', 'e']);
  });

  await t.test('a negative radius reaches nothing, bonus or not', () => {
    assert.deepEqual(bfsWithinAmplified(amplifierPath, 'a', -1), []);
    assert.deepEqual(bfsWithinAmplified(amplifierPath, 'ghost', 2), []);
  });

  await t.test('coverageAmplified unions the walks', () => {
    assert.deepEqual(sorted(coverageAmplified(amplifierPath, ['a'], 1)), ['a', 'b', 'c']);
    assert.deepEqual(sorted(coverageAmplified(amplifierPath, ['a', 'e'], 1)), ['a', 'b', 'c', 'd', 'e']);
    assert.equal(coverageAmplified(amplifierPath, ['ghost'], 2).size, 0);
  });

  await t.test('amplifierNodes reads the flag', () => {
    assert.deepEqual(sorted(amplifierNodes(amplifierPath)), ['a']);
    assert.equal(amplifierNodes(path5).size, 0);
  });
});
