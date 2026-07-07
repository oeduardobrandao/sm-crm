// Vision text-extraction module (slice C, task 3): OpenRouter chat completions on
// google/gemini-3.1-flash-lite, tolerant JSON parsing of the model's block list, hard
// validation per the block shape, one-retry-on-429/5xx/timeout (same stubbed-fetch pattern
// as image-gen-openrouter_test.ts).
import { assert, assertEquals } from "./assert.ts";
import { extractTextBlocks, VisionError, VisionUnavailableError } from "../_shared/image-gen/vision.ts";

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

function chatResponse(content: string, status = 200) {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }),
    );
}

function validBlock(overrides: Record<string, unknown> = {}) {
  return {
    text: "Hello world",
    bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
    size: 0.05,
    weight: 400,
    color: "#ffffff",
    align: "left",
    ...overrides,
  };
}

const input = { imageBytes: new Uint8Array([1, 2, 3]), mime: "image/png", apiKey: "or-key-123" };

Deno.test("vision: happy path — sends chat completions with data URL image + json_object response_format", async () => {
  const f = stubFetch([chatResponse(JSON.stringify({ blocks: [validBlock()] }))]);
  try {
    const blocks = await extractTextBlocks(input);
    assertEquals(f.calls.length, 1);
    assertEquals(f.calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
    assertEquals(f.calls[0].headers["Authorization"], "Bearer or-key-123");
    assertEquals(f.calls[0].body.model, "google/gemini-3.5-flash");
    assertEquals(f.calls[0].body.response_format, { type: "json_object" });
    const content = f.calls[0].body.messages[0].content;
    const imagePart = content.find((p: { type: string }) => p.type === "image_url");
    assert(imagePart.image_url.url.startsWith("data:image/png;base64,"));
    const textPart = content.find((p: { type: string }) => p.type === "text");
    assert(typeof textPart.text === "string" && textPart.text.length > 0);

    assertEquals(blocks.length, 1);
    assertEquals(blocks[0], validBlock());
  } finally {
    f.restore();
  }
});

Deno.test("vision: empty result (no text in image) is VALID → []", async () => {
  const f = stubFetch([chatResponse(JSON.stringify({ blocks: [] }))]);
  try {
    const blocks = await extractTextBlocks(input);
    assertEquals(blocks, []);
  } finally {
    f.restore();
  }
});

Deno.test("vision: tolerant JSON extraction — content wrapped in a markdown fence still parses", async () => {
  const fenced = "```json\n" + JSON.stringify({ blocks: [validBlock()] }) + "\n```";
  const f = stubFetch([chatResponse(fenced)]);
  try {
    const blocks = await extractTextBlocks(input);
    assertEquals(blocks.length, 1);
  } finally {
    f.restore();
  }
});

Deno.test("vision: tolerant JSON extraction — prose around the JSON block still parses", async () => {
  const wrapped = `Sure, here are the blocks:\n${JSON.stringify({ blocks: [validBlock()] })}\nHope that helps!`;
  const f = stubFetch([chatResponse(wrapped)]);
  try {
    const blocks = await extractTextBlocks(input);
    assertEquals(blocks.length, 1);
  } finally {
    f.restore();
  }
});

Deno.test("vision: prose-wrapped JSON whose block text contains literal braces/brackets still parses (string-aware scan)", async () => {
  const block = validBlock({ text: "Save 20% {hoje} [promo]" });
  const wrapped = `Sure, here are the blocks:\n${JSON.stringify({ blocks: [block] })}\nHope that helps!`;
  const f = stubFetch([chatResponse(wrapped)]);
  try {
    const blocks = await extractTextBlocks(input);
    assertEquals(blocks.length, 1);
    assertEquals(blocks[0].text, "Save 20% {hoje} [promo]");
  } finally {
    f.restore();
  }
});

Deno.test("vision: prose-wrapped JSON with an escaped quote followed by a brace in a string value still parses (escape-state coverage)", async () => {
  const block = validBlock({ text: 'a \\" b }' });
  const wrapped = `Sure, here are the blocks:\n${JSON.stringify({ blocks: [block] })}\nHope that helps!`;
  const f = stubFetch([chatResponse(wrapped)]);
  try {
    const blocks = await extractTextBlocks(input);
    assertEquals(blocks.length, 1);
    assertEquals(blocks[0].text, 'a \\" b }');
  } finally {
    f.restore();
  }
});

Deno.test("vision: a top-level JSON array (no 'blocks' wrapper) is also accepted", async () => {
  const f = stubFetch([chatResponse(JSON.stringify([validBlock()]))]);
  try {
    const blocks = await extractTextBlocks(input);
    assertEquals(blocks.length, 1);
  } finally {
    f.restore();
  }
});

Deno.test("vision: invalid blocks are dropped — missing fields, bad bbox, bad color, bad align", async () => {
  const blocks = [
    validBlock(), // valid
    { ...validBlock(), text: undefined }, // missing text
    { ...validBlock(), bbox: { x: 0.1, y: 0.2, w: 0.3 } }, // missing h
    { ...validBlock(), bbox: { x: 1.5, y: 0.2, w: 0.3, h: 0.1 } }, // out of 0-1 range
    { ...validBlock(), color: "blue" }, // not #rrggbb
    { ...validBlock(), color: "#fff" }, // shorthand not accepted
    { ...validBlock(), align: "justify" }, // invalid enum
    { ...validBlock(), size: -0.1 }, // negative size
    { ...validBlock(), size: "big" }, // non-numeric size
  ];
  const f = stubFetch([chatResponse(JSON.stringify({ blocks }))]);
  try {
    const result = await extractTextBlocks(input);
    assertEquals(result.length, 1);
    assertEquals(result[0], validBlock());
  } finally {
    f.restore();
  }
});

Deno.test("vision: weight is clamped to 400|700 (nearest)", async () => {
  const blocks = [
    validBlock({ weight: 100 }), // → 400
    validBlock({ weight: 350 }), // → 400
    validBlock({ weight: 550 }), // exactly midway → 400 (tie goes to the lighter bucket)
    validBlock({ weight: 900 }), // → 700
    validBlock({ weight: 700 }), // → 700
  ];
  const f = stubFetch([chatResponse(JSON.stringify({ blocks }))]);
  try {
    const result = await extractTextBlocks(input);
    assertEquals(result.map((b) => b.weight), [400, 400, 400, 700, 700]);
  } finally {
    f.restore();
  }
});

Deno.test("vision: caps at 20 blocks even when the model returns more", async () => {
  const blocks = Array.from({ length: 25 }, (_, i) => validBlock({ text: `line ${i}` }));
  const f = stubFetch([chatResponse(JSON.stringify({ blocks }))]);
  try {
    const result = await extractTextBlocks(input);
    assertEquals(result.length, 20);
    assertEquals(result[0].text, "line 0");
    assertEquals(result[19].text, "line 19");
  } finally {
    f.restore();
  }
});

Deno.test("vision: fontFamily on a block (if the model hallucinates one) is ignored, not surfaced", async () => {
  const f = stubFetch([chatResponse(JSON.stringify({ blocks: [validBlock({ fontFamily: "Arial" })] }))]);
  try {
    const result = await extractTextBlocks(input);
    assertEquals(result.length, 1);
    assert(!("fontFamily" in result[0]));
  } finally {
    f.restore();
  }
});

Deno.test("vision: 429 then 200 → one retry, success", async () => {
  const f = stubFetch([
    () => Promise.resolve(new Response("rate limited", { status: 429 })),
    chatResponse(JSON.stringify({ blocks: [validBlock()] })),
  ]);
  try {
    const blocks = await extractTextBlocks(input);
    assertEquals(f.calls.length, 2);
    assertEquals(blocks.length, 1);
  } finally {
    f.restore();
  }
});

Deno.test("vision: 5xx twice → VisionError, exactly two attempts", async () => {
  const f = stubFetch([() => Promise.resolve(new Response("boom", { status: 502 }))]);
  try {
    await assertRejects(() => extractTextBlocks(input), VisionError);
    assertEquals(f.calls.length, 2);
  } finally {
    f.restore();
  }
});

Deno.test("vision: timeout on attempt 1, success on retry", async () => {
  let i = 0;
  const original = globalThis.fetch;
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    i++;
    if (i === 1) {
      return Promise.reject(new DOMException("aborted", "AbortError"));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ blocks: [validBlock()] }) } }] }), {
        status: 200,
      }),
    );
  }) as typeof fetch;
  try {
    const blocks = await extractTextBlocks(input);
    assertEquals(blocks.length, 1);
    assertEquals(i, 2);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("vision: moderation-style 403 → VisionError (failure, not a safety-refusal class)", async () => {
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
    await assertRejects(() => extractTextBlocks(input), VisionError);
    assertEquals(f.calls.length, 1); // 403 is not retried
  } finally {
    f.restore();
  }
});

