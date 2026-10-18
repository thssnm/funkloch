/**
 * Pointer and keyboard input for the board. Knows nothing about rules — it only
 * reports which node was activated, noted, or inspected.
 *
 * How many gestures a board needs depends on how many actions it has, so the
 * mode decides by what it hands in. A mode that passes `onToggleMark` has two,
 * and they are split by device rather than crammed onto one another:
 *
 *   mouse   hover shows the range, left click activates the node, right click
 *           notes it as ruled out. All three are independent, so nothing can be
 *           triggered by accident.
 *
 *   touch   one finger, three outcomes, separated by how long it rests:
 *             < PREVIEW_MS   a tap: activate the node
 *             < MARK_MS      the range is on show; releasing does nothing
 *             >= MARK_MS     the node is armed; releasing notes it
 *
 *           The middle band is the important one. Once the range has appeared
 *           the gesture has visibly committed to "I am only looking", so
 *           letting go can no longer activate by mistake — the price of holding
 *           a moment too long is that nothing happens, never that something
 *           unwanted does. The armed state is shown on the node before release,
 *           so the third outcome is never a surprise either.
 *
 * A mode that leaves `onToggleMark` out has one action, and then the ladder is
 * a tax on a choice nobody has to make: no timers, no bands, press and release
 * on a node activates it however long the finger rested. That is what the run
 * modes want — a placed transmitter is final there, so a hold with nothing on
 * the other end of it would only read as a tap the board swallowed.
 *
 * Touch defaults are pinned down either way: `touch-action: manipulation` kills
 * the double-tap zoom delay, the default action on pointerdown is suppressed so
 * a swipe never starts a selection or a drag, and the context menu is blocked
 * over the board whether or not the right button does anything — a system menu
 * dropped on the game mid-move is never what was wanted.
 */

/** Hold this long and the range appears; a release after this no longer taps.
 *  Only a board that can mark runs the ladder at all. */
export const PREVIEW_MS = 180;

/** Hold this long and releasing notes the node as ruled out. */
export const MARK_MS = 550;

/** A press that wanders further than this is abandoned, in CSS pixels. */
const MOVE_SLOP = 12;

/**
 * Which node a point belongs to: the nearest one whose reach contains it.
 *
 * Proximity and not the element under the pointer. The tap targets are at
 * least 44px across, and on a dense board the nodes stand 24 to 27px apart,
 * so the targets overlap almost entirely. Hit-testing by element then hands
 * the tap to whichever node was drawn last, and a player aiming squarely at
 * one node lands on its neighbour — and, placements being final, pays for it.
 * The reach stays as the boundary: a point outside every node's reach is
 * nobody's. Inside, the nearest centre wins.
 *
 * Pure: units are whatever the caller measures in, as long as `point` and
 * `reachOf` agree with the nodes.
 * @template {{x: number, y: number}} N
 * @param {N[]} nodes
 * @param {{x: number, y: number}} point
 * @param {(node: N) => number} reachOf radius within which a node can be hit
 * @returns {N | null}
 */
