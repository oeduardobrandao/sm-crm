import { assert, assertEquals } from "./assert.ts";
import { classifyPublishError, TRIAL_MEDIA_SHAPE_ERROR } from "../_shared/publish-error-codes.ts";

// signGetUrl presigns locally (no network) but reads R2 env lazily.
Deno.env.set("R2_ACCOUNT_ID", "acct");
Deno.env.set("R2_ACCESS_KEY_ID", "akid");
Deno.env.set("R2_SECRET_ACCESS_KEY", "secret");
Deno.env.set("R2_BUCKET", "bucket");

const {
  ensureCarouselChildren,
  isCarouselPost,
} = await import("../_shared/instagram-publish-utils.ts");

type MediaLink = {
  sort_order: number;
  files: { id: number; kind: string; r2_key: string; thumbnail_r2_key: string | null };
};

function link(sort: number, id: number, kind: string): MediaLink {
  return {
    sort_order: sort,
    files: { id, kind, r2_key: `${kind}/${id}.${kind === "video" ? "mp4" : "jpg"}`, thumbnail_r2_key: null },
  };
}

// Stateful db stub: `children` is what workflow_posts.carousel_children reads back;
// set_carousel_child_field rpc mutates it in place (like the real RPC would), and
// a whole-column update replaces it. Records every update and rpc call.
// deno-lint-ignore no-explicit-any
function makeDb(opts: { children?: any; media?: MediaLink[] }) {
  const updates: Array<Record<string, unknown>> = [];
  // deno-lint-ignore no-explicit-any
  const rpcCalls: Array<{ fn: string; params: any }> = [];
  let children = opts.children ?? null;
  // deno-lint-ignore no-explicit-any
  const db: any = {
    from(table: string) {
      return {
        select() { return this; },
        eq() { return this; },
        order() { return Promise.resolve({ data: opts.media ?? [] }); },
        single() {
          return Promise.resolve({ data: table === "workflow_posts" ? { carousel_children: children } : null });
        },
        update(vals: Record<string, unknown>) {
          updates.push(vals);
          if ("carousel_children" in vals) children = vals.carousel_children;
          return { eq() { return Promise.resolve({ data: null }); } };
        },
      };
    },
    // deno-lint-ignore no-explicit-any
    rpc(fn: string, params: any) {
      rpcCalls.push({ fn, params });
      if (fn === "set_carousel_child_field" && Array.isArray(children)) {
        // deno-lint-ignore no-explicit-any
        children = children.map((c: any, i: number) =>
          i === params.p_index ? { ...c, [params.p_field]: params.p_value } : c
        );
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { db, updates, rpcCalls, get children() { return children; } };
}

Deno.test("ensureCarouselChildren builds one unready child per media when absent", async () => {
  const ctx = makeDb({ children: null, media: [link(0, 11, "image"), link(1, 12, "video")] });
  const children = await ensureCarouselChildren(ctx.db, 1);
  assertEquals(children, [
    { file_id: 11, kind: "image", container_id: null, ready: false },
    { file_id: 12, kind: "video", container_id: null, ready: false },
  ]);
  assertEquals(ctx.updates.length, 1);
  assertEquals(ctx.updates[0].carousel_children, children);
});

Deno.test("ensureCarouselChildren is idempotent and preserves persisted state", async () => {
  const existing = [
    { file_id: 11, kind: "image", container_id: "c1", ready: true },
    { file_id: 12, kind: "video", container_id: "c2", ready: false },
  ];
  const ctx = makeDb({ children: existing, media: [link(0, 11, "image"), link(1, 12, "video")] });
  const children = await ensureCarouselChildren(ctx.db, 1);
  assertEquals(children, existing);
  assertEquals(ctx.updates.length, 0, "must not rewrite when the file sequence is unchanged");
});

Deno.test("ensureCarouselChildren rebuilds when the media set changed (gallery swap / reorder)", async () => {
  const stale = [
    { file_id: 11, kind: "image", container_id: "c1", ready: true },
    { file_id: 12, kind: "video", container_id: "c2", ready: true },
  ];
  // file 12 was swapped for file 99 in the gallery
  const ctx = makeDb({ children: stale, media: [link(0, 11, "image"), link(1, 99, "video")] });
  const children = await ensureCarouselChildren(ctx.db, 1);
  assertEquals(children, [
    { file_id: 11, kind: "image", container_id: null, ready: false },
    { file_id: 99, kind: "video", container_id: null, ready: false },
  ]);
  assertEquals(ctx.updates.length, 1, "stale array must be replaced");
});

Deno.test("isCarouselPost: stories never, single media no, 2+ media yes", async () => {
  const two = [link(0, 1, "image"), link(1, 2, "image")];
  assertEquals(await isCarouselPost(makeDb({ media: two }).db, 1, "stories"), false);
  assertEquals(await isCarouselPost(makeDb({ media: [link(0, 1, "video")] }).db, 1, "reels"), false);
  assertEquals(await isCarouselPost(makeDb({ media: two }).db, 1, "feed"), true);
  assertEquals(await isCarouselPost(makeDb({ media: two }).db, 1, null), true);
});
