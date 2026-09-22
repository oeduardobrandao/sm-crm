import { assertEquals } from "./assert.ts";
import { withWatchdog } from "../post-media-cleanup-cron/watchdog.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.test("withWatchdog resolves with the result when run() finishes before the deadline", async () => {
  const result = await withWatchdog(50, () => Promise.resolve("done"));
  assertEquals(result, "done");
});

Deno.test("withWatchdog resolves null when run() has not settled by the deadline", async () => {
  const result = await withWatchdog(10, () => sleep(200).then(() => "too-late"));
  assertEquals(result, null);
  // Drain run()'s own pending timer before the test ends, so it can't leak
  // into a later test's sanitizer window.
  await sleep(210);
});

Deno.test("withWatchdog propagates a rejection that happens before the deadline", async () => {
  let threw = false;
  try {
    await withWatchdog(50, () => Promise.reject(new Error("boom")));
  } catch (e) {
    threw = true;
    assertEquals((e as Error).message, "boom");
  }
  assertEquals(threw, true);
});

Deno.test("withWatchdog swallows a late rejection after timeout instead of leaking an unhandled promise", async () => {
  const errors: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    // run() rejects AFTER the watchdog's own timeout has already fired.
    const result = await withWatchdog(10, () => sleep(50).then(() => Promise.reject(new Error("late boom"))));
    assertEquals(result, null);
    // Give the late rejection's .then() handler a turn to run and be caught
    // internally — if it were leaked as an unhandled rejection, Deno's test
    // sanitizers would fail this test rather than let it reach here.
    await sleep(100);
  } finally {
    console.error = originalConsoleError;
  }
  assertEquals(errors.length, 1);
  assertEquals(errors[0][0], "post-media-cleanup:purge-trash (after watchdog timeout)");
  assertEquals((errors[0][1] as Error).message, "late boom");
});

Deno.test("withWatchdog ignores a late resolution after timeout (does not resolve twice)", async () => {
  const result = await withWatchdog(10, () => sleep(50).then(() => "too-late-value"));
  assertEquals(result, null);
  // No assertion beyond "the promise already settled to null and this test
  // completes without a second resolve/reject" — Deno's own Promise
  // semantics mean a second resolve() call on a settled executor is already
  // a no-op, so reaching this line at all is the proof.
  await sleep(80);
});
