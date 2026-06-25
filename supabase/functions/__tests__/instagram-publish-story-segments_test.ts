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

const { createMissingStorySegmentContainers, publishReadyStorySegments } = await import(
  "../_shared/instagram-publish-utils.ts"
);

// db stub that also records set_story_segment_field rpc calls and returns scripted segments
// deno-lint-ignore no-explicit-any
function makeRpcDb(opts: {
  segments: any[];
  media?: Array<{ sort_order: number; files: { id: number; kind: string; r2_key: string; thumbnail_r2_key: string | null } }>;
}) {
  const rpcCalls: Array<{ fn: string; params: any }> = [];
  let segs = opts.segments;
  const db: any = {
    from(table: string) {
      return {
        select() { return this; },
        eq() { return this; },
        order() { return Promise.resolve({ data: opts.media ?? [] }); },
        single() { return Promise.resolve({ data: table === "workflow_posts" ? { story_segments: segs } : null }); },
        update() { return { eq() { return Promise.resolve({ data: null }); } }; },
      };
    },
    rpc(fn: string, params: any) {
      rpcCalls.push({ fn, params });
      if (fn === "set_story_segment_field") {
        segs = segs.map((s, i) => (i === params.p_index ? { ...s, [params.p_field]: params.p_value } : s));
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { db, rpcCalls, get segments() { return segs; } };
}

// deno-lint-ignore no-explicit-any
function stubFetch(responder: (url: string, body: any, n: number) => any) {
  const original = globalThis.fetch;
  let n = 0;
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    n += 1;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    return Promise.resolve(new Response(JSON.stringify(responder(String(input), body, n)), { status: 200 }));
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

Deno.test("createMissingStorySegmentContainers creates STORIES container per empty segment", async () => {
  const ctx = makeRpcDb({
    segments: [
      { file_id: 11, container_id: null, media_id: null },
      { file_id: 12, container_id: "already", media_id: null },
    ],
    media: [
      { sort_order: 0, files: { id: 11, kind: "image", r2_key: "a.jpg", thumbnail_r2_key: null } },
      { sort_order: 1, files: { id: 12, kind: "video", r2_key: "b.mp4", thumbnail_r2_key: null } },
    ],
  });
  const bodies: any[] = [];
  const restore = stubFetch((_url, body, n) => { bodies.push(body); return { id: `cont-${n}` }; });
  try {
    await createMissingStorySegmentContainers(ctx.db, { postId: 1, igUserId: "ig", token: "t" });
  } finally { restore(); }

  // Only segment 0 (container_id null) gets created
  assertEquals(bodies.length, 1);
  assertEquals(bodies[0].media_type, "STORIES");
  assert(bodies[0].image_url, "image segment uses image_url");
  assert(!("caption" in bodies[0]), "stories carry no caption");
  // persisted via rpc for index 0
  const setCall = ctx.rpcCalls.find((c) => c.fn === "set_story_segment_field");
  assertEquals(setCall?.params.p_index, 0);
  assertEquals(setCall?.params.p_field, "container_id");
});

Deno.test("publishReadyStorySegments publishes ready segments and reports allDone", async () => {
  const ctx = makeRpcDb({
    segments: [
      { file_id: 11, container_id: "c1", media_id: null },
      { file_id: 12, container_id: "c2", media_id: null },
    ],
  });
  // GET status -> FINISHED; POST media_publish -> {id}
  const restore = stubFetch((url, _body, n) => {
    if (url.includes("media_publish")) return { id: `media-${n}` };
    return { status_code: "FINISHED" };
  });
  let result;
  try {
    result = await publishReadyStorySegments(ctx.db, { postId: 1, igUserId: "ig", token: "t", maxPolls: 1, intervalMs: 1 });
  } finally { restore(); }
  assertEquals(result.allDone, true);
  const mediaSets = ctx.rpcCalls.filter((c) => c.fn === "set_story_segment_field" && c.params.p_field === "media_id");
  assertEquals(mediaSets.length, 2);
});

Deno.test("publishReadyStorySegments returns allDone=false for empty segments array", async () => {
  // story_segments is [] — no media linked, ensureStorySegments returns [] from DB
  const ctx = makeRpcDb({ segments: [], media: [] });
  let fetchCalled = false;
  const restore = stubFetch((_url, _body, _n) => { fetchCalled = true; return {}; });
  let result;
  try {
    result = await publishReadyStorySegments(ctx.db, { postId: 1, igUserId: "ig", token: "t", maxPolls: 1, intervalMs: 1 });
  } finally { restore(); }
  assertEquals(result.allDone, false, "empty segments must not report allDone=true");
  assert(!fetchCalled, "no media-publish call must occur for empty segments");
});

Deno.test("publishReadyStorySegments clears container_id and throws on ERROR", async () => {
  const ctx = makeRpcDb({ segments: [{ file_id: 11, container_id: "c1", media_id: null }] });
  const restore = stubFetch((_url) => ({ status_code: "ERROR" }));
  let threw = false;
  try {
    await publishReadyStorySegments(ctx.db, { postId: 1, igUserId: "ig", token: "t", maxPolls: 1, intervalMs: 1 });
  } catch { threw = true; } finally { restore(); }
  assert(threw, "must throw on ERROR");
  const cleared = ctx.rpcCalls.find((c) => c.fn === "set_story_segment_field" && c.params.p_field === "container_id" && c.params.p_value === null);
  assert(cleared, "must clear the failed segment container_id");
});
