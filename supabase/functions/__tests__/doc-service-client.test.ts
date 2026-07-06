import { assert, assertEquals } from "./assert.ts";
import { createDocServiceClient, decodeFrame, DocServiceError, encodeFrame } from "../_shared/doc-service.ts";

// deno-lint-ignore no-explicit-any
function stubFetch(response: (input: unknown, init?: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response(input, init);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function errorResponse(error: string, status = 422) {
  return Promise.resolve(new Response(JSON.stringify({ error }), { status }));
}

Deno.test("describe: posts raw bytes, returns the projection", async () => {
  const f = stubFetch(() =>
    Promise.resolve(new Response(JSON.stringify({ projection: { pages: [] }, ms: 3 }), { status: 200 }))
  );
  try {
    const client = createDocServiceClient("https://svc", "secret");
    const projection = await client.describe(new Uint8Array([1, 2, 3]));
    assertEquals(projection, { pages: [] });
    assertEquals(f.calls.length, 1);
    assertEquals(f.calls[0].url, "https://svc/api/describe");
    assertEquals((f.calls[0].init?.headers as Record<string, string>).authorization, "Bearer secret");
  } finally {
    f.restore();
  }
});

Deno.test("describe: non-ok response throws DocServiceError with the coded error", async () => {
  const f = stubFetch(() => errorResponse("describe_failed"));
  try {
    const client = createDocServiceClient("https://svc", "secret");
    await assertRejectsWithCode(() => client.describe(new Uint8Array([1])), "describe_failed");
  } finally {
    f.restore();
  }
});

Deno.test("mutate: frames ops+bytes, decodes the returned MDF1 frame", async () => {
  const outBytes = new Uint8Array([9, 9, 9]);
  const framed = encodeFrame({ projection: { pages: [] }, applied: 2, ms: 5 }, outBytes);
  const f = stubFetch((_input, init) => {
    const sent = decodeFrame(new Uint8Array(init!.body as ArrayBuffer));
    assertEquals(sent.json, { ops: [{ op: "set_text" }] });
    return Promise.resolve(new Response(framed.buffer as ArrayBuffer, { status: 200 }));
  });
  try {
    const client = createDocServiceClient("https://svc", "secret");
    const result = await client.mutate(new Uint8Array([1, 2]), [{ op: "set_text" }]);
    assertEquals(result.applied, 2);
    assertEquals([...result.bytes], [9, 9, 9]);
  } finally {
    f.restore();
  }
});

Deno.test("render: sends x-post-tipo header, returns pages", async () => {
  const f = stubFetch((_input, init) => {
    assertEquals((init?.headers as Record<string, string>)["x-post-tipo"], "carrossel");
    return Promise.resolve(
      new Response(JSON.stringify({ pages: [{ frame_id: "1:2", width: 1080, height: 1350, jpeg_b64: "AA==" }] }), {
        status: 200,
      }),
    );
  });
  try {
    const client = createDocServiceClient("https://svc", "secret");
    const result = await client.render(new Uint8Array([1]), "carrossel");
    assertEquals(result.pages.length, 1);
    assertEquals(result.pages[0].frame_id, "1:2");
  } finally {
    f.restore();
  }
});

Deno.test("normalize: posts JSON spec, returns raw JPEG bytes", async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xaa]);
  const f = stubFetch((_input, init) => {
    const body = JSON.parse(String(init?.body));
    assertEquals(body, { image: { url: "https://x/a.png" }, preset: "1:1" });
    assertEquals((init?.headers as Record<string, string>)["content-type"], "application/json");
    return Promise.resolve(new Response(jpeg.buffer as ArrayBuffer, { status: 200 }));
  });
  try {
    const client = createDocServiceClient("https://svc", "secret");
    const result = await client.normalize({ image: { url: "https://x/a.png" }, preset: "1:1" });
    assertEquals([...result], [...jpeg]);
    assertEquals(f.calls[0].url, "https://svc/api/normalize");
  } finally {
    f.restore();
  }
});

Deno.test("normalize: non-ok -> DocServiceError with coded error", async () => {
  const f = stubFetch(() => errorResponse("image_fetch_failed"));
  try {
    const client = createDocServiceClient("https://svc", "secret");
    await assertRejectsWithCode(
      () => client.normalize({ image: { url: "https://x/missing.png" }, preset: "1:1" }),
      "image_fetch_failed",
    );
  } finally {
    f.restore();
  }
});

Deno.test("compose: posts JSON spec, returns raw .fig bytes", async () => {
  const figBytes = new Uint8Array([1, 2, 3, 4, 5]);
  const spec = {
    preset: "4:5" as const,
    frames: [{ name: "1", image: { url: "https://x/a.png" } }],
    texts: [{ frame: 0, text: "hi", bbox: { x: 0, y: 0, w: 1, h: 1 }, size: 0.1 }],
  };
  const f = stubFetch((_input, init) => {
    const body = JSON.parse(String(init?.body));
    assertEquals(body, spec);
    return Promise.resolve(new Response(figBytes.buffer as ArrayBuffer, { status: 200 }));
  });
  try {
    const client = createDocServiceClient("https://svc", "secret");
    const result = await client.compose(spec);
    assertEquals([...result], [...figBytes]);
    assertEquals(f.calls[0].url, "https://svc/api/compose");
  } finally {
    f.restore();
  }
});

Deno.test("compose: non-ok -> DocServiceError with coded error", async () => {
  const f = stubFetch(() => errorResponse("invalid_compose_spec"));
  try {
    const client = createDocServiceClient("https://svc", "secret");
    await assertRejectsWithCode(
      () => client.compose({ preset: "1:1", frames: [] }),
      "invalid_compose_spec",
    );
  } finally {
    f.restore();
  }
});

async function assertRejectsWithCode(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (err) {
    assert(err instanceof DocServiceError, `expected DocServiceError, got ${err}`);
    assertEquals((err as DocServiceError).code, code);
    return;
  }
  throw new Error(`expected rejection with code ${code}, but the call succeeded`);
}
