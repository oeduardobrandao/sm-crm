// OpenRouter provider adapter (Unified Image API): request-shape fidelity, b64_json + data-URL
// response parsing, IHDR-wins dims, one-retry-on-429/5xx, moderation → safety taxonomy, and the
// shared resolve.ts provider selection. Same stubbed-fetch pattern as
// instagram-publish-cover_test.ts.
import { assert, assertEquals } from "./assert.ts";
import { createOpenRouterProvider } from "../_shared/image-gen/openrouter.ts";
import {
  ProviderError,
  ProviderSafetyError,
  type ImageGenRequest,
} from "../_shared/image-gen/provider.ts";

/** Local stand-in for std's assertRejects — ./assert.ts deliberately stays tiny. */
// deno-lint-ignore no-explicit-any
async function assertRejects(fn: () => Promise<unknown>, ErrClass: new (...a: any[]) => Error) {
  try {
    await fn();
  } catch (e) {
    assert(e instanceof ErrClass, `expected ${ErrClass.name}, got ${(e as Error)?.constructor?.name}`);
    return;
  }
  throw new Error(`expected ${ErrClass.name}, but nothing was thrown`);
}

// deno-lint-ignore no-explicit-any
function stubFetch(responses: Array<() => Promise<Response>>) {
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  const calls: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
  let i = 0;
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    return next();
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** A minimal PNG whose IHDR declares the given dims (mirrors image-gen-core_test's fixture). */
function pngBytes(width: number, height: number): Uint8Array {
  const png = new Uint8Array(32);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return png;
}

function b64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function baseReq(overrides: Partial<ImageGenRequest> = {}): ImageGenRequest {
  return { prompt: "fundo dourado", aspectRatio: "4:5", imageSize: "1K", ...overrides };
}

function okImage(width = 1024, height = 1280) {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify({ data: [{ b64_json: b64(pngBytes(width, height)) }] }), {
        status: 200,
      }),
    );
}

Deno.test("openrouter: request carries model/prompt/aspect_ratio/resolution/output_format + bearer auth", async () => {
  const f = stubFetch([okImage()]);
  try {
    const provider = createOpenRouterProvider("or-key-123");
    await provider.generate(baseReq({ imageSize: "2K", aspectRatio: "9:16" }));
    assertEquals(f.calls.length, 1);
    assertEquals(f.calls[0].url, "https://openrouter.ai/api/v1/images");
    assertEquals(f.calls[0].headers["Authorization"], "Bearer or-key-123");
    assertEquals(f.calls[0].body.model, "google/gemini-3.1-flash-image");
    assertEquals(f.calls[0].body.prompt, "fundo dourado");
    assertEquals(f.calls[0].body.aspect_ratio, "9:16");
    assertEquals(f.calls[0].body.resolution, "2K");
    assertEquals(f.calls[0].body.output_format, "png");
    assertEquals(f.calls[0].body.input_references, undefined);
  } finally {
    f.restore();
  }
});

Deno.test("openrouter: IHDR dims win; cost keyed by requested size", async () => {
  const f = stubFetch([okImage(2048, 2560)]);
  try {
    const provider = createOpenRouterProvider("k");
    const result = await provider.generate(baseReq({ imageSize: "2K" }));
    assertEquals(result.width, 2048);
    assertEquals(result.height, 2560);
    assertEquals(result.mime, "image/png");
    assertEquals(result.costEstimateUsd, 0.101);
    assertEquals(result.model, "google/gemini-3.1-flash-image");
  } finally {
    f.restore();
  }
});

Deno.test("openrouter: references ride as input_references data URLs", async () => {
  const f = stubFetch([okImage()]);
  try {
    const provider = createOpenRouterProvider("k");
    await provider.generate(
      baseReq({ references: [{ bytes: new Uint8Array([1, 2, 3]), mime: "image/png" }] }),
    );
    const refs = f.calls[0].body.input_references;
    assertEquals(refs.length, 1);
    assertEquals(refs[0].type, "image_url");
    assert(refs[0].image_url.url.startsWith("data:image/png;base64,"));
  } finally {
    f.restore();
  }
});

