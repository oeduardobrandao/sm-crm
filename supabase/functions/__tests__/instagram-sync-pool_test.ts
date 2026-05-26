import { assert, assertEquals } from "./assert.ts";
import { runPool } from "../instagram-sync-cron/pool.ts";

Deno.test("runPool processes all items", async () => {
  const results: number[] = [];
  await runPool([1, 2, 3, 4, 5], 3, async (n) => {
    results.push(n);
  });
  assertEquals(results.sort(), [1, 2, 3, 4, 5]);
});

Deno.test("runPool respects concurrency limit", async () => {
  let maxConcurrent = 0;
  let currentConcurrent = 0;
  await runPool([1, 2, 3, 4, 5, 6], 2, async (_n) => {
    currentConcurrent++;
    if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
    await new Promise((r) => setTimeout(r, 50));
    currentConcurrent--;
  });
  assertEquals(maxConcurrent, 2);
});

Deno.test("runPool handles empty array", async () => {
  let called = false;
  await runPool([], 3, async () => { called = true; });
  assertEquals(called, false);
});

Deno.test("runPool rejects when a callback throws and completes in-flight work", async () => {
  const completed: number[] = [];
  let rejected = false;
  let rejectedMessage = "";
  try {
    await runPool([1, 2, 3, 4], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      await new Promise((r) => setTimeout(r, 30));
      completed.push(n);
    });
  } catch (err: any) {
    rejected = true;
    rejectedMessage = err.message;
  }
  assert(rejected, "runPool should have rejected");
  assertEquals(rejectedMessage, "boom");
  assert(completed.includes(1), "Item 1 should have completed before the error");
});
