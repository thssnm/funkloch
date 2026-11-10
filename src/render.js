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
 * to a fixed total, so the wave moves at the same speed on every board and the
 * first ring always lights within a few frames of the tap — a fixed total would
 * mean a radius-1 board sits still for the whole budget before anything moves.
 * Together with the 140 ms node transition in the stylesheet, a radius-1 wave
 * is complete after about 200 ms and a radius-2 wave after about 260 ms.
 */
export const HOP_MS = 60;

/** Minimum diameter of a tap target, in CSS pixels. */
export const MIN_HIT_PX = 44;

/** Padding around the graph bounds, in user units — room for the widest ring.
 *  A caller that is short of space can ask for less, but not for less than
 *  the board's transmitter ring: below that a transmitter on an outer node
 *  draws its ring past the viewBox, and `overflow: visible` then puts it over
 *  whatever is next to the board. See the `padding` option on
 *  {@link createScene}. */
const PADDING = 36;

/** Radius of the visible node dot as a share of the board's nearest pair of
 *  nodes; the covered/transmitter sizes are CSS scales on top of it (1.75x
 *  and 2x). Derived per board rather than fixed, so a board whose nodes stand
 *  further apart gets bigger nodes, and a tight one gets nodes as big as they
 *  can be without touching.
 *
 *  Until 2026-10-18 the dot was a fixed 8 units. The generator lays every
 *  board on a 60-unit lattice with jitter, so the nearest pair sits at 37-47
 *  units whatever the node count (200 bot runs, 16 000 boards: median 44,
 *  p10 42-44, min 37.3), and 8 units was a ratio of 0.17-0.21 in disguise.
 *  What sets the ceiling is not the dot but the bodies the CSS makes of it:
 *  a lit node is 1.75 dots, a transmitter 2, each plus a 2.5 stroke, and the
 *  two have to fit between the nearest pair with a gap left over. Measured
 *  on seed 5 at 390 and 360px wide, the boards with 9 / 30 / 50 nodes draw
 *  at 1.53 / 0.79 / 0.61 px per unit (1.40 / 0.72 / 0.56 at 360):
 *
 *    ratio   dot px (9/30/50)   worst gap lit–sender   worst gap two senders
 *    0.18*   12.2 / 6.3 / 4.9   14.3 / 6.3 / 5.3 px     10.8 / 4.5 / 3.9 px
 *    0.20    13.5 / 6.7 / 5.3    9.7 / 4.7 / 3.8 px      5.8 / 2.8 / 2.3 px
 *    0.22    14.8 / 7.4 / 5.9    4.6 / 2.2 / 1.8 px      0.4 / 0.1 / 0.1 px
 *    0.24    15.8 / 8.0 / 6.3   -0.4 / -0.3 / -0.2 px   -4.8 / -2.6 / -2.0 px
 *    * the old fixed 8 units on these boards
 *
 *  "Worst gap" is at the board's nearest pair in the state that fills it
 *  most. 0.22 lets two adjacent transmitters touch; 0.24 overlaps. 0.20 is
 *  the last step that keeps a gap in every state on a 360px phone (2.1px on
 *  the 50-node board), and it costs the edges little: with every node lit
 *  the median free edge on the 50-node board goes from 23.2 to 21.7px, and
 *  the share of edges with under 8px of free line from 4 to 7 % (0.22: 12 %,
 *  0.24: 16 %). The structure stays readable; it was the overlap that bit
 *  first, not the edges. A bigger step would have to come out of the 1.75x
 *  and 2x, not out of this number. */
export const DOT_RATIO = 0.20;

/** What a board's nodes stand on when it has no pair to measure: a single
 *  node, or two on the same spot. The generator's default lattice spacing. */
const FALLBACK_SPACING = 60;

/**
 * Distance between the two closest nodes of a board, over all pairs and not
 * only along edges: overlap is geometry, and a thinned-out edge does not move
 * the nodes apart. On the lattices the generator draws the closest pair is an
 * adjacent pair anyway.
 * @param {Array<{x: number, y: number}>} nodes
 * @returns {number} in user units; FALLBACK_SPACING when there is no pair
 */
export function nearestPair(nodes) {
  let nearest = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
      if (d < nearest) nearest = d;
    }
  }
  return Number.isFinite(nearest) && nearest > 0 ? nearest : FALLBACK_SPACING;
}

