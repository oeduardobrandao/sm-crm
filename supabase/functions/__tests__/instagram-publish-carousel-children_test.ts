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

const { createMissingCarouselChildContainers } = await import("../_shared/instagram-publish-utils.ts");

// Graph stub. POST /media -> {id: c-N} (N counts POSTs); GET status polls answer
// from statusFor(containerId), default FINISHED. Records every call.
// deno-lint-ignore no-explicit-any
function stubGraph(statusFor: (id: string) => string = () => "FINISHED") {
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  const calls: Array<{ url: string; body: any }> = [];
  let n = 0;
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (!init) {
      const id = url.split("/").pop()?.split("?")[0] ?? "";
      return Promise.resolve(new Response(JSON.stringify({ status_code: statusFor(id) }), { status: 200 }));
    }
    n += 1;
    return Promise.resolve(new Response(JSON.stringify({ id: `c-${n}` }), { status: 200 }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

Deno.test("createMissingCarouselChildContainers creates only children lacking a container and persists each id", async () => {
  const ctx = makeDb({
    children: [
      { file_id: 11, kind: "image", container_id: "kept", ready: true },
      { file_id: 12, kind: "video", container_id: null, ready: false },
      { file_id: 13, kind: "image", container_id: null, ready: false },
    ],
    media: [link(0, 11, "image"), link(1, 12, "video"), link(2, 13, "image")],
  });
  const g = stubGraph();
  let children;
  try {
    children = await createMissingCarouselChildContainers(ctx.db, { postId: 1, igUserId: "ig", token: "t" });
  } finally { g.restore(); }

  assertEquals(g.calls.length, 2, "one POST per missing child, none for the kept one");
  assertEquals(g.calls[0].body.is_carousel_item, true);
  assertEquals(g.calls[0].body.media_type, "VIDEO");
  assert(g.calls[0].body.video_url, "video child uses video_url");
  assertEquals(g.calls[1].body.is_carousel_item, true);
  assert(g.calls[1].body.image_url, "image child uses image_url");
  assert(!("media_type" in g.calls[1].body), "image child sets no media_type");

  const sets = ctx.rpcCalls.filter((c) => c.fn === "set_carousel_child_field");
  assertEquals(sets.map((c) => [c.params.p_index, c.params.p_field, c.params.p_value]), [
    [1, "container_id", "c-1"],
    [2, "container_id", "c-2"],
  ]);
  assertEquals(children.map((c) => c.container_id), ["kept", "c-1", "c-2"]);
});

Deno.test("createMissingCarouselChildContainers: >10 media throws CAROUSEL_LIMIT before any Graph call", async () => {
  const media = Array.from({ length: 11 }, (_, i) => link(i, i + 1, "image"));
  const ctx = makeDb({ children: null, media });
  const g = stubGraph();
  let threw = "";
  try {
    await createMissingCarouselChildContainers(ctx.db, { postId: 1, igUserId: "ig", token: "t" });
  } catch (e) { threw = (e as Error).message; } finally { g.restore(); }
  assert(threw.includes("máximo 10"), `expected the cap message, got: ${threw}`);
  assertEquals(classifyPublishError(new Error(threw)), "CAROUSEL_LIMIT");
  assertEquals(g.calls.length, 0);
});

const { pollCarouselChildrenReady } = await import("../_shared/instagram-publish-utils.ts");

const twoMedia = [link(0, 11, "image"), link(1, 12, "video")];

Deno.test("pollCarouselChildrenReady marks FINISHED children ready, persists it, reports allReady", async () => {
  const ctx = makeDb({
    children: [
      { file_id: 11, kind: "image", container_id: "c-1", ready: true },  // already ready: not polled
      { file_id: 12, kind: "video", container_id: "c-2", ready: false },
    ],
    media: twoMedia,
  });
  const g = stubGraph(() => "FINISHED");
  let result;
  try {
    result = await pollCarouselChildrenReady(ctx.db, { postId: 1, igUserId: "ig", token: "t", maxPolls: 1, intervalMs: 1 });
  } finally { g.restore(); }
  assertEquals(result.allReady, true);
  assertEquals(g.calls.length, 1, "only the unready child is polled");
  assert(g.calls[0].url.includes("/c-2?"), "polls the unready child's container");
  const readySets = ctx.rpcCalls.filter((c) => c.fn === "set_carousel_child_field" && c.params.p_field === "ready");
  assertEquals(readySets.map((c) => [c.params.p_index, c.params.p_value]), [[1, true]]);
});

Deno.test("pollCarouselChildrenReady leaves an IN_PROGRESS child for the next tick without throwing", async () => {
  const ctx = makeDb({
    children: [
      { file_id: 11, kind: "image", container_id: "c-1", ready: false },
      { file_id: 12, kind: "video", container_id: "c-2", ready: false },
    ],
    media: twoMedia,
  });
  const g = stubGraph((id) => (id === "c-2" ? "IN_PROGRESS" : "FINISHED"));
  let result;
  try {
    result = await pollCarouselChildrenReady(ctx.db, { postId: 1, igUserId: "ig", token: "t", maxPolls: 2, intervalMs: 1 });
  } finally { g.restore(); }
  assertEquals(result.allReady, false);
  // round 1 polls both (c-1 FINISHED, c-2 IN_PROGRESS); round 2 polls only c-2.
  assertEquals(g.calls.length, 3, "bounded: maxPolls rounds, only pending children per round");
  assertEquals(result.children[0].ready, true);
  assertEquals(result.children[1].ready, false);
  assertEquals(result.children[1].container_id, "c-2", "IN_PROGRESS must NOT clear the container");
  const readySets = ctx.rpcCalls.filter((c) => c.fn === "set_carousel_child_field" && c.params.p_field === "ready");
  assertEquals(readySets.length, 1, "only the FINISHED child is persisted as ready");
});

Deno.test("pollCarouselChildrenReady: ERROR clears that child's container_id, persists it, and throws MEDIA_UNSUPPORTED wording", async () => {
  const ctx = makeDb({
    children: [
      { file_id: 11, kind: "image", container_id: "c-1", ready: false },
      { file_id: 12, kind: "video", container_id: "c-2", ready: false },
    ],
    media: twoMedia,
  });
  const g = stubGraph((id) => (id === "c-2" ? "ERROR" : "FINISHED"));
  let threw = "";
  try {
    await pollCarouselChildrenReady(ctx.db, { postId: 1, igUserId: "ig", token: "t", maxPolls: 1, intervalMs: 1 });
  } catch (e) { threw = (e as Error).message; } finally { g.restore(); }
  assertEquals(threw, "Item 2 do carrossel falhou no processamento do Instagram");
  assertEquals(classifyPublishError(new Error(threw)), "MEDIA_UNSUPPORTED");
  const cleared = ctx.rpcCalls.find((c) =>
    c.fn === "set_carousel_child_field" && c.params.p_index === 1 &&
    c.params.p_field === "container_id" && c.params.p_value === null
  );
  assert(cleared, "must clear the failed child's container_id so the next tick recreates it");
  // The sibling that FINISHED in the same round keeps its progress.
  assertEquals(ctx.children[0], { file_id: 11, kind: "image", container_id: "c-1", ready: true });
  assertEquals(ctx.children[1], { file_id: 12, kind: "video", container_id: null, ready: false });
});

Deno.test("pollCarouselChildrenReady: a child without a container is not polled and blocks allReady", async () => {
  const ctx = makeDb({
    children: [
      { file_id: 11, kind: "image", container_id: "c-1", ready: true },
      { file_id: 12, kind: "video", container_id: null, ready: false },
    ],
    media: twoMedia,
  });
  const g = stubGraph();
  let result;
  try {
    result = await pollCarouselChildrenReady(ctx.db, { postId: 1, igUserId: "ig", token: "t", maxPolls: 3, intervalMs: 1 });
  } finally { g.restore(); }
  assertEquals(result.allReady, false);
  assertEquals(g.calls.length, 0, "nothing to poll");
});

Deno.test("pollCarouselChildrenReady returns allReady=false for an empty children array", async () => {
  const ctx = makeDb({ children: [], media: [] });
  const g = stubGraph();
  let result;
  try {
    result = await pollCarouselChildrenReady(ctx.db, { postId: 1, igUserId: "ig", token: "t", maxPolls: 1, intervalMs: 1 });
  } finally { g.restore(); }
  assertEquals(result.allReady, false, "empty must never report ready (mirrors publishReadyStorySegments)");
});
