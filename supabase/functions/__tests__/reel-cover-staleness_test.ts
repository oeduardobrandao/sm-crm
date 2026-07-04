// Reel video-swap staleness (see _shared/reel-cover-staleness.ts) — a new video on a post
// with a reel_cover design must invalidate the rendered cover; every other case is a no-op.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { markReelCoverStaleForNewVideo } from "../_shared/reel-cover-staleness.ts";

Deno.test("reel-cover staleness: post without a design → no-op", async () => {
  const db = createSupabaseQueryMock();
  db.queue("post_designs", "select", { data: null, error: null });
  const res = await markReelCoverStaleForNewVideo(db as never, 1);
  assertEquals(res, { marked: false, design: null });
});

Deno.test("reel-cover staleness: feed/carrossel design → no-op (covers live in post_file_links)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("post_designs", "select", { data: { id: 7, rev: 3, format: "feed" }, error: null });
  const res = await markReelCoverStaleForNewVideo(db as never, 1);
  assertEquals(res, { marked: false, design: null });
});

Deno.test("reel-cover staleness: reel_cover design → rendered_doc_hash cleared, design returned", async () => {
  const db = createSupabaseQueryMock();
  db.queue("post_designs", "select", {
    data: { id: 7, rev: 3, format: "reel_cover" },
    error: null,
  });
  db.queue("post_designs", "update", { data: null, error: null });
  const res = await markReelCoverStaleForNewVideo(db as never, 1);
  assertEquals(res, { marked: true, design: { id: 7, rev: 3 } });
});

Deno.test("reel-cover staleness: update failure throws (callers catch — uploads must not fail)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("post_designs", "select", {
    data: { id: 7, rev: 3, format: "reel_cover" },
    error: null,
  });
  db.queue("post_designs", "update", { data: null, error: { message: "boom" } });
  let threw = false;
  try {
    await markReelCoverStaleForNewVideo(db as never, 1);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});
