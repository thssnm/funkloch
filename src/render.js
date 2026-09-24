/**
 * SVG rendering. Draws a game state; contains no game logic whatsoever —
 * coverage, transmitters and the win flag all arrive ready-made in the state.
 *
 * The scene is built once and then only updated, because the signal animation
 * relies on CSS transitions and those need elements that stay put.
 *
 * Readability without colour: a supplied node is not merely tinted, it is also
 * noticeably larger and switches from hollow to solid. A transmitter carries an
 * extra ring around it, one transmitter too many turns that ring dashed, and a
 * node the player has ruled out is dimmed and struck through with a cross.
 * A forbidden node is not a circle at all: it is a filled square with a bar
 * across it, and a node caught by two signals at once wears a pair of
 * concentric rings — two rings for two signals. An impermeable node — one that
 * lights up but hands nothing on — is not a node with something drawn around
 * it: it *is* a different body, an octagon filled with hatching where an
 * ordinary node is a plain circle. A frame would have read as decoration, and
 * decoration on a node reads as “this one is special” rather than “this one is
 * a wall”. Shape and fill both differ, so it survives greyscale twice over.
 *
 * The range preview lives on its own layer — its own class, its own delay
 * variable, its own colour — so it can be switched on and off without touching
 * anything the game state owns. A marked node therefore stays visibly marked
 * while its range is on show.
 */

import { bfsWithin, bfsWithinBlocked, blockedNodes } from './graph.js';

/**
 * Delay the signal picks up per edge travelled. Constant rather than stretched
 * to a fixed total, so the wave moves at the same speed on every level and the
 * first ring always lights within a few frames of the tap — a fixed total would
 * mean a radius-1 level sits still for the whole budget before anything moves.
 * Together with the 140 ms node transition in the stylesheet, a radius-1 wave
 * is complete after about 200 ms and a radius-2 wave after about 260 ms.
 */
export const HOP_MS = 60;

/** Minimum diameter of a tap target, in CSS pixels. */
export const MIN_HIT_PX = 44;

/** Padding around the graph bounds, in user units — room for the widest ring.
 *  A caller that is short of space can ask for less, but not for less than
 *  RING_RADIUS: below that a transmitter on an outer node draws its ring past
 *  the viewBox, and `overflow: visible` then puts it over whatever is next to
 *  the board. See the `padding` option on {@link createScene}. */
const PADDING = 36;

/** Radius of the visible node dot; the covered/transmitter sizes are CSS scales. */
const DOT_RADIUS = 8;

/** Half-length of the arms of the cross drawn on a ruled-out node. */
const CROSS_ARM = DOT_RADIUS * 1.6;

/** Half-width of the square that stands in for a forbidden node. */
const BLOCK_HALF = DOT_RADIUS * 1.5;

/** Circumradius of the octagon that *is* an impermeable node. Close to the
 *  covered dot (1.75x) so the two read as bodies of the same weight rather than
 *  as a small thing inside a big one — an octagon of a given circumradius
 *  covers about a tenth less area than the circle through the same points. */
const SHELL_RADIUS = DOT_RADIUS * 1.75;

/** Spacing of the hatch lines inside that octagon, in user units. Wide enough
 *  that the gaps survive the smallest the board is ever drawn at, tight enough
 *  that the node still reads as filled and not as two stray strokes. */
const HATCH_STEP = 4.2;

/** Radii of the two rings that mark a node lit by more than one transmitter. */
const CLASH_RADII = [DOT_RADIUS * 2.2, DOT_RADIUS * 2.9];

/** Radius of the transmitter ring. Far enough out to read as a separate ring
 *  rather than a thick border, which is what makes a transmitter identifiable
 *  without relying on its colour. */
const RING_RADIUS = DOT_RADIUS * 3.1;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Counter behind the clip-path ids. The hatching of every impermeable node is
 *  clipped to the same octagon, so one clipPath per scene is enough — but two
 *  scenes in one document must not share an id, or tearing one down takes the
 *  other's clip with it. */
