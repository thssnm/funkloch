import test from 'node:test';
import assert from 'node:assert/strict';

import { createScene, DOT_RATIO, HOP_MS, metricsFor, nearestPair, render } from '../src/render.js';

/**
 * The smallest document the renderer will accept. There is no browser in the
 * test environment, and the parts of the DOM `render.js` touches are few and
 * dull enough to stand in for: attributes, classes, custom properties, text.
 */
function fakeDocument() {
  const element = (name) => {
    const attributes = new Map();
    const classes = new Set();
    const self = {
      name,
      children: [],
      textContent: '',
      dataset: {},
      style: {
        properties: new Map(),
        setProperty(key, value) { this.properties.set(key, value); },
      },
      classList: {
        add: (...names) => names.forEach((n) => classes.add(n)),
        remove: (...names) => names.forEach((n) => classes.delete(n)),
        contains: (n) => classes.has(n),
        toggle: (n, on) => (on ? classes.add(n) : classes.delete(n)),
        values: classes,
      },
      setAttribute: (key, value) => attributes.set(key, String(value)),
      getAttribute: (key) => attributes.get(key) ?? null,
      removeAttribute: (key) => attributes.delete(key),
      append: (...kids) => self.children.push(...kids),
    };
    return self;
  };
  return { createElementNS: (namespace, name) => element(name) };
}

