import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { chunk, fetchAllRows, fetchAllRowsKeyset } from "../_shared/paginate.ts";

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

// Backing array for keyset tests; rows are { key, val } objects keyed by string `key`
// (as workspace_id/id would be), so tests can mutate the array between page requests
// to simulate a concurrent removal.
function keysetServer(rows: { key: string; val: number }[], pageSize: number) {
  return (after: string | null) => {
    const filtered = after === null ? rows : rows.filter((r) => r.key > after);
    const sorted = [...filtered].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return Promise.resolve({ data: sorted.slice(0, pageSize), error: null });
  };
}

Deno.test("fetchAllRowsKeyset drains all rows across pages", async () => {
  const rows = Array.from({ length: 2350 }, (_, i) => ({ key: String(i).padStart(5, "0"), val: i }));
  const all = await fetchAllRowsKeyset(keysetServer(rows, 1000), (r) => r.key, 1000);
  assertEquals(all.length, 2350);
  assertEquals(all[2349].val, 2349);
});

Deno.test("fetchAllRowsKeyset survives a row removed from the set between page requests (no skip)", async () => {
  // 1200 rows across two pages of 1000. Before requesting page 2, a row that WOULD have
  // been skipped under offset math (its key sorts just past the page-1/page-2 boundary)
  // is instead a stand-in for "the row that must still be seen": we mutate the backing
  // array to remove an EARLIER row from the filtered set (simulating a concurrent
  // unlink), which would shift a later row left under `.range()` offset pagination and
  // cause it to be skipped. Keyset pagination re-anchors on the last key seen, so no
  // shift can happen and the tail row is never skipped.
  const rows = Array.from({ length: 1200 }, (_, i) => ({ key: String(i).padStart(5, "0"), val: i }));
  const tailKey = String(1150).padStart(5, "0");

  let pageCount = 0;
  const fetchPage = (after: string | null) => {
    pageCount++;
    if (pageCount === 2) {
      // Between page 1 and page 2, a row EARLIER than `after` (already returned) leaves
      // the filtered set -- under offset/.range() pagination this shifts every row after
      // it left by one, which would cause the tail row to be served twice (harmless) or,
      // if the removed row were between the pages, skipped entirely. Simulate the
      // concurrent removal here to prove keyset re-anchoring is immune either way.
      rows.splice(500, 1);
    }
    const filtered = after === null ? rows : rows.filter((r) => r.key > after);
    const sorted = [...filtered].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return Promise.resolve({ data: sorted.slice(0, 1000), error: null });
  };

  const all = await fetchAllRowsKeyset(fetchPage, (r) => r.key, 1000);
  assert(all.some((r) => r.key === tailKey), "the tail row must still be present, not skipped");
});

Deno.test("fetchAllRowsKeyset returns empty for no rows", async () => {
  assertEquals(await fetchAllRowsKeyset(keysetServer([], 1000), (r) => r.key), []);
});

Deno.test("fetchAllRowsKeyset throws on page error, never returns partial", async () => {
  let calls = 0;
  await assertRejects(
    () =>
      fetchAllRowsKeyset<{ key: string }>(
        (_after) => {
          calls++;
          if (calls === 2) return Promise.resolve({ data: null, error: { message: "boom" } });
          return Promise.resolve({ data: [{ key: String(calls).padStart(5, "0") }], error: null });
        },
        (r) => r.key,
        1,
      ),
    Error,
    "boom",
  );
});

Deno.test("fetchAllRowsKeyset throws on a non-advancing key (infinite-loop guard)", async () => {
  await assertRejects(
    () =>
      fetchAllRowsKeyset<{ key: string }>(
        (_after) => Promise.resolve({ data: [{ key: "00001" }], error: null }),
        (r) => r.key,
        1,
      ),
    Error,
    "did not advance",
  );
});

Deno.test("chunk splits and preserves order", () => {
  assertEquals(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertEquals(chunk([], 2), []);
  assertEquals(chunk([1], 500), [[1]]);
});