export function nearestWithin(nodes, point, reachOf) {
  let best = null;
  let bestDistance = Infinity;
  for (const node of nodes) {
    const distance = Math.hypot(node.x - point.x, node.y - point.y);
    if (distance < bestDistance && distance <= reachOf(node)) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * @param {object} scene from render.js
 * @param {{onToggle: (id: string) => void, onToggleMark?: (id: string) => void,
 *          onPreview: (id: string) => void, onPreviewEnd: () => void}} handlers
 *        without `onToggleMark` the hold ladder and right click fall away
 * @returns {() => void} detach function
 */
export function attachInput(scene, { onToggle, onToggleMark, onPreview, onPreviewEnd }) {
  const { svg } = scene;
  /** Whether this board has a second action to separate the first one from. */
  const canMark = typeof onToggleMark === 'function';
  svg.style.touchAction = 'manipulation';
  svg.style.userSelect = 'none';
  svg.style.webkitUserSelect = 'none';
  svg.style.webkitTapHighlightColor = 'transparent';

  /** The press in flight, if any. */
  let press = null;
  /** Needed because contextmenu carries no pointerType of its own. */
  let lastPointerType = 'mouse';

  // A forbidden node is scenery: it accepts nothing and reports nothing.
  const allowed = (group) => (group && !group.classList.contains('is-forbidden') ? group : null);

  // The node an event's *target* belongs to. Right for keyboard and focus
  // events, which have no coordinates; wrong for a pointer on a dense board,
  // where the targets overlap (see nearestWithin) — those go through locate.
  const nodeOf = (event) => allowed(event.target.closest?.('.node') ?? null);

  // The reach of a node in user units: its tap target, which fitHitAreas keeps
  // at 44 screen pixels or the ring, whichever is wider.
  const reachOf = (node) => parseFloat(scene.nodes.get(node.id).hit.getAttribute('r'));

  // The node a pointer event belongs to, by proximity. The pointer's screen
  // position is taken back into the board's own units through the SVG's
  // current transform, so the distance is measured where the nodes are.
  // A forbidden node still shadows the spot it stands on: the nearest node is
  // found first, and if that one is forbidden the tap is nobody's — otherwise
  // tapping scenery would place on the neighbour behind it.
  const locate = (event) => {
    const ctm = svg.getScreenCTM?.();
    if (!ctm || !Number.isFinite(event.clientX)) return nodeOf(event);
    const inverse = ctm.inverse();
    const point = {
      x: inverse.a * event.clientX + inverse.c * event.clientY + inverse.e,
      y: inverse.b * event.clientX + inverse.d * event.clientY + inverse.f,
    };
    const node = nearestWithin(scene.board.graph.nodes, point, reachOf);
    return node ? allowed(scene.nodes.get(node.id).group) : null;
  };

  const endPress = () => {
    if (!press) return;
    clearTimeout(press.previewTimer);
    clearTimeout(press.markTimer);
    press.node.classList.remove('is-pressed', 'is-inspecting', 'is-arming');
    if (press.phase !== 'tap') onPreviewEnd();
    press = null;
  };

  const onPointerDown = (event) => {
    const node = locate(event);
    if (!node) return;
    lastPointerType = event.pointerType || 'mouse';
    event.preventDefault(); // no selection, no drag, no scroll started on a node

    if (lastPointerType === 'mouse') {
      if (event.button !== 0) return; // right click is handled by contextmenu
      endPress();
      press = { node, id: node.dataset.id, phase: 'tap', mouse: true };
      node.classList.add('is-pressed');
      return;
    }

    endPress();
    press = {
      node,
      id: node.dataset.id,
      phase: 'tap',
      mouse: false,
      x: event.clientX,
      y: event.clientY,
    };
    // Without a second action the press stays a tap for as long as it lasts.
    if (canMark) {
      press.previewTimer = setTimeout(() => {
        press.phase = 'preview';
        press.node.classList.add('is-inspecting');
        onPreview(press.id);
      }, PREVIEW_MS);
      press.markTimer = setTimeout(() => {
        press.phase = 'arming';
        press.node.classList.add('is-arming'); // shows what releasing will do
      }, MARK_MS);
    }
    node.classList.add('is-pressed');
  };

  const onPointerMove = (event) => {
    if (!press || press.mouse) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) <= MOVE_SLOP) return;
    endPress(); // the finger wandered off: abandon, do nothing
  };

  const onPointerUp = (event) => {
    if (!press) return;
    const onSameNode = locate(event) === press.node;
    const { id, phase, mouse } = press;
    endPress();
    if (!onSameNode) return;

    if (mouse || phase === 'tap') onToggle(id);
    else if (phase === 'arming') onToggleMark(id);
    // phase 'preview': the player was only looking. Deliberately nothing.
  };

  // Mouse hover shows the range of the node a click would hit — the same
  // proximity rule, so the preview never promises one node and the click
  // takes another. Followed on every move, because the nearest node changes
  // without any element boundary being crossed.
  let hovered = null;
  const onHover = (event) => {
    if ((event.pointerType || 'mouse') !== 'mouse' || press) return;
    const id = locate(event)?.dataset.id ?? null;
    if (id === hovered) return;
    if (hovered !== null) onPreviewEnd();
    hovered = id;
    if (id !== null) onPreview(id);
  };

  const onPointerLeave = () => {
    endPress();
    if (hovered === null) return;
    hovered = null;
    onPreviewEnd();
  };

  const onKeyDown = (event) => {
    const node = nodeOf(event);
    if (!node) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle(node.dataset.id);
    } else if (canMark && (event.key === 'm' || event.key === 'M')) {
      event.preventDefault();
      onToggleMark(node.dataset.id);
    }
  };

  // Keyboard users get the range too, on focus.
  const onFocusIn = (event) => {
    const node = nodeOf(event);
    if (node) onPreview(node.dataset.id);
  };
  const onFocusOut = (event) => {
    if (nodeOf(event)) onPreviewEnd();
  };

  const onContextMenu = (event) => {
    // Suppressed anywhere over the board: a system menu over the game helps
    // nobody, and on touch this fires mid-hold.
    event.preventDefault();
    const node = locate(event);
    if (!node) return;
    // The hold ladder owns the touch gesture, so only a real right click notes
    // the node — and only where there is something to note.
    if (canMark && lastPointerType === 'mouse') {
      endPress();
      onToggleMark(node.dataset.id);
    }
  };

  const listeners = [
    ['pointerdown', onPointerDown],
    ['pointermove', onPointerMove],
    ['pointermove', onHover],
    ['pointerup', onPointerUp],
    ['pointercancel', endPress],
    ['pointerleave', onPointerLeave],
    ['pointerover', onHover],
    ['keydown', onKeyDown],
    ['focusin', onFocusIn],
    ['focusout', onFocusOut],
    ['contextmenu', onContextMenu],
    ['dragstart', (event) => event.preventDefault()],
  ];
  for (const [type, handler] of listeners) svg.addEventListener(type, handler);

  return () => {
    endPress();
    onPreviewEnd();
    for (const [type, handler] of listeners) svg.removeEventListener(type, handler);
  };
}
