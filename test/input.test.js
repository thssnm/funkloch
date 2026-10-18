import test from 'node:test';
import assert from 'node:assert/strict';

import { attachInput, nearestWithin } from '../src/input.js';
import { createScene } from '../src/render.js';
import { generateCandidate, mulberry32 } from '../src/generator.js';

/**
 * The smallest document the input layer will accept: the fake from
 * render.test.js plus listeners on the root and a screen transform of one, so
 * client coordinates are user units.
 */
function fakeDocument() {
  const element = (name) => {
    const attributes = new Map();
    const classes = new Set();
    const listeners = new Map();
    const self = {
      name,
      children: [],
      textContent: '',
      dataset: {},
      style: {},
      classList: {
        add: (...names) => names.forEach((n) => classes.add(n)),
        remove: (...names) => names.forEach((n) => classes.delete(n)),
        contains: (n) => classes.has(n),
        toggle: (n, on) => (on ? classes.add(n) : classes.delete(n)),
      },
      setAttribute: (key, value) => attributes.set(key, String(value)),
      getAttribute: (key) => attributes.get(key) ?? null,
      removeAttribute: (key) => attributes.delete(key),
      append: (...kids) => self.children.push(...kids),
      addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
      removeEventListener: (type, fn) => listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn)),
      dispatch: (type, event) => (listeners.get(type) ?? []).forEach((fn) => fn(event)),
      getScreenCTM: () => ({ inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) }),
    };
    return self;
  };
  return { createElementNS: (namespace, name) => element(name) };
}

/** A pointer event at a point, with `target` claiming to be inside `group`. */
const pointer = (x, y, group, pointerType = 'touch') => ({
  clientX: x,
  clientY: y,
  pointerType,
  button: 0,
  preventDefault() {},
  target: { closest: (selector) => (selector === '.node' ? group : null) },
});

/** A dense board, the kind the proximity rule exists for. */
function denseBoard(nodeCount = 60) {
  const rng = mulberry32(5);
  for (let attempt = 0; attempt < 100; attempt++) {
    const graph = generateCandidate({ nodeCount, lattice: 'hex', minDegree: 2, edgeDeleteRatio: 0.2, k: 1, rng });
    if (graph !== null) return graph;
  }
  throw new Error('no dense board');
}

