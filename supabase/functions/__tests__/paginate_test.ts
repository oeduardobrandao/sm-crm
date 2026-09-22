import { assertEquals, assertRejects } from "jsr:@std/assert";
import { chunk, fetchAllRows } from "../_shared/paginate.ts";

function pageServer(rows: number[], serverCap: number) {
  // Simulates PostgREST: returns at most serverCap rows per range request,
  // regardless of how many the range asked for (the db-max-rows behavior).
  return (from: number, to: number) => {
    const want = Math.min(to - from + 1, serverCap);
    return Promise.resolve({ data: rows.slice(from, from + want), error: null });
  };
}

Deno.test("fetchAllRows drains all rows across pages", async () => {
  const rows = Array.from({ length: 2350 }, (_, i) => i);
  const all = await fetchAllRows(pageServer(rows, 1000), 1000);
  assertEquals(all.length, 2350);
  assertEquals(all[2349], 2349);
});

Deno.test("fetchAllRows survives a server cap SMALLER than pageSize", async () => {
  // The bug a naive "stop when page < pageSize" would reintroduce.
  const rows = Array.from({ length: 250 }, (_, i) => i);
  const all = await fetchAllRows(pageServer(rows, 100), 1000);
  assertEquals(all.length, 250);
});

Deno.test("fetchAllRows returns empty for no rows", async () => {
  assertEquals(await fetchAllRows(pageServer([], 1000)), []);
});

Deno.test("fetchAllRows throws on page error, never returns partial", async () => {
  let calls = 0;
  await assertRejects(
    () =>
      fetchAllRows<number>((from, to) => {
        calls++;
        if (calls === 2) return Promise.resolve({ data: null, error: { message: "boom" } });
        return Promise.resolve({ data: Array.from({ length: to - from + 1 }, (_, i) => from + i), error: null });
      }, 10),
    Error,
    "boom",
  );
});

Deno.test("chunk splits and preserves order", () => {
  assertEquals(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertEquals(chunk([], 2), []);
  assertEquals(chunk([1], 500), [[1]]);
});
