import { assert } from "./assert.ts";
import { bucketedExpiry } from "../_shared/media-url.ts";

const WEEK = 604_800;

Deno.test("bucketedExpiry is stable across signings inside one window", () => {
  const start = 1_793_836_800; // a multiple of WEEK
  assert(start % WEEK === 0, "fixture must sit on a window boundary");
  const a = bucketedExpiry(start + 1, WEEK);
  const b = bucketedExpiry(start + 3600, WEEK);
  const c = bucketedExpiry(start + WEEK - 1, WEEK);
  assert(a === b && b === c, `expected one expiry, got ${a} ${b} ${c}`);
});

Deno.test("bucketedExpiry always leaves at least expiresIn and under 2x", () => {
  for (const now of [1_793_836_800, 1_793_836_801, 1_794_000_000, 1_794_441_599]) {
    const exp = bucketedExpiry(now, WEEK);
    assert(exp - now >= WEEK, `too short at ${now}: ${exp - now}`);
    assert(exp - now < 2 * WEEK, `too long at ${now}: ${exp - now}`);
    assert(exp % WEEK === 0, `not on a boundary: ${exp}`);
  }
});