test('a tap goes to the nearest node, not the one drawn last', async (t) => {
  await t.test('nearestWithin picks the nearest centre among those in reach', () => {
    const nodes = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 30, y: 0 }, { id: 'c', x: 200, y: 0 }];
    const reach = () => 22;
    assert.equal(nearestWithin(nodes, { x: 12, y: 0 }, reach).id, 'a', 'inside both, nearer to a');
    assert.equal(nearestWithin(nodes, { x: 18, y: 0 }, reach).id, 'b', 'inside both, nearer to b');
    assert.equal(nearestWithin(nodes, { x: 15, y: 0 }, reach).id, 'a', 'a dead heat goes to the first');
    assert.equal(nearestWithin(nodes, { x: 100, y: 0 }, reach), null, 'out of everyone\'s reach');
    assert.equal(nearestWithin(nodes, { x: 21, y: 21 }, reach), null, 'just outside, on the diagonal');
    assert.equal(nearestWithin([], { x: 0, y: 0 }, reach), null, 'no nodes');
  });

  await t.test('on the densest board the hit is always the nearest node in reach', () => {
    const graph = denseBoard(60);
    // 36 units is what a 44px target comes to on a 60-node board drawn at
    // about 0.6px per unit: wider than half the nearest pair, so the targets
    // overlap the way they do on a phone.
    const reach = () => 36;
    const brute = (point) => {
      let best = null;
      for (const node of graph.nodes) {
        const d = Math.hypot(node.x - point.x, node.y - point.y);
        if (d <= 36 && (best === null || d < best.d)) best = { id: node.id, d };
      }
      return best?.id ?? null;
    };
    const rng = mulberry32(11);
    const xs = graph.nodes.map((n) => n.x); const ys = graph.nodes.map((n) => n.y);
    const [minX, maxX] = [Math.min(...xs) - 40, Math.max(...xs) + 40];
    const [minY, maxY] = [Math.min(...ys) - 40, Math.max(...ys) + 40];
    let contested = 0;
    for (let i = 0; i < 5000; i++) {
      const point = { x: minX + rng() * (maxX - minX), y: minY + rng() * (maxY - minY) };
      const inReach = graph.nodes.filter((n) => Math.hypot(n.x - point.x, n.y - point.y) <= 36).length;
      if (inReach > 1) contested++;
      assert.equal(nearestWithin(graph.nodes, point, reach)?.id ?? null, brute(point));
    }
    assert.ok(contested > 500, `the sample has to be dense enough to contest: ${contested} points in more than one reach`);
  });

  await t.test('attachInput resolves the press and the release by proximity', () => {
    // a and b stand 30 apart with 22 of reach each: the space between them
    // belongs to both targets. The event claims b as its element; the point is
    // nearer a; a has to get the tap.
    const graph = { nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 30, y: 0 }], edges: [['a', 'b']] };
    const scene = createScene({ graph, k: 1 }, { document: fakeDocument() });
    const toggled = [];
    attachInput(scene, { onToggle: (id) => toggled.push(id), onPreview() {}, onPreviewEnd() {} });
    const b = scene.nodes.get('b').group;

    scene.svg.dispatch('pointerdown', pointer(12, 0, b));
    assert.ok(scene.nodes.get('a').group.classList.contains('is-pressed'), 'a shows the press');
    assert.ok(!b.classList.contains('is-pressed'), 'b does not');
    scene.svg.dispatch('pointerup', pointer(12, 0, b));
    assert.deepEqual(toggled, ['a']);

    // Released nearer the other node: a press that changed its mind does nothing.
    scene.svg.dispatch('pointerdown', pointer(12, 0, b));
    scene.svg.dispatch('pointerup', pointer(18, 0, b));
    assert.deepEqual(toggled, ['a']);

    // Out of reach of both: nothing starts.
    scene.svg.dispatch('pointerdown', pointer(15, 30, b));
    scene.svg.dispatch('pointerup', pointer(15, 30, b));
    assert.deepEqual(toggled, ['a']);
  });

  await t.test('a forbidden node shadows its spot instead of handing it on', () => {
    const graph = {
      nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 30, y: 0, forbidden: true }],
      edges: [['a', 'b']],
    };
    const scene = createScene({ graph, k: 1 }, { document: fakeDocument() });
    const toggled = [];
    attachInput(scene, { onToggle: (id) => toggled.push(id), onPreview() {}, onPreviewEnd() {} });
    scene.svg.dispatch('pointerdown', pointer(28, 0, null));
    scene.svg.dispatch('pointerup', pointer(28, 0, null));
    assert.deepEqual(toggled, [], 'nearest is forbidden: nobody\'s tap');
    scene.svg.dispatch('pointerdown', pointer(10, 0, null));
    scene.svg.dispatch('pointerup', pointer(10, 0, null));
    assert.deepEqual(toggled, ['a']);
  });

  await t.test('mouse hover previews the node a click would take', () => {
    const graph = { nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 30, y: 0 }], edges: [['a', 'b']] };
    const scene = createScene({ graph, k: 1 }, { document: fakeDocument() });
    const log = [];
    attachInput(scene, {
      onToggle() {},
      onPreview: (id) => log.push(`on ${id}`),
      onPreviewEnd: () => log.push('off'),
    });
    const b = scene.nodes.get('b').group;
    scene.svg.dispatch('pointerover', pointer(12, 0, b, 'mouse'));
    scene.svg.dispatch('pointermove', pointer(13, 0, b, 'mouse'));
    scene.svg.dispatch('pointermove', pointer(18, 0, b, 'mouse'));
    scene.svg.dispatch('pointermove', pointer(15, 40, b, 'mouse'));
    scene.svg.dispatch('pointermove', pointer(2, 0, b, 'mouse'));
    scene.svg.dispatch('pointerleave', {});
    assert.deepEqual(log, ['on a', 'off', 'on b', 'off', 'on a', 'off']);
  });
});