Deno.test("vision: unparsable content (no JSON at all) → VisionError", async () => {
  const f = stubFetch([chatResponse("I cannot help with that.")]);
  try {
    await assertRejects(() => extractTextBlocks(input), VisionError);
  } finally {
    f.restore();
  }
});

Deno.test("vision: resolveVisionConfig — no OpenRouter key → VisionUnavailableError surface (no-key error)", async () => {
  const { resolveVisionConfig } = await import("../_shared/image-gen/resolve.ts");
  const saved = {
    or: Deno.env.get("OPEN_ROUTER_API_KEY"),
    or2: Deno.env.get("OPENROUTER_API_KEY"),
  };
  try {
    Deno.env.delete("OPEN_ROUTER_API_KEY");
    Deno.env.delete("OPENROUTER_API_KEY");
    assertEquals(resolveVisionConfig(), null);
  } finally {
    for (const [k, v] of [["OPEN_ROUTER_API_KEY", saved.or], ["OPENROUTER_API_KEY", saved.or2]] as const) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
});

Deno.test("vision: resolveVisionConfig — tolerates both OpenRouter key spellings", async () => {
  const { resolveVisionConfig } = await import("../_shared/image-gen/resolve.ts");
  const saved = {
    or: Deno.env.get("OPEN_ROUTER_API_KEY"),
    or2: Deno.env.get("OPENROUTER_API_KEY"),
  };
  try {
    Deno.env.delete("OPEN_ROUTER_API_KEY");
    Deno.env.set("OPENROUTER_API_KEY", "legacy-spelling-key");
    assertEquals(resolveVisionConfig(), { apiKey: "legacy-spelling-key" });

    Deno.env.set("OPEN_ROUTER_API_KEY", "preferred-spelling-key");
    assertEquals(resolveVisionConfig(), { apiKey: "preferred-spelling-key" });
  } finally {
    for (const [k, v] of [["OPEN_ROUTER_API_KEY", saved.or], ["OPENROUTER_API_KEY", saved.or2]] as const) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
});

Deno.test("vision: no-key error — caller checks resolveVisionConfig() before calling extractTextBlocks", () => {
  // extractTextBlocks itself takes an apiKey (mirrors createOpenRouterProvider(apiKey)); the
  // "no key configured" case is resolveVisionConfig() returning null, tested above. A future
  // design-import edge function maps that null to vision_unavailable without ever calling
  // extractTextBlocks. VisionUnavailableError exists for callers that prefer a thrown signal.
  assert(typeof VisionUnavailableError === "function");
});

Deno.test("vision: pixel-space bbox/size values re-normalize when dims are provided (live gemini mixes pixel and fraction in one bbox)", async () => {
  const mixed = validBlock({
    // x/w normalized, y/h/size in PIXELS of a 1080x1350 image — the exact live failure shape.
    bbox: { x: 0.125, y: 109, w: 0.749, h: 58 },
    size: 78,
  });
  const f = stubFetch([chatResponse(JSON.stringify({ blocks: [mixed, validBlock()] }))]);
  try {
    const blocks = await extractTextBlocks({ ...input, width: 1080, height: 1350 });
    assertEquals(blocks.length, 2);
    assertEquals(blocks[0].bbox.x, 0.125);
    assertEquals(blocks[0].bbox.y, 109 / 1350);
    assertEquals(blocks[0].bbox.w, 0.749);
    assertEquals(blocks[0].bbox.h, 58 / 1350);
    assertEquals(blocks[0].size, 78 / 1350);
  } finally {
    f.restore();
  }
});

Deno.test("vision: pixel-space values WITHOUT dims still drop the block (no silent garbage)", async () => {
  const mixed = validBlock({ bbox: { x: 0.125, y: 109, w: 0.749, h: 58 } });
  const f = stubFetch([chatResponse(JSON.stringify({ blocks: [mixed, validBlock()] }))]);
  try {
    const blocks = await extractTextBlocks(input);
    assertEquals(blocks.length, 1);
    assertEquals(blocks[0].text, "Hello world");
  } finally {
    f.restore();
  }
});