Deno.test("openrouter: a data-URL response shape (url instead of b64_json) still parses", async () => {
  const dataUrl = `data:image/png;base64,${b64(pngBytes(512, 640))}`;
  const f = stubFetch([
    () =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ url: dataUrl }] }), { status: 200 }),
      ),
  ]);
  try {
    const provider = createOpenRouterProvider("k");
    const result = await provider.generate(baseReq());
    assertEquals(result.width, 512);
    assertEquals(result.height, 640);
  } finally {
    f.restore();
  }
});

Deno.test("openrouter: 429 then 200 → one retry, success", async () => {
  const f = stubFetch([
    () => Promise.resolve(new Response("rate limited", { status: 429 })),
    okImage(),
  ]);
  try {
    const provider = createOpenRouterProvider("k");
    const result = await provider.generate(baseReq());
    assertEquals(f.calls.length, 2);
    assertEquals(result.width, 1024);
  } finally {
    f.restore();
  }
});

Deno.test("openrouter: 5xx twice → ProviderError, exactly two attempts", async () => {
  const f = stubFetch([() => Promise.resolve(new Response("boom", { status: 502 }))]);
  try {
    const provider = createOpenRouterProvider("k");
    await assertRejects(() => provider.generate(baseReq()), ProviderError);
    assertEquals(f.calls.length, 2);
  } finally {
    f.restore();
  }
});

Deno.test("openrouter: plain 4xx → ProviderError with NO retry", async () => {
  const f = stubFetch([
    () => Promise.resolve(new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 })),
  ]);
  try {
    const provider = createOpenRouterProvider("k");
    await assertRejects(() => provider.generate(baseReq()), ProviderError);
    assertEquals(f.calls.length, 1);
  } finally {
    f.restore();
  }
});

Deno.test("openrouter: 403 moderation body → ProviderSafetyError (never counts quota)", async () => {
  const f = stubFetch([
    () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: { message: "Your input was flagged by moderation" } }),
          { status: 403 },
        ),
      ),
  ]);
  try {
    const provider = createOpenRouterProvider("k");
    await assertRejects(() => provider.generate(baseReq()), ProviderSafetyError);
  } finally {
    f.restore();
  }
});

Deno.test("openrouter: 200 with empty data → ProviderSafetyError (refusal taxonomy)", async () => {
  const f = stubFetch([
    () => Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 })),
  ]);
  try {
    const provider = createOpenRouterProvider("k");
    await assertRejects(() => provider.generate(baseReq()), ProviderSafetyError);
  } finally {
    f.restore();
  }
});

// ── resolve.ts selection ─────────────────────────────────────────────────────

Deno.test("resolveImageProvider: OpenRouter key wins over Gemini; neither → null", async () => {
  const { resolveImageProvider } = await import("../_shared/image-gen/resolve.ts");
  const saved = {
    or: Deno.env.get("OPEN_ROUTER_API_KEY"),
    or2: Deno.env.get("OPENROUTER_API_KEY"),
    gem: Deno.env.get("GEMINI_API_KEY"),
  };
  try {
    Deno.env.delete("OPEN_ROUTER_API_KEY");
    Deno.env.delete("OPENROUTER_API_KEY");
    Deno.env.delete("GEMINI_API_KEY");
    assertEquals(resolveImageProvider(), null);

    Deno.env.set("GEMINI_API_KEY", "g");
    assert(resolveImageProvider() !== null);

    // With BOTH set, OpenRouter is selected — proven by the endpoint the provider calls.
    Deno.env.set("OPEN_ROUTER_API_KEY", "or");
    const provider = resolveImageProvider()!;
    const f = stubFetch([okImage()]);
    try {
      await provider.generate(baseReq());
      assert(f.calls[0].url.includes("openrouter.ai"));
    } finally {
      f.restore();
    }
  } finally {
    for (const [k, v] of [
      ["OPEN_ROUTER_API_KEY", saved.or],
      ["OPENROUTER_API_KEY", saved.or2],
      ["GEMINI_API_KEY", saved.gem],
    ] as const) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
});
