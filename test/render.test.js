import test from 'node:test';
import assert from 'node:assert/strict';

import { createScene, HOP_MS, render } from '../src/render.js';

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

/** A depot-mode-shaped state: one transmitter of the given radius on `id`. */
const stateOn = (graph, id, radius, covered) => ({
  radii: new Map([[id, radius]]),
  covered: new Set(covered),
  uncovered: graph.nodes.map((node) => node.id).filter((other) => !covered.includes(other)),
});

test('render marks impermeable nodes', async (t) => {
  const scene = () => createScene({ graph: withBlocker, k: 1 }, { document: fakeDocument() });

  await t.test('gives them an octagon and a class', () => {
    const built = scene();
    assert.ok(built.nodes.get('c').group.classList.contains('is-blocked'));
    assert.ok(!built.nodes.get('b').group.classList.contains('is-blocked'));
    const shell = built.nodes.get('c').shell;
    assert.equal(shell.name, 'polygon');
    assert.equal(shell.getAttribute('points').split(' ').length, 8, 'eight corners');
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
