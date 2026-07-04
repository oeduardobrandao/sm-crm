// Reel video-swap staleness (closes the accepted-v1 gap flagged in slice 4 review):
// finalize_design_render writes a reel_cover design's rendered JPEG to the linked VIDEO's
// thumbnail_r2_key (design §5.2). Swapping the video afterwards doesn't touch the design doc,
// so `is_stale` (doc_hash IS DISTINCT FROM rendered_doc_hash) stays false, no re-render fires,
// and the publish gate (§5.3) happily ships the new video's auto-extracted thumbnail instead
// of the rendered cover.
//
// Fix: whenever a VIDEO gets linked to a post that has a reel_cover design, clear
// rendered_doc_hash — doc_hash is NOT NULL, so the generated is_stale flips true, which (a)
// blocks scheduling until the cover is current again and (b) lets the standard re-render
// machinery (editor GET, publish-gate re-trigger, or the caller's own kick) re-apply the cover
// to the CURRENT video. Harmless if a render is already in flight: its finalize re-checks the
// claimed hash and overwrites rendered_doc_hash anyway.
//
// Callers are service-role only — authenticated has SELECT-only grants on post_designs, so
// this direct UPDATE (deliberately not an RPC: no doc/rev/status invariants are involved)
// works exclusively through the service client the edge functions already hold.

// deno-lint-ignore no-explicit-any
type DbClient = { from: (table: string) => any };

export interface ReelCoverStaleResult {
  marked: boolean;
  /** Set when marked — what a caller needs to fire the design-render kick. */
  design: { id: number; rev: number } | null;
}

export async function markReelCoverStaleForNewVideo(
  db: DbClient,
  postId: number,
): Promise<ReelCoverStaleResult> {
  const { data } = await db
    .from("post_designs")
    .select("id, rev, format:doc->>format")
    .eq("post_id", postId)
    .maybeSingle();
  if (!data || data.format !== "reel_cover") return { marked: false, design: null };

  const { error } = await db
    .from("post_designs")
    .update({ rendered_doc_hash: null })
    .eq("id", data.id);
  if (error) throw error;
  return { marked: true, design: { id: data.id, rev: data.rev } };
}
