/**
 * Pure graph helpers.
 *
 * A graph is a plain object:
 *   {
 *     nodes: [{ id, x, y, forbidden? }, ...],
 *     edges: [[idA, idB], ...]      // undirected
 *   }
 *
 * `forbidden: true` marks a node no transmitter signal may reach. Such a node
 * does not itself need supplying. Leaving the field off everywhere reproduces
 * the original behaviour exactly, node for node.
 *
 * All functions are pure: they never mutate their arguments and keep no state
 * between calls. `x` / `y` are carried for later rendering and ignored here.
 *
 * Tolerated input quirks: edges pointing at unknown ids, self-loops and
 * duplicate edges are ignored rather than throwing.
 */

/** @typedef {{id: *, x: number, y: number, forbidden?: boolean}} Node */
/** @typedef {{nodes: Node[], edges: Array<[*, *]>}} Graph */

/**
 * Builds an adjacency map `id -> Set<id>` for the given graph.
 * Internal helper; rebuilt per call to stay free of shared state.
 * @param {Graph} graph
 * @returns {Map<*, Set<*>>}
 */
function adjacency(graph) {
  const adj = new Map();
  const nodes = graph?.nodes ?? [];
  for (const node of nodes) {
    if (!adj.has(node.id)) adj.set(node.id, new Set());
  }
  for (const edge of graph?.edges ?? []) {
    const [a, b] = edge ?? [];
    if (a === b) continue;
    if (!adj.has(a) || !adj.has(b)) continue;
    adj.get(a).add(b);
    adj.get(b).add(a);
  }
  return adj;
}

/**
 * Returns the ids directly connected to `id`.
 * Unknown ids yield an empty array. Order follows the edge list.
 * @param {Graph} graph
 * @param {*} id
 * @returns {Array<*>}
 */
export function neighbors(graph, id) {
  const adj = adjacency(graph);
  const found = adj.get(id);
  return found ? [...found] : [];
}

/**
 * All node ids reachable from `id` within at most `k` edges, `id` included.
 * Returns an empty array for unknown ids or negative `k`; `k === 0` returns
 * just `[id]`. Result is in BFS order (increasing distance).
 * @param {Graph} graph
 * @param {*} id
 * @param {number} k
 * @returns {Array<*>}
 */