let sceneSerial = 0;

/**
 * Corner points of a regular octagon of circumradius `radius`, flat side up.
 * @param {number} radius
 * @returns {string} an SVG `points` list
 */
function octagon(radius) {
  return Array.from({ length: 8 }, (unused, corner) => {
    const angle = ((corner + 0.5) * Math.PI) / 4;
    return `${(radius * Math.cos(angle)).toFixed(2)},${(radius * Math.sin(angle)).toFixed(2)}`;
  }).join(' ');
}

/**
 * Distance from `id` to every node it reaches within `k` edges.
 * Built from repeated `bfsWithin` calls so the traversal rule lives in exactly
 * one place, even though this is only used for animation timing.
 * @param {import('./graph.js').Graph} graph
 * @param {*} id
 * @param {number} k
 * @returns {Map<*, number>}
 */
function distancesFrom(graph, id, k) {
  // Impermeable nodes stop the signal, so they have to stop the ripple too —
  // otherwise a node lit from elsewhere would light on a beat that no signal
  // could have reached it on. Identical to the plain walk on a board without
  // them, which is every board outside the endless mode.
  const walk = blockedNodes(graph).size > 0 ? bfsWithinBlocked : bfsWithin;
  const distance = new Map();
  for (let step = 0; step <= k; step++) {
    for (const reached of walk(graph, id, step)) {
      if (!distance.has(reached)) distance.set(reached, step);
    }
  }
  return distance;
}

/**
 * Builds the SVG for a level. Call once per level, then feed states to
 * {@link render}.
 * @param {{graph: import('./graph.js').Graph, k: number}} level
 * @param {{document?: Document, padding?: number}} [options] `padding` is the
 *        margin around the graph in user units; less of it means the same board
 *        drawn larger in the same box. Clamped to RING_RADIUS from below.
 * @returns {{svg: SVGSVGElement, nodes: Map<*, object>, edges: Array<object>,
 *            level: object, viewBox: {width: number}}}
 */
