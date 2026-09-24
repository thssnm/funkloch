/**
 * Pointer and keyboard input for the board. Knows nothing about rules — it only
 * reports which node was activated, noted, or inspected.
 *
 * Three actions have to share one board, so the gestures are split by device
 * rather than crammed onto one another:
 *
 *   mouse   hover shows the range, left click places or lifts a transmitter,
 *           right click notes a node as ruled out. All three are independent,
 *           so nothing can be triggered by accident.
 *
 *   touch   one finger, three outcomes, separated by how long it rests:
 *             < PREVIEW_MS   a tap: place or lift a transmitter
 *             < MARK_MS      the range is on show; releasing does nothing
 *             >= MARK_MS     the node is armed; releasing notes it
 *
 * The middle band is the important one. Once the range has appeared the gesture
 * has visibly committed to "I am only looking", so letting go can no longer
 * place a transmitter by mistake — the price of holding a moment too long is
 * that nothing happens, never that something unwanted does. The armed state is
 * shown on the node before release, so the third outcome is never a surprise
 * either.
 *
 * Touch defaults are pinned down throughout: `touch-action: manipulation` kills
 * the double-tap zoom delay, the default action on pointerdown is suppressed so
 * a swipe never starts a selection or a drag, and the long-press context menu
 * is blocked — that gesture belongs to the game now.
 */

/** Hold this long and the range appears; a release after this no longer taps. */
export const PREVIEW_MS = 180;

/** Hold this long and releasing notes the node as ruled out. */
export const MARK_MS = 550;

/** A press that wanders further than this is abandoned, in CSS pixels. */
const MOVE_SLOP = 12;

/**
 * @param {object} scene from render.js
 * @param {{onToggle: (id: string) => void, onToggleMark: (id: string) => void,
 *          onPreview: (id: string) => void, onPreviewEnd: () => void}} handlers
 * @returns {() => void} detach function
 */
export function attachInput(scene, { onToggle, onToggleMark, onPreview, onPreviewEnd }) {
  const { svg } = scene;
  svg.style.touchAction = 'manipulation';
  svg.style.userSelect = 'none';
  svg.style.webkitUserSelect = 'none';
  svg.style.webkitTapHighlightColor = 'transparent';

  /** The press in flight, if any. */
  let press = null;
  /** Needed because contextmenu carries no pointerType of its own. */
  let lastPointerType = 'mouse';

  // A forbidden node is scenery: it accepts nothing and reports nothing.
  const nodeOf = (event) => {
    const node = event.target.closest?.('.node') ?? null;
    return node && !node.classList.contains('is-forbidden') ? node : null;
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
    const node = nodeOf(event);
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
      previewTimer: setTimeout(() => {
        press.phase = 'preview';
        press.node.classList.add('is-inspecting');
        onPreview(press.id);
      }, PREVIEW_MS),
      markTimer: setTimeout(() => {
        press.phase = 'arming';
        press.node.classList.add('is-arming'); // shows what releasing will do
      }, MARK_MS),
    };
    node.classList.add('is-pressed');
  };

  const onPointerMove = (event) => {
    if (!press || press.mouse) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) <= MOVE_SLOP) return;
    endPress(); // the finger wandered off: abandon, do nothing
  };

  const onPointerUp = (event) => {
    if (!press) return;
    const onSameNode = nodeOf(event) === press.node;
    const { id, phase, mouse } = press;
    endPress();
    if (!onSameNode) return;

    if (mouse || phase === 'tap') onToggle(id);
    else if (phase === 'arming') onToggleMark(id);
    // phase 'preview': the player was only looking. Deliberately nothing.
  };

  const onPointerOver = (event) => {
    const node = nodeOf(event);
    if (!node || lastPointerType !== 'mouse' || press) return;
    onPreview(node.dataset.id);
  };

  const onPointerOut = (event) => {
    if (lastPointerType !== 'mouse' || press) return;
    if (nodeOf(event)) onPreviewEnd();
  };

  const onKeyDown = (event) => {
    const node = nodeOf(event);
    if (!node) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle(node.dataset.id);
    } else if (event.key === 'm' || event.key === 'M') {
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
    const node = nodeOf(event);
    if (!node) return;
    event.preventDefault();
    // On touch this fires mid-hold; the hold ladder owns that gesture, so only
    // a real right click notes the node.
    if (lastPointerType === 'mouse') {
      endPress();
      onToggleMark(node.dataset.id);
    }
  };

  const listeners = [
    ['pointerdown', onPointerDown],
    ['pointermove', onPointerMove],
    ['pointerup', onPointerUp],
    ['pointercancel', endPress],
    ['pointerleave', endPress],
    ['pointerover', onPointerOver],
    ['pointerout', onPointerOut],
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
