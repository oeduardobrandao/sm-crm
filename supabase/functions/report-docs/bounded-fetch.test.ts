import { assert, assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { makeBoundedFetch } from "./bounded-fetch.ts";

// deno-lint-ignore no-explicit-any
function stubFetch() {
  const original = globalThis.fetch;
  const calls: Array<{ input: unknown; init?: RequestInit }> = [];
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    calls.push({ input, init });
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

Deno.test("makeBoundedFetch: sem signal explícito, impõe um AbortSignal (teto de timeout)", async () => {
  const f = stubFetch();
  try {
    const bounded = makeBoundedFetch(1_000);
    await bounded("https://example.com/rest/v1/x", { method: "GET" });
    assertEquals(f.calls.length, 1);
    const passedSignal = f.calls[0].init?.signal;
    assertExists(passedSignal);
    assert(passedSignal instanceof AbortSignal, "deveria ter recebido um AbortSignal");
  } finally {
    f.restore();
  }
});

Deno.test("makeBoundedFetch: signal explícito do chamador passa intocado (não é sobrescrito)", async () => {
  const f = stubFetch();
  try {
    const bounded = makeBoundedFetch(1_000);
    const controller = new AbortController();
    await bounded("https://example.com/rest/v1/x", { method: "GET", signal: controller.signal });
    assertEquals(f.calls.length, 1);
    assertEquals(f.calls[0].init?.signal, controller.signal);
  } finally {
    f.restore();
  }
});