export function createScene(
  level,
  { document: doc = globalThis.document, padding = PADDING } = {},
) {
  const { nodes, edges } = level.graph;
  const margin = Math.max(padding, RING_RADIUS);
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const minX = Math.min(...xs) - margin;
  const minY = Math.min(...ys) - margin;
  const width = Math.max(...xs) - Math.min(...xs) + 2 * margin;
  const height = Math.max(...ys) - Math.min(...ys) + 2 * margin;

  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
  svg.setAttribute('class', 'board');
  svg.setAttribute('aria-label', 'Spielfeld');

  // Every impermeable node hatches the same octagon, so the clip is cut once
  // and referenced from all of them.
  sceneSerial += 1;
  const clipId = `funkloch-shell-${sceneSerial}`;
  const defs = doc.createElementNS(SVG_NS, 'defs');
  const clip = doc.createElementNS(SVG_NS, 'clipPath');
  clip.setAttribute('id', clipId);
  const clipShape = doc.createElementNS(SVG_NS, 'polygon');
  clipShape.setAttribute('points', octagon(SHELL_RADIUS));
  clip.append(clipShape);
  defs.append(clip);

  const edgeLayer = doc.createElementNS(SVG_NS, 'g');
  edgeLayer.setAttribute('class', 'edges');
  const nodeLayer = doc.createElementNS(SVG_NS, 'g');
  nodeLayer.setAttribute('class', 'nodes');
  svg.append(defs, edgeLayer, nodeLayer);

  const position = new Map(nodes.map((node) => [node.id, node]));
  const edgeElements = edges.map(([a, b]) => {
    const line = doc.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'edge');
    line.setAttribute('x1', position.get(a).x);
    line.setAttribute('y1', position.get(a).y);
    line.setAttribute('x2', position.get(b).x);
    line.setAttribute('y2', position.get(b).y);
    edgeLayer.append(line);
    return { line, a, b };
  });

  const nodeElements = new Map();
  nodes.forEach((node, index) => {
    const group = doc.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'node');
    group.setAttribute('transform', `translate(${node.x} ${node.y})`);
    group.dataset.id = String(node.id);

    // Preview halo, behind everything; only visible while a range is shown.
    const aura = doc.createElementNS(SVG_NS, 'circle');
    aura.setAttribute('class', 'aura');
    aura.setAttribute('r', RING_RADIUS * 1.15);

    const ring = doc.createElementNS(SVG_NS, 'circle');
    ring.setAttribute('class', 'ring');
    ring.setAttribute('r', RING_RADIUS);

    const dot = doc.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('class', 'dot');
    dot.setAttribute('r', DOT_RADIUS);

    // The transmitter's own radius, written on it. With a depot of mixed radii
    // the number is the only thing that tells two transmitters apart.
    const label = doc.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'radius');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'central');
    label.setAttribute('y', 0.5);

    // The body of an impermeable node: signal gets in and stops. It replaces
    // the dot rather than surrounding it — the stylesheet takes the circle away
    // — so the node differs from an ordinary one in what it is made of and not
    // merely in what has been drawn around it. Built only where it is needed:
    // on a board without impermeable nodes this costs nothing at all.
    const shell = doc.createElementNS(SVG_NS, 'g');
    shell.setAttribute('class', 'shell');
    let shellPlate = null;
    if (node.blocked === true) {
      shellPlate = doc.createElementNS(SVG_NS, 'polygon');
      shellPlate.setAttribute('class', 'shell-plate');
      shellPlate.setAttribute('points', octagon(SHELL_RADIUS));

      // Hatching, clipped to the plate. Diagonal lines rather than a pattern
      // fill: a <pattern> resolves `currentColor` against its own place in the
      // defs, not against the node referencing it, so a pattern could not
      // follow the node from unsupplied to supplied to transmitter.
      const hatch = doc.createElementNS(SVG_NS, 'g');
      hatch.setAttribute('class', 'shell-hatch');
      hatch.setAttribute('clip-path', `url(#${clipId})`);
      // Beyond this offset a 45-degree line misses the octagon entirely and
      // would only be drawn to be clipped away.
      const steps = Math.floor((SHELL_RADIUS * Math.SQRT2 * Math.cos(Math.PI / 8)) / HATCH_STEP);
      for (let step = -steps; step <= steps; step++) {
        const offset = step * HATCH_STEP;
        const stroke = doc.createElementNS(SVG_NS, 'line');
        stroke.setAttribute('x1', -SHELL_RADIUS);
        stroke.setAttribute('y1', -SHELL_RADIUS + offset);
        stroke.setAttribute('x2', SHELL_RADIUS);
        stroke.setAttribute('y2', SHELL_RADIUS + offset);
        hatch.append(stroke);
      }
      shell.append(shellPlate, hatch);
    }

    // Two concentric rings: the shape itself says "more than one signal".
    const clash = doc.createElementNS(SVG_NS, 'g');
    clash.setAttribute('class', 'clash');
    for (const radius of CLASH_RADII) {
      const circle = doc.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('r', radius);
      clash.append(circle);
    }

    // A forbidden node is drawn as a square with a bar through it: a different
    // shape and a different glyph from anything else on the board, so it never
    // relies on colour and never reads as a node the player could use.
    const block = doc.createElementNS(SVG_NS, 'g');
    block.setAttribute('class', 'block');
    const plate = doc.createElementNS(SVG_NS, 'rect');
    plate.setAttribute('class', 'plate');
    plate.setAttribute('x', -BLOCK_HALF);
    plate.setAttribute('y', -BLOCK_HALF);
    plate.setAttribute('width', BLOCK_HALF * 2);
    plate.setAttribute('height', BLOCK_HALF * 2);
    plate.setAttribute('rx', 3);
    const bar = doc.createElementNS(SVG_NS, 'rect');
    bar.setAttribute('class', 'bar');
    bar.setAttribute('x', -BLOCK_HALF * 0.62);
    bar.setAttribute('y', -BLOCK_HALF * 0.22);
    bar.setAttribute('width', BLOCK_HALF * 1.24);
    bar.setAttribute('height', BLOCK_HALF * 0.44);
    bar.setAttribute('rx', 1.5);
    block.append(plate, bar);

    // The player's "nothing goes here" cross, drawn above the dot so it stays
    // legible whatever the dot is doing underneath.
    const cross = doc.createElementNS(SVG_NS, 'g');
    cross.setAttribute('class', 'cross');
    for (const [x1, y1, x2, y2] of [
      [-CROSS_ARM, -CROSS_ARM, CROSS_ARM, CROSS_ARM],
      [-CROSS_ARM, CROSS_ARM, CROSS_ARM, -CROSS_ARM],
    ]) {
      const arm = doc.createElementNS(SVG_NS, 'line');
      arm.setAttribute('x1', x1);
      arm.setAttribute('y1', y1);
      arm.setAttribute('x2', x2);
      arm.setAttribute('y2', y2);
      cross.append(arm);
    }

    // Invisible tap target, always at least MIN_HIT_PX across — see fitHitAreas.
    const hit = doc.createElementNS(SVG_NS, 'circle');
    hit.setAttribute('class', 'hit');
    hit.setAttribute('r', MIN_HIT_PX / 2);
    hit.setAttribute('tabindex', '0');
    hit.setAttribute('role', 'button');

    group.append(aura, shell, clash, ring, dot, block, label, cross, hit);
    if (node.blocked === true) group.classList.add('is-blocked');
    if (node.forbidden === true) {
      group.classList.add('is-forbidden');
      // Inert: no transmitter, no note, no focus stop.
      hit.style.pointerEvents = 'none';
      hit.removeAttribute('tabindex');
      hit.removeAttribute('role');
      hit.setAttribute('aria-hidden', 'true');
    }
    nodeLayer.append(group);
    nodeElements.set(node.id, {
      group, aura, shell, shellPlate, clash, ring, dot, block, label, cross, hit,
      index: index + 1,
    });
  });

  return { svg, nodes: nodeElements, edges: edgeElements, level, viewBox: { width } };
}

