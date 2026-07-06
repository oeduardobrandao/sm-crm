// Workaround for an @open-pencil/core@0.13.2 fig-export bug (fixed in our fork
// commit 5d01d6f, not in the published package): the exporter mints guids for
// nodes WITHOUT `source.id` as {sessionID: 1, localID: counter++}, but seeds the
// counter only past imported session-0 localIDs. Content nodes from a previous
// export live in session 1, so the first node created on an imported graph
// reuses an existing guid and the re-import silently drops the node that owned
// it. Assigning a fresh, non-colliding `source.id` to every created node makes
// the exporter keep OUR guids and never mint — collision impossible.
//
// Call this after mutations, before every writeDocument('fig', graph).

/** Max localID across every session among nodes that already have a source id. */
function maxImportedLocalId(graph) {
  let max = 0;
  for (const node of graph.nodes.values()) {
    const src = node.source?.id;
    if (!src) continue;
    const m = /^(\d+):(\d+)$/.exec(src);
    if (m) max = Math.max(max, Number(m[2]));
  }
  return max;
}

/**
 * Assigns `source.id` to every node lacking one, using session-1 localIDs past
 * everything already present. Returns how many ids were assigned (0 = graph was
 * already export-safe). Idempotent.
 */
export function ensureExportSafeGuids(graph) {
  let next = maxImportedLocalId(graph);
  let assigned = 0;
  for (const [id, node] of graph.nodes) {
    // The document root never goes through guid minting (exporter hardcodes
    // {0,0} for it), so its missing source.id is normal — leave it alone.
    if (id === graph.rootId) continue;
    if (!node.source) continue; // scene-graph nodes always carry source; stay defensive
    if (!node.source.id) {
      node.source.id = `1:${++next}`;
      assigned++;
    }
  }
  return assigned;
}
