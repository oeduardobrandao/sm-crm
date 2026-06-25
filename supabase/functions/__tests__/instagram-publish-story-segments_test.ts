import { assert, assertEquals } from "./assert.ts";

Deno.env.set("R2_ACCOUNT_ID", "acct");
Deno.env.set("R2_ACCESS_KEY_ID", "akid");
Deno.env.set("R2_SECRET_ACCESS_KEY", "secret");
Deno.env.set("R2_BUCKET", "bucket");

const { ensureStorySegments } = await import("../_shared/instagram-publish-utils.ts");

// Minimal db stub: records updates, returns scripted selects.
// deno-lint-ignore no-explicit-any
function makeDb(opts: {
  segments?: unknown;
  links?: Array<{ sort_order: number; files: { id: number; kind: string; r2_key: string; thumbnail_r2_key: string | null } }>;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    from(table: string) {
      const builder: any = {
        _table: table,
        _select: "",
        select(sel: string) { this._select = sel; return this; },
        eq() { return this; },
        order() { return Promise.resolve({ data: opts.links ?? [] }); },
        update(vals: Record<string, unknown>) { updates.push(vals); return { eq() { return Promise.resolve({ data: null }); } }; },
        single() {
          if (table === "workflow_posts") return Promise.resolve({ data: { story_segments: opts.segments ?? null } });
          return Promise.resolve({ data: null });
        },
        maybeSingle() { return Promise.resolve({ data: { story_segments: opts.segments ?? null } }); },
      };
      return builder;
    },
  };
  return { db, updates };
}

Deno.test("ensureStorySegments builds one null segment per media when absent", async () => {
  const { db, updates } = makeDb({
    segments: null,
    links: [
      { sort_order: 0, files: { id: 11, kind: "image", r2_key: "a.jpg", thumbnail_r2_key: null } },
      { sort_order: 1, files: { id: 12, kind: "video", r2_key: "b.mp4", thumbnail_r2_key: "b.jpg" } },
    ],
  });
  // deno-lint-ignore no-explicit-any
  const segs = await ensureStorySegments(db as any, 1);
  assertEquals(segs, [
    { file_id: 11, container_id: null, media_id: null },
    { file_id: 12, container_id: null, media_id: null },
  ]);
  assertEquals(updates.length, 1);
  assertEquals((updates[0] as any).story_segments, segs);
});

Deno.test("ensureStorySegments is idempotent and preserves persisted ids", async () => {
  const existing = [{ file_id: 11, container_id: "c1", media_id: "m1" }];
  const { db, updates } = makeDb({ segments: existing });
  // deno-lint-ignore no-explicit-any
  const segs = await ensureStorySegments(db as any, 1);
  assertEquals(segs, existing);
  assertEquals(updates.length, 0, "must not rewrite when segments already exist");
});