/**
 * Applies a game state to the scene.
 * @param {object} scene from {@link createScene}
 * @param {object} state from game.js
 */
export function render(scene, state) {
  const { graph } = scene.level;
  const k = scene.level.k;
  // In the depot mode every transmitter carries its own radius; elsewhere they
  // all share the level's k.
  const transmitters = state.transmitters ?? new Set(state.radii?.keys() ?? []);
  const radiusOf = (id) => state.radii?.get(id) ?? k;

  // How far the signal has travelled when it reaches each node: the shortest
  // hop distance to any transmitter. Drives the outward ripple.
  const hops = new Map();
  for (const transmitter of transmitters) {
    for (const [id, distance] of distancesFrom(graph, transmitter, radiusOf(transmitter))) {
      hops.set(id, Math.min(hops.get(id) ?? Infinity, distance));
    }
  }
  const delayOf = (id) => Math.round((hops.get(id) ?? 0) * HOP_MS);

  for (const [id, parts] of scene.nodes) {
    const isCovered = state.covered.has(id);
    const isTransmitter = transmitters.has(id);
    const isMarked = state.marks?.has(id) ?? false;
    const isViolated = state.violations?.has(id) ?? false;
    const isConflict = state.conflicts?.has(id) ?? false;
    parts.group.classList.toggle('is-covered', isCovered);
    parts.group.classList.toggle('is-transmitter', isTransmitter);
    // Boolean(): classList.toggle with an undefined second argument flips the
    // class instead of clearing it, and a state that has no such field at all
    // would otherwise strobe on every render.
    parts.group.classList.toggle('is-over-budget', Boolean(isTransmitter && state.isOverBudget));
    parts.group.classList.toggle('is-marked', isMarked);
    parts.label.textContent = isTransmitter && state.radii?.has(id) ? String(state.radii.get(id)) : '';
    parts.group.classList.toggle('is-violated', isViolated);
    parts.group.classList.toggle('is-conflict', isConflict);
    // Switching off is instant; only the build-up ripples outward.
    parts.group.style.setProperty('--delay', `${isCovered ? delayOf(id) : 0}ms`);

    if (parts.group.classList.contains('is-forbidden')) {
      parts.hit.setAttribute('aria-label',
        `Knoten ${parts.index}, gesperrt${isViolated ? ', wird bestrahlt' : ''}`);
    } else {
      const signals = state.signals?.get(id) ?? 0;
      const role = isConflict
        ? `${signals} Signale`
        : isTransmitter ? 'Sender' : isCovered ? 'versorgt' : 'ohne Versorgung';
      const note = isMarked ? ', ausgeschlossen' : '';
      const opaque = parts.group.classList.contains('is-blocked') ? ', undurchlässig' : '';
      parts.hit.setAttribute('aria-label', `Knoten ${parts.index}, ${role}${opaque}${note}`);
    }
    parts.hit.setAttribute('aria-pressed', String(isTransmitter));
  }

  for (const { line, a, b } of scene.edges) {
    const lit = state.covered.has(a) && state.covered.has(b);
    line.classList.toggle('is-lit', lit);
    line.style.setProperty('--delay', `${lit ? Math.max(delayOf(a), delayOf(b)) : 0}ms`);
  }

  scene.svg.classList.toggle('is-won', Boolean(state.isWon));
}