/**
 * Every radius of the drawing, for one board. All of them hang off the dot,
 * so the node keeps its proportions at any size; only the transmitter ring is
 * held back where the board is tight.
 * @param {Array<{x: number, y: number}>} nodes
 * @param {number} ratio dot radius as a share of the nearest pair
 * @returns {{nearest: number, dot: number, cross: number, blockHalf: number,
 *            shell: number, hatchStep: number, clash: number[], ring: number}}
 */
export function metricsFor(nodes, ratio = DOT_RATIO) {
  const nearest = nearestPair(nodes);
  const dot = nearest * ratio;
  return {
    nearest,
    dot,
    /** Half-length of the arms of the cross drawn on a ruled-out node. */
    cross: dot * 1.6,
    /** Half-width of the square that stands in for a forbidden node. */
    blockHalf: dot * 1.5,
    /** Circumradius of the octagon that *is* an impermeable node. Close to
     *  the covered dot (1.75x) so the two read as bodies of the same weight
     *  rather than as a small thing inside a big one — an octagon of a given
     *  circumradius covers about a tenth less area than the circle through
     *  the same points. */
    shell: dot * 1.75,
    /** Spacing of the hatch lines inside that octagon. Wide enough that the
     *  gaps survive the smallest the board is ever drawn at, tight enough
     *  that the node still reads as filled and not as two stray strokes.
     *  4.2 units at the dot of 8 this drawing was tuned at. */
    hatchStep: dot * 0.525,
    /** Radii of the two rings that mark a node lit by more than one
     *  transmitter. */
    clash: [dot * 2.2, dot * 2.9],
    /** Radius of the transmitter ring. Far enough out to read as a separate
     *  ring rather than a thick border, which is what makes a transmitter
     *  identifiable without relying on its colour. It was 3.1 dots when the
     *  dot was 8, which left 4.8 units between the transmitter body (2 dots
     *  plus stroke) and the ring, and 1.5 units between the ring and a lit
     *  neighbour on the nearest pair of a typical board. With the dot at
     *  0.20 of that pair the same 3.1 would run 2.4 units into the
     *  neighbour; 2.75 keeps clear of it but leaves only 2.6 units of ring
     *  gap, 1.6px on a 50-node board, and the ring starts to read as a
     *  border. 2.9 is the middle: 3.8 units of ring gap (2.3px there), and
     *  at the nearest pair, in the one state where a lit node stands next
     *  to a transmitter, the ring's stroke meets the neighbour's by 0.6
     *  units, under half a pixel on a phone. */
    ring: dot * 2.9,
  };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Two decimals: enough for any screen, and keeps the attributes readable. */
const round2 = (value) => Math.round(value * 100) / 100;

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
 * Builds the SVG for a board. Call once per board, then feed states to
 * {@link render}.
 *
 * `board` and not `level`: this layer draws for both halves of the game, and
 * the word means two things there — a stored puzzle object in the puzzle modes,
 * a plain number in the run. The renderer only needs the graph and its k.
 * @param {{graph: import('./graph.js').Graph, k: number}} board a puzzle level
 *        as stored, or `{graph, k: 1}` for a board of the run
 * @param {{document?: Document, padding?: number, dotRatio?: number}} [options]
 *        `padding` is the margin around the graph in user units; less of it
 *        means the same board drawn larger in the same box. Clamped to the
 *        transmitter ring from below. `dotRatio` overrides {@link DOT_RATIO};
 *        it is there for the calibration tools, not for the page.
 * @returns {{svg: SVGSVGElement, nodes: Map<*, object>, edges: Array<object>,
 *            board: object, viewBox: {width: number},
 *            metrics: ReturnType<typeof metricsFor>}}
 */
export function createScene(
  board,
  { document: doc = globalThis.document, padding = PADDING, dotRatio = DOT_RATIO } = {},
) {
  const { nodes, edges } = board.graph;
  const metrics = metricsFor(nodes, dotRatio);
  const margin = Math.max(padding, metrics.ring);
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
  clipShape.setAttribute('points', octagon(metrics.shell));
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
    aura.setAttribute('r', round2(metrics.ring * 1.15));

    const ring = doc.createElementNS(SVG_NS, 'circle');
    ring.setAttribute('class', 'ring');
    ring.setAttribute('r', round2(metrics.ring));

    const dot = doc.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('class', 'dot');
    dot.setAttribute('r', round2(metrics.dot));

    // The transmitter's own radius, written on it. With senders of mixed radii
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
      shellPlate.setAttribute('points', octagon(metrics.shell));

      // Hatching, clipped to the plate. Diagonal lines rather than a pattern
      // fill: a <pattern> resolves `currentColor` against its own place in the
      // defs, not against the node referencing it, so a pattern could not
      // follow the node from unsupplied to supplied to transmitter.
      const hatch = doc.createElementNS(SVG_NS, 'g');
      hatch.setAttribute('class', 'shell-hatch');
      hatch.setAttribute('clip-path', `url(#${clipId})`);
      // Beyond this offset a 45-degree line misses the octagon entirely and
      // would only be drawn to be clipped away.
      const { shell: shellRadius, hatchStep } = metrics;
      const steps = Math.floor((shellRadius * Math.SQRT2 * Math.cos(Math.PI / 8)) / hatchStep);
      for (let step = -steps; step <= steps; step++) {
        const offset = step * hatchStep;
        const stroke = doc.createElementNS(SVG_NS, 'line');
        stroke.setAttribute('x1', round2(-shellRadius));
        stroke.setAttribute('y1', round2(-shellRadius + offset));
        stroke.setAttribute('x2', round2(shellRadius));
        stroke.setAttribute('y2', round2(shellRadius + offset));
        hatch.append(stroke);
      }
      shell.append(shellPlate, hatch);
    }

    // Two concentric rings: the shape itself says "more than one signal".
    const clash = doc.createElementNS(SVG_NS, 'g');
    clash.setAttribute('class', 'clash');
    for (const radius of metrics.clash) {
      const circle = doc.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('r', round2(radius));
      clash.append(circle);
    }

    // A forbidden node is drawn as a square with a bar through it: a different
    // shape and a different glyph from anything else on the board, so it never
    // relies on colour and never reads as a node the player could use.
    const block = doc.createElementNS(SVG_NS, 'g');
    block.setAttribute('class', 'block');
    const plate = doc.createElementNS(SVG_NS, 'rect');
    plate.setAttribute('class', 'plate');
    const half = metrics.blockHalf;
    plate.setAttribute('x', round2(-half));
    plate.setAttribute('y', round2(-half));
    plate.setAttribute('width', round2(half * 2));
    plate.setAttribute('height', round2(half * 2));
    plate.setAttribute('rx', round2(half * 0.25));
    const bar = doc.createElementNS(SVG_NS, 'rect');
    bar.setAttribute('class', 'bar');
    bar.setAttribute('x', round2(-half * 0.62));
    bar.setAttribute('y', round2(-half * 0.22));
    bar.setAttribute('width', round2(half * 1.24));
    bar.setAttribute('height', round2(half * 0.44));
    bar.setAttribute('rx', round2(half * 0.125));
    block.append(plate, bar);

    // The player's "nothing goes here" cross, drawn above the dot so it stays
    // legible whatever the dot is doing underneath.
    const cross = doc.createElementNS(SVG_NS, 'g');
    cross.setAttribute('class', 'cross');
    const arm = metrics.cross;
    for (const [x1, y1, x2, y2] of [
      [-arm, -arm, arm, arm],
      [-arm, arm, arm, -arm],
    ]) {
      const line = doc.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', round2(x1));
      line.setAttribute('y1', round2(y1));
      line.setAttribute('x2', round2(x2));
      line.setAttribute('y2', round2(y2));
      cross.append(line);
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

  return { svg, nodes: nodeElements, edges: edgeElements, board, viewBox: { width, height }, metrics };
}

/**
 * Applies a game state to the scene.
 * @param {object} scene from {@link createScene}
 * @param {object} state from game.js
 */
export function render(scene, state) {
  const { graph } = scene.board;
  const k = scene.board.k;
  // In the run every transmitter carries its own radius; elsewhere they all
  // share the board's k.
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
 * @param {number} [radius] defaults to the board's k; the run passes the
 *   radius of the transmitter currently in hand
 */
export function showRange(scene, id, radius = scene.board.k) {
  clearRange(scene);
  const hops = distancesFrom(scene.board.graph, id, radius);
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
  const onScreen = scene.svg.getBoundingClientRect();
  if (!onScreen.width || !onScreen.height) return;
  // The drawing is scaled uniformly to fit (preserveAspectRatio), so the
  // scale is whichever side fits tighter. Until 2026-11-10 only the width
  // was taken, which was right as long as the width limited — on a phone it
  // always did — and would have left the targets short of minPx on a stage
  // that limits by height.
  const scale = Math.min(onScreen.width / scene.viewBox.width, onScreen.height / scene.viewBox.height);
  const radius = Math.max(minPx / 2 / scale, scene.metrics.ring);
  for (const parts of scene.nodes.values()) {
    parts.hit.setAttribute('r', radius.toFixed(2));
  }
}
