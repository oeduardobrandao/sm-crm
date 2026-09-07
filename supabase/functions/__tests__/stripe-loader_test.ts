import { assert, assertEquals } from "./assert.ts";
import { loadStripe, setStripeLoader } from "../_shared/stripe-loader.ts";

// `loader` is module-level state shared across these Deno.test cases (they run in one process),
// so every test resets it via a top-level try/finally instead of relying on execution order.

Deno.test("loadStripe: null when no loader is registered", async () => {
  setStripeLoader(null);
  try {
    assertEquals(await loadStripe(), null);
  } finally {
    setStripeLoader(null);
  }
});

Deno.test("loadStripe: returns the object produced by a registered loader", async () => {
  const fakeClient = { subscriptions: { retrieve: async () => ({}) } };
  setStripeLoader(async () => fakeClient as never);
  try {
    const client = await loadStripe();
    assert(client === fakeClient, "expected the exact object the loader returned");
  } finally {
    setStripeLoader(null);
  }
});

Deno.test("loadStripe: returns null (does not throw) when the loader rejects", async () => {
  setStripeLoader(() => Promise.reject(new Error("boom")));
  try {
    const client = await loadStripe();
    assertEquals(client, null);
  } finally {
    setStripeLoader(null);
  }
});

Deno.test("setStripeLoader(null): resets, subsequent loadStripe returns null again", async () => {
  setStripeLoader(async () => ({ subscriptions: { retrieve: async () => ({}) } }) as never);
  setStripeLoader(null);
  assertEquals(await loadStripe(), null);
});