/**
 * Lights up everything a transmitter at `id` would supply, without placing one.
 * The wave spreads at the same speed as a real signal, so the range reads as an
 * expansion rather than as a finished shape.
 * @param {object} scene
 * @param {*} id
 * @param {number} [radius] defaults to the level's k; the depot mode passes the
 *   radius of the transmitter currently in hand
 */
export function showRange(scene, id, radius = scene.level.k) {
  clearRange(scene);
  const hops = distancesFrom(scene.level.graph, id, radius);
  if (hops.size === 0) return;

  for (const [node, distance] of hops) {
    const parts = scene.nodes.get(node);
    if (!parts) continue;
    parts.group.style.setProperty('--preview-delay', `${distance * HOP_MS}ms`);
    parts.group.classList.add('in-range');
  }
  for (const { line, a, b } of scene.edges) {
    if (!hops.has(a) || !hops.has(b)) continue;
    line.style.setProperty('--preview-delay', `${Math.max(hops.get(a), hops.get(b)) * HOP_MS}ms`);
    line.classList.add('in-range');
  }
  scene.svg.classList.add('is-previewing');
}

/**
 * Takes the range preview back down.
 * @param {object} scene
 */
export function clearRange(scene) {
  for (const parts of scene.nodes.values()) {
    parts.group.classList.remove('in-range');
    parts.group.style.setProperty('--preview-delay', '0ms');
  }
  for (const { line } of scene.edges) {
    line.classList.remove('in-range');
    line.style.setProperty('--preview-delay', '0ms');
  }
  scene.svg.classList.remove('is-previewing');
}

/**
 * Grows the invisible tap targets so they are at least `minPx` across on
 * screen, whatever the SVG happens to be scaled to. Call after layout and on
 * every resize.
 * @param {object} scene
 * @param {number} [minPx]
 */
export function fitHitAreas(scene, minPx = MIN_HIT_PX) {
  const onScreen = scene.svg.getBoundingClientRect().width;
  if (!onScreen) return;
  const scale = onScreen / scene.viewBox.width;
  const radius = Math.max(minPx / 2 / scale, RING_RADIUS);
  for (const parts of scene.nodes.values()) {
    parts.hit.setAttribute('r', radius.toFixed(2));
  }
}
