import { assert, assertEquals } from "./assert.ts";
import { createVideoContainer } from "../_shared/instagram-publish-utils.ts";

// deno-lint-ignore no-explicit-any
function stubFetch(response: () => Promise<Response>) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; body: any }> = [];
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return response();
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function ok() {
  return Promise.resolve(
    new Response(JSON.stringify({ id: "container-123" }), { status: 200 }),
  );
}

Deno.test("createVideoContainer includes cover_url when a cover is provided", async () => {
  const f = stubFetch(ok);
  try {
    const res = await createVideoContainer(
      "ig-1", "tok", "https://v/video.mp4", "cap", "https://v/cover.jpg",
    );
    assertEquals(res.id, "container-123");
    assertEquals(f.calls.length, 1);
    assertEquals(f.calls[0].body.video_url, "https://v/video.mp4");
    assertEquals(f.calls[0].body.media_type, "REELS");
    assertEquals(f.calls[0].body.cover_url, "https://v/cover.jpg");
  } finally {
    f.restore();
  }
});

Deno.test("createVideoContainer omits cover_url when no cover is provided", async () => {
  const f = stubFetch(ok);
  try {
    await createVideoContainer("ig-1", "tok", "https://v/video.mp4", "cap");
    assert(!("cover_url" in f.calls[0].body), "cover_url must be absent");
  } finally {
    f.restore();
  }
});