/** a - b - c - d - e, laid out in a line. */
const line5 = {
  nodes: 'abcde'.split('').map((id, i) => ({ id, x: i * 60, y: 0 })),
  edges: [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e']],
};

/** The same, with c impermeable. */
const withBlocker = {
  nodes: line5.nodes.map((node) => (node.id === 'c' ? { ...node, blocked: true } : node)),
  edges: line5.edges,
};

/** A run-shaped state: one transmitter of the given radius on `id`. */
const stateOn = (graph, id, radius, covered) => ({
  radii: new Map([[id, radius]]),
  covered: new Set(covered),
  uncovered: graph.nodes.map((node) => node.id).filter((other) => !covered.includes(other)),
});

test('render marks impermeable nodes', async (t) => {
  const scene = () => createScene({ graph: withBlocker, k: 1 }, { document: fakeDocument() });

  await t.test('gives them a hatched octagon for a body, and a class', () => {
    const built = scene();
    assert.ok(built.nodes.get('c').group.classList.contains('is-blocked'));
    assert.ok(!built.nodes.get('b').group.classList.contains('is-blocked'));
    const plate = built.nodes.get('c').shellPlate;
    assert.equal(plate.name, 'polygon');
    assert.equal(plate.getAttribute('points').split(' ').length, 8, 'eight corners');
    // The hatching is what makes it a different *kind* of node rather than an
    // ordinary one wearing a frame, so it has to actually be there.
    const hatch = built.nodes.get('c').shell.children
      .find((child) => child.getAttribute('class') === 'shell-hatch');
    assert.ok(hatch, 'the octagon is hatched');
    assert.ok(hatch.children.length >= 5, `${hatch.children.length} hatch lines`);
    assert.match(hatch.getAttribute('clip-path'), /^url\(#funkloch-shell-\d+\)$/);
  });

  await t.test('builds no shell where there is nothing to block', () => {
    // An empty group on every ordinary node, so a board without impermeable
    // nodes carries none of this.
    const built = scene();
    assert.equal(built.nodes.get('b').shellPlate, null);
    assert.equal(built.nodes.get('b').shell.children.length, 0);
  });

  await t.test('gives each scene its own clip, so one can be torn down', () => {
    const first = scene();
    const second = scene();
    const clipOf = (built) => built.nodes.get('c').shell.children
      .find((child) => child.getAttribute('class') === 'shell-hatch')
      .getAttribute('clip-path');
    assert.notEqual(clipOf(first), clipOf(second));
  });

  await t.test('leaves them playable, unlike a forbidden node', () => {
    const built = scene();
    assert.equal(built.nodes.get('c').hit.getAttribute('tabindex'), '0');
    assert.equal(built.nodes.get('c').hit.getAttribute('role'), 'button');
  });

  await t.test('says so in the accessible name', () => {
    const built = scene();
    render(built, stateOn(withBlocker, 'a', 2, ['a', 'b', 'c']));
    assert.match(built.nodes.get('c').hit.getAttribute('aria-label'), /undurchlässig/);
    assert.doesNotMatch(built.nodes.get('b').hit.getAttribute('aria-label'), /undurchlässig/);
  });

  await t.test('times the ripple by the walk the signal actually takes', () => {
    // A transmitter on a, radius 4: without the blocker e is four hops out.
    // With it, e can only be lit from the other side, and the ripple must not
    // pretend a signal arrived through c.
    const open = createScene({ graph: line5, k: 1 }, { document: fakeDocument() });
    render(open, stateOn(line5, 'a', 4, ['a', 'b', 'c', 'd', 'e']));
    assert.equal(open.nodes.get('e').group.style.properties.get('--delay'), `${4 * HOP_MS}ms`);

    const fenced = scene();
    render(fenced, stateOn(withBlocker, 'a', 4, ['a', 'b', 'c', 'd', 'e']));
    assert.equal(fenced.nodes.get('c').group.style.properties.get('--delay'), `${2 * HOP_MS}ms`);
    assert.equal(fenced.nodes.get('e').group.style.properties.get('--delay'), '0ms',
      'not reached from a, so no arrival beat');
  });

  await t.test('a board without blockers renders exactly as before', () => {
    const built = createScene({ graph: line5, k: 1 }, { document: fakeDocument() });
    render(built, stateOn(line5, 'b', 1, ['a', 'b', 'c']));
    for (const id of 'abcde') {
      assert.ok(!built.nodes.get(id).group.classList.contains('is-blocked'));
    }
    assert.ok(built.nodes.get('b').group.classList.contains('is-transmitter'));
    assert.equal(built.nodes.get('b').label.textContent, '1');
  });
});

test('node size follows the nearest pair of the board', async (t) => {
  await t.test('the nearest pair is measured over all nodes, not only along edges', () => {
    // c and d stand 30 apart but the edge between them is gone; they are
    // still the closest pair, and the dot has to be sized for them.
    const nodes = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 60, y: 0 }, { id: 'c', x: 0, y: 60 }, { id: 'd', x: 30, y: 60 }];
    assert.equal(nearestPair(nodes), 30);
    assert.equal(nearestPair([{ id: 'a', x: 0, y: 0 }]), 60, 'no pair: the lattice spacing');
    assert.equal(nearestPair([{ id: 'a', x: 1, y: 1 }, { id: 'b', x: 1, y: 1 }]), 60, 'coincident: the same');
  });

  await t.test('every radius scales with the board', () => {
    const wide = line5;
    const tight = { ...line5, nodes: line5.nodes.map((node) => ({ ...node, x: node.x / 2 })) };
    const a = createScene({ graph: wide, k: 1 }, { document: fakeDocument() });
    const b = createScene({ graph: tight, k: 1 }, { document: fakeDocument() });
    assert.equal(a.metrics.dot, 60 * DOT_RATIO);
    assert.equal(b.metrics.dot, 30 * DOT_RATIO);
    for (const key of ['cross', 'blockHalf', 'shell', 'hatchStep']) {
      assert.ok(Math.abs(a.metrics[key] / b.metrics[key] - 2) < 1e-9, `${key} halves with the spacing`);
    }
    assert.equal(a.nodes.get('a').dot.getAttribute('r'), String(Math.round(60 * DOT_RATIO * 100) / 100));
    assert.equal(b.nodes.get('a').dot.getAttribute('r'), String(Math.round(30 * DOT_RATIO * 100) / 100));
  });

  await t.test('bodies never overlap at the nearest pair, in any state', () => {
    // The biggest bodies the stylesheet makes: a transmitter at 2 dots next
    // to a lit node at 1.75, each with half a 2.5 stroke outside the radius.
    for (const nearest of [37, 44, 60, 120]) {
      const { dot } = metricsFor([{ x: 0, y: 0 }, { x: nearest, y: 0 }]);
      const sender = (dot + 1.25) * 2;
      const lit = (dot + 1.25) * 1.75;
      assert.ok(sender + lit < nearest, `sender next to lit node at ${nearest}: ${sender + lit}`);
      assert.ok(sender + sender < nearest, `two senders at ${nearest}: ${2 * sender}`);
    }
  });

  await t.test('the ring stays a ring: clear of its own body, short of the neighbour', () => {
    for (const nearest of [37, 44, 60]) {
      const { dot, ring } = metricsFor([{ x: 0, y: 0 }, { x: nearest, y: 0 }]);
      // Inside: the transmitter body is 2 dots plus half its 2.5 stroke, the
      // ring's own 3 stroke takes 1.5 inwards; what is left must be a gap.
      assert.ok(ring - 1.5 - (dot * 2 + 1.25) >= 2.5, `ring gap at ${nearest}: ${ring - 1.5 - dot * 2 - 1.25}`);
      // Outside: the ring's centre line stays inside the lit neighbour's body
      // line at the nearest pair; only the strokes may meet.
      assert.ok(ring + dot * 1.75 <= nearest, `ring reaches ${ring + dot * 1.75} of ${nearest}`);
    }
  });

  await t.test('the margin grows with the ring, so an outer transmitter fits', () => {
    const scene = createScene({ graph: line5, k: 1 }, { document: fakeDocument(), padding: 0 });
    const [minX] = scene.svg.getAttribute('viewBox').split(' ').map(Number);
    assert.ok(-minX >= scene.metrics.ring, `viewBox starts at ${minX}, ring is ${scene.metrics.ring}`);
  });
});
