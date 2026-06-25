import { assert, assertEquals } from "./assert.ts";

// signGetUrl presigns locally (no network) but reads R2 env lazily — give it dummy
// creds so createContainerForPost can build media URLs under test.
Deno.env.set("R2_ACCOUNT_ID", "acct");
Deno.env.set("R2_ACCESS_KEY_ID", "akid");
Deno.env.set("R2_SECRET_ACCESS_KEY", "secret");
Deno.env.set("R2_BUCKET", "bucket");

const { createContainerForPost } = await import("../_shared/instagram-publish-utils.ts");

// deno-lint-ignore no-explicit-any
function stubFetch() {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; body: any }> = [];
  let n = 0;
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    n += 1;
    return Promise.resolve(new Response(JSON.stringify({ id: `c-${n}` }), { status: 200 }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

interface MediaSpec {
  kind: string;
  r2_key: string;
  thumbnail_r2_key?: string | null;
}

// Minimal db that satisfies fetchPostMedia's
// from(t).select(s).eq(c,v).order(col,opts) -> { data }
function dbWithMedia(media: MediaSpec[]) {
  const data = media.map((m, i) => ({
    sort_order: i,
    files: {
      id: i + 1,
      kind: m.kind,
      r2_key: m.r2_key,
      thumbnail_r2_key: m.thumbnail_r2_key ?? null,
    },
  }));
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data }),
        }),
      }),
    }),
    // deno-lint-ignore no-explicit-any
  } as any;
}

const base = { igUserId: "ig", token: "tok", postId: 1, caption: "cap" };

Deno.test("createContainerForPost: single image → image container, no cover", async () => {
  const f = stubFetch();
  try {
    const db = dbWithMedia([{ kind: "image", r2_key: "img/1.jpg" }]);
    const res = await createContainerForPost(db, { ...base, useCover: false });
    assertEquals(f.calls.length, 1);
    assert(f.calls[0].body.image_url, "image_url must be present");
    assert(!("media_type" in f.calls[0].body), "image must not set media_type");
    assertEquals(f.calls[0].body.caption, "cap");
    assertEquals(res.containerId, "c-1");
    assertEquals(res.coverVideoUrl, undefined);
  } finally {
    f.restore();
  }
});

Deno.test("createContainerForPost: story image → STORIES image container without caption", async () => {
  const f = stubFetch();
  try {
    const db = dbWithMedia([{ kind: "image", r2_key: "img/story.jpg" }]);
    const res = await createContainerForPost(db, { ...base, tipo: "stories", useCover: false });
    assertEquals(f.calls.length, 1);
    assertEquals(f.calls[0].body.media_type, "STORIES");
    assert(f.calls[0].body.image_url, "image_url must be present");
    assert(!("caption" in f.calls[0].body), "story image must not send caption");
    assertEquals(res.containerId, "c-1");
    assertEquals(res.coverVideoUrl, undefined);
  } finally {
    f.restore();
  }
});

Deno.test("createContainerForPost: story video → STORIES video container without cover", async () => {
  const f = stubFetch();
  try {
    const db = dbWithMedia([{ kind: "video", r2_key: "v/story.mp4", thumbnail_r2_key: "v/story.jpg" }]);
    const res = await createContainerForPost(db, { ...base, tipo: "stories", useCover: true });
    assertEquals(f.calls.length, 1);
    assertEquals(f.calls[0].body.media_type, "STORIES");
    assert(f.calls[0].body.video_url, "video_url must be present");
    assert(!("caption" in f.calls[0].body), "story video must not send caption");
    assert(!("cover_url" in f.calls[0].body), "story video must not send a cover");
    assertEquals(res.containerId, "c-1");
    assertEquals(res.coverVideoUrl, undefined);
  } finally {
    f.restore();
  }
});

Deno.test("createContainerForPost: single video useCover:true + thumbnail → cover_url + coverVideoUrl", async () => {
  const f = stubFetch();
  try {
    const db = dbWithMedia([{ kind: "video", r2_key: "v/1.mp4", thumbnail_r2_key: "v/1.jpg" }]);
    const res = await createContainerForPost(db, { ...base, useCover: true });
    assertEquals(f.calls.length, 1);
    assertEquals(f.calls[0].body.media_type, "REELS");
    assert(f.calls[0].body.cover_url, "cover_url must be present when useCover + thumbnail");
    // coverVideoUrl is the *video* URL so a caller can rebuild coverless on ERROR.
    assertEquals(res.coverVideoUrl, f.calls[0].body.video_url);
  } finally {
    f.restore();
  }
});

Deno.test("createContainerForPost: single video useCover:false → no cover, no coverVideoUrl", async () => {
  const f = stubFetch();
  try {
    const db = dbWithMedia([{ kind: "video", r2_key: "v/1.mp4", thumbnail_r2_key: "v/1.jpg" }]);
    const res = await createContainerForPost(db, { ...base, useCover: false });
    assert(!("cover_url" in f.calls[0].body), "cover_url must be absent when useCover:false");
    assertEquals(res.coverVideoUrl, undefined);
  } finally {
    f.restore();
  }
});

Deno.test("createContainerForPost: video useCover:true but no thumbnail → no cover", async () => {
  const f = stubFetch();
  try {
    const db = dbWithMedia([{ kind: "video", r2_key: "v/1.mp4", thumbnail_r2_key: null }]);
    const res = await createContainerForPost(db, { ...base, useCover: true });
    assert(!("cover_url" in f.calls[0].body), "no thumbnail → no cover_url even with useCover");
    assertEquals(res.coverVideoUrl, undefined);
  } finally {
    f.restore();
  }
});

Deno.test("createContainerForPost: multiple media → carousel children + parent", async () => {
  const f = stubFetch();
  try {
    const db = dbWithMedia([
      { kind: "image", r2_key: "a.jpg" },
      { kind: "video", r2_key: "b.mp4" },
    ]);
    const res = await createContainerForPost(db, { ...base, useCover: true });
    assertEquals(f.calls.length, 3); // 2 children + 1 parent
    assertEquals(f.calls[0].body.is_carousel_item, true);
    assertEquals(f.calls[1].body.is_carousel_item, true);
    const parent = f.calls[2].body;
    assertEquals(parent.media_type, "CAROUSEL");
    assertEquals(parent.children, "c-1,c-2");
    assertEquals(res.containerId, "c-3");
    assertEquals(res.coverVideoUrl, undefined); // carousels never carry a Reel cover
  } finally {
    f.restore();
  }
});

Deno.test("createContainerForPost: no media → throws", async () => {
  const db = dbWithMedia([]);
  let threw = false;
  try {
    await createContainerForPost(db, { ...base, useCover: false });
  } catch {
    threw = true;
  }
  assert(threw, "must throw when the post has no media");
});

Deno.test("createContainerForPost: >10 media → throws before any Graph call", async () => {
  const f = stubFetch();
  try {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      kind: "image",
      r2_key: `img/${i}.jpg`,
    }));
    const db = dbWithMedia(eleven);
    let threw = false;
    try {
      await createContainerForPost(db, { ...base, useCover: false });
    } catch (e) {
      threw = true;
      assert(
        (e as Error).message.includes("máximo 10"),
        "error should mention the 10-item carousel cap",
      );
    }
    assert(threw, "must throw when the post has more than 10 media");
    assertEquals(f.calls.length, 0); // no child/parent container call was made
  } finally {
    f.restore();
  }
});