export function bfsWithin(graph, id, k) {
  const adj = adjacency(graph);
  if (!adj.has(id) || !(k >= 0)) return [];

  const visited = new Set([id]);
  const order = [id];
  let frontier = [id];

  for (let depth = 0; depth < k && frontier.length > 0; depth++) {
    const next = [];
    for (const current of frontier) {
      for (const neighbor of adj.get(current)) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        order.push(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }

  return order;
}

/**
 * The set of nodes supplied by the given transmitters, i.e. the union of the
 * `k`-neighbourhoods of all transmitter ids. Unknown transmitter ids contribute
 * nothing.
 * @param {Graph} graph
 * @param {Iterable<*>} transmitterIds
 * @param {number} k
 * @returns {Set<*>}
 */
export function coverage(graph, transmitterIds, k) {
  const covered = new Set();
  for (const id of transmitterIds ?? []) {
    for (const reached of bfsWithin(graph, id, k)) covered.add(reached);
  }
  return covered;
}

/**
 * The nodes no signal may reach.
 * @param {Graph} graph
 * @returns {Set<*>}
 */
export function forbiddenNodes(graph) {
  return new Set((graph?.nodes ?? []).filter((node) => node.forbidden === true).map((node) => node.id));
}

/**
 * The nodes that must end up supplied — everything that is not forbidden.
 * These are the constraints of the covering problem.
 * @param {Graph} graph
 * @returns {Array<*>}
 */
export function requiredNodes(graph) {
  return (graph?.nodes ?? []).filter((node) => node.forbidden !== true).map((node) => node.id);
}

/**
 * The nodes a transmitter may legally stand on: those whose ball reaches no
 * forbidden node. A forbidden node is never admissible, since its own ball
 * contains itself.
 *
 * This is the single definition of admissibility; solver, reduction and tiers
 * all read it from here rather than each deciding for themselves.
 * @param {Graph} graph
 * @param {number} k
 * @returns {Array<*>}
 */
export function admissibleCandidates(graph, k) {
  const banned = forbiddenNodes(graph);
  if (banned.size === 0) return (graph?.nodes ?? []).map((node) => node.id);
  return (graph?.nodes ?? [])
    .map((node) => node.id)
    .filter((id) => !bfsWithin(graph, id, k).some((reached) => banned.has(reached)));
}

/**
 * How many transmitters reach each node. The exact-cover mode needs the count,
 * not just the yes/no that {@link coverage} gives: two signals on one node is a
 * conflict there, not a stronger yes.
 * @param {Graph} graph
 * @param {Iterable<*>} transmitterIds
 * @param {number} k
 * @returns {Map<*, number>} only nodes reached at least once appear
 */
export function signalCounts(graph, transmitterIds, k) {
  const signals = new Map();
  for (const id of transmitterIds ?? []) {
    for (const reached of bfsWithin(graph, id, k)) {
      signals.set(reached, (signals.get(reached) ?? 0) + 1);
    }
  }
  return signals;
}

/**
 * Strict structural check for a graph, used as a gate by the generator and by
 * anything loading graphs from disk. Throws on the first problem found:
 *   - missing / non-array `nodes` or `edges`
 *   - duplicate node ids
 *   - a `forbidden` field that is not a boolean
 *   - non-finite (NaN, Infinity) or missing coordinates
 *   - malformed edges, or edges referencing unknown node ids
 *
 * The runtime helpers above stay deliberately tolerant of such input; this is
 * the explicit place where bad data is turned into a loud error.
 * @param {Graph} graph
 * @returns {Graph} the very same graph, for chaining
 * @throws {TypeError}
 */
export function validateGraph(graph) {
  if (!graph || typeof graph !== 'object') {
    throw new TypeError('validateGraph: graph must be an object');
  }
  if (!Array.isArray(graph.nodes)) throw new TypeError('validateGraph: graph.nodes must be an array');
  if (!Array.isArray(graph.edges)) throw new TypeError('validateGraph: graph.edges must be an array');

  const known = new Set();
  for (const [index, node] of graph.nodes.entries()) {
    if (!node || typeof node !== 'object') {
      throw new TypeError(`validateGraph: node at index ${index} is not an object`);
    }
    if (node.id === undefined || node.id === null) {
      throw new TypeError(`validateGraph: node at index ${index} has no id`);
    }
    if (known.has(node.id)) {
      throw new TypeError(`validateGraph: duplicate node id ${JSON.stringify(node.id)}`);
    }
    known.add(node.id);
    if (node.forbidden !== undefined && typeof node.forbidden !== 'boolean') {
      throw new TypeError(
        `validateGraph: node ${JSON.stringify(node.id)} has a non-boolean forbidden flag: ` +
          `${JSON.stringify(node.forbidden)}`,
      );
    }
    for (const axis of ['x', 'y']) {
      if (!Number.isFinite(node[axis])) {
        throw new TypeError(
          `validateGraph: node ${JSON.stringify(node.id)} has non-finite ${axis}: ${node[axis]}`,
        );
      }
    }
  }

  for (const [index, edge] of graph.edges.entries()) {
    if (!Array.isArray(edge) || edge.length !== 2) {
      throw new TypeError(`validateGraph: edge at index ${index} must be a pair [idA, idB]`);
    }
    for (const id of edge) {
      if (!known.has(id)) {
        throw new TypeError(
          `validateGraph: edge at index ${index} references unknown node id ${JSON.stringify(id)}`,
        );
      }
    }
  }

  return graph;
}

// ---------------------------------------------------------------------------
// Impermeable nodes
// ---------------------------------------------------------------------------

/**
 * `blocked: true` marks a node signal does not pass *through*. It still lights
 * up when a signal reaches it — it is a normal node for the covering problem —
 * but it absorbs the signal instead of handing it on, so every path that walks
 * into such a node ends there.
 *
 * A transmitter standing on one is fine and radiates unhindered: the rule is
 * about transit, not about the source.
 *
 * Deliberately a separate flag from `forbidden`: forbidden says "no signal may
 * ever touch this", blocked says "signal stops here".
 * @param {Graph} graph
 * @returns {Set<*>}
 */
export function blockedNodes(graph) {
  return new Set((graph?.nodes ?? []).filter((node) => node.blocked === true).map((node) => node.id));
}

/**
 * {@link bfsWithin} with impermeable nodes honoured: a blocked node is still
 * reported as reached, but the walk does not continue past it.
 *
 * A deliberate copy rather than a flag on `bfsWithin`: cover mode, exact mode,
 * the reduction search and the level generator all rest on that function, and
 * none of them should have to grow an opinion about transit.
 *
 * On a graph without any blocked node this returns exactly what `bfsWithin`
 * returns, same ids in the same BFS order.
 * @param {Graph} graph
 * @param {*} id
 * @param {number} k
 * @returns {Array<*>}
 */
export function bfsWithinBlocked(graph, id, k) {
  const adj = adjacency(graph);
  if (!adj.has(id) || !(k >= 0)) return [];
  const opaque = blockedNodes(graph);

  const visited = new Set([id]);
  const order = [id];
  // The source radiates even when it is itself blocked, so the first frontier
  // is never filtered.
  let frontier = [id];

  for (let depth = 0; depth < k && frontier.length > 0; depth++) {
    const next = [];
    for (const current of frontier) {
      for (const neighbor of adj.get(current)) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        order.push(neighbor);
        // Reached, and lit — but the signal stops here.
        if (!opaque.has(neighbor)) next.push(neighbor);
      }
    }
    frontier = next;
  }

  return order;
}

/**
 * {@link coverage} over {@link bfsWithinBlocked}.
 * @param {Graph} graph
 * @param {Iterable<*>} transmitterIds
 * @param {number} k
 * @returns {Set<*>}
 */
export function coverageBlocked(graph, transmitterIds, k) {
  const covered = new Set();
  for (const id of transmitterIds ?? []) {
    for (const reached of bfsWithinBlocked(graph, id, k)) covered.add(reached);
  }
  return covered;
}

// ---------------------------------------------------------------------------
// Amplifier nodes
// ---------------------------------------------------------------------------

/**
 * `amplifier: true` marks a node that lends a transmitter standing on it one
 * more step of reach. In every other respect it is an ordinary node: it has to
 * be supplied like any other, and it passes signal on like any other.
 *
 * The bonus belongs to the *source*, not to the path: walking through an
 * amplifier buys nothing. That keeps the rule readable on the board — a node is
 * worth more to stand on, and nothing else changes — and it keeps the walk
 * below a single BFS instead of a shortest-path search with per-node budgets.
 *
 * Independent of `blocked`: a node may be both, and then a transmitter on it
 * reaches one step further while signal from elsewhere still stops there.
 * @param {Graph} graph
 * @returns {Set<*>}
 */
export function amplifierNodes(graph) {
  return new Set((graph?.nodes ?? []).filter((node) => node.amplifier === true).map((node) => node.id));
}

/**
 * {@link bfsWithinBlocked} with the amplifier bonus applied to the source: a
 * transmitter on an amplifier walks `k + 1` steps, one on any other node walks
 * `k`. Impermeable nodes are honoured either way.
 *
 * A third walk rather than a flag on the second, for the same reason the second
 * is not a flag on the first: the solver, the generator, the reduction and the
 * fixed-stage mode all rest on the plain walks, and none of them should have to
 * grow an opinion about amplifiers.
 *
 * On a board without amplifiers this returns exactly what `bfsWithinBlocked`
 * returns, and on a board without either flag exactly what `bfsWithin` returns.
 * @param {Graph} graph
 * @param {*} id
 * @param {number} k
 * @returns {Array<*>}
 */
export function bfsWithinAmplified(graph, id, k) {
  if (!(k >= 0)) return [];
  const boost = (graph?.nodes ?? []).some((node) => node.id === id && node.amplifier === true) ? 1 : 0;
  return bfsWithinBlocked(graph, id, k + boost);
}

/**
 * {@link coverage} over {@link bfsWithinAmplified}.
 * @param {Graph} graph
 * @param {Iterable<*>} transmitterIds
 * @param {number} k
 * @returns {Set<*>}
 */
export function coverageAmplified(graph, transmitterIds, k) {
  const covered = new Set();
  for (const id of transmitterIds ?? []) {
    for (const reached of bfsWithinAmplified(graph, id, k)) covered.add(reached);
  }
  return covered;
}
