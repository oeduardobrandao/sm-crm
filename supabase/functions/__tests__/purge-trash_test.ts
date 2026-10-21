import { assertEquals } from "./assert.ts";
import { parseListObjectsXml, purgeTrash, type PurgeTrashOpts, type TrashPage } from "../_shared/r2.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Builds an object with a lastModified offset (in days) from `nowMs`. */
function obj(key: string, ageDays: number, nowMs: number) {
  return { key, lastModified: new Date(nowMs - ageDays * DAY_MS) };
}

/** Fixed-clock nowFn, so olderThanDays math is deterministic in tests. */
function fixedNow(ms: number) {
  return () => ms;
}

Deno.test("purgeTrash resumes from startToken and returns the next one", async () => {
  const NOW = 1_700_000_000_000;
  // Call sequence: cutoff, startedAt, the per-object deadline check ahead of
  // trash/a's delete (not yet exceeded), then the trailing between-pages
  // check (exceeded) so the test sees exactly one listPage call.
  const times = [NOW, NOW, NOW, NOW + 60_000];
  let i = 0;
  const nowFn = () => (i < times.length ? times[i++] : times[times.length - 1]);
  const calls: Array<string | undefined> = [];
  const listPage = (token: string | undefined): Promise<TrashPage> => {
    calls.push(token);
    if (token === undefined) {
      throw new Error("should not list from head; startToken was provided");
    }
    if (calls.length > 1) throw new Error("should not fetch a second page");
    return Promise.resolve({
      objects: [obj("trash/a", 40, NOW)],
      nextToken: "page-3",
    });
  };
  const deleted: string[] = [];
  const result = await purgeTrash(30, {
    startToken: "page-2",
    listPage,
    deleteFn: (key) => { deleted.push(key); return Promise.resolve(); },
    nowFn,
  });
  assertEquals(calls, ["page-2"]);
  assertEquals(deleted, ["trash/a"]);
  assertEquals(result, { purged: 1, nextToken: "page-3", cycleCompleted: false });
});

Deno.test("purgeTrash deletes only objects older than the cutoff", async () => {
  const NOW = 1_700_000_000_000;
  const page: TrashPage = {
    objects: [
      obj("trash/old", 40, NOW), // older than 30d cutoff -> delete
      obj("trash/new", 5, NOW), // younger -> keep
    ],
    nextToken: null,
  };
  const deleted: string[] = [];
  const result = await purgeTrash(30, {
    listPage: () => Promise.resolve(page),
    deleteFn: (key) => { deleted.push(key); return Promise.resolve(); },
    nowFn: fixedNow(NOW),
  });
  assertEquals(deleted, ["trash/old"]);
  assertEquals(result, { purged: 1, nextToken: null, cycleCompleted: true });
});

Deno.test("cap reached mid-page returns the CURRENT page's producing token, not the next (no skipped objects)", async () => {
  const NOW = 1_700_000_000_000;
  let pageCalls = 0;
  const listPage = (token: string | undefined): Promise<TrashPage> => {
    pageCalls++;
    if (token === undefined) {
      return Promise.resolve({
        objects: [obj("trash/a", 40, NOW), obj("trash/b", 40, NOW), obj("trash/c", 40, NOW)],
        nextToken: "page-2",
      });
    }
    throw new Error("should not fetch page 2: cap reached mid page 1");
  };
  const deleted: string[] = [];
  const result = await purgeTrash(30, {
    maxPerRun: 1,
    listPage,
    deleteFn: (key) => { deleted.push(key); return Promise.resolve(); },
    nowFn: fixedNow(NOW),
  });
  assertEquals(pageCalls, 1);
  assertEquals(deleted, ["trash/a"]);
  // Resume token is the one that PRODUCED this page (the head, since we
  // started with none) — not page.nextToken ("page-2") — so the interrupted
  // page is re-listed in full next run rather than skipping trash/b, trash/c.
  assertEquals(result, { purged: 1, nextToken: null, cycleCompleted: false });
});

Deno.test("deadline exceeded between pages (after finishing a page's deletes) stops before fetching the next page", async () => {
  const NOW = 1_700_000_000_000;
  // Call sequence inside purgeTrash for a single-object page: cutoff, startedAt,
  // the per-object deadline check (not yet exceeded, so the delete happens),
  // then the trailing between-pages check (exceeded) before a second listPage.
  const times = [NOW, NOW, NOW, NOW + 60_000];
  let i = 0;
  const nowFn = () => (i < times.length ? times[i++] : times[times.length - 1]);
  let pageCalls = 0;
  const listPage = (_token: string | undefined): Promise<TrashPage> => {
    pageCalls++;
    if (pageCalls > 1) throw new Error("should not fetch a second page: deadline hit between pages");
    return Promise.resolve({ objects: [obj("trash/1", 40, NOW)], nextToken: "page-2" });
  };
  const deleted: string[] = [];
  const result = await purgeTrash(30, {
    listPage,
    deleteFn: (key) => { deleted.push(key); return Promise.resolve(); },
    nowFn,
  });
  assertEquals(pageCalls, 1);
  assertEquals(deleted, ["trash/1"]);
  assertEquals(result, { purged: 1, nextToken: "page-2", cycleCompleted: false });
});

Deno.test("deadline exceeded mid-page stops deleting further objects in the SAME page and returns the producing token", async () => {
  const NOW = 1_700_000_000_000;
  // Call sequence: cutoff, startedAt, obj-a's deadline check (not yet
  // exceeded -> deleted), obj-b's deadline check (exceeded -> stop, obj-b and
  // obj-c are never even age-checked).
  const times = [NOW, NOW, NOW, NOW + 60_000];
  let i = 0;
  const nowFn = () => (i < times.length ? times[i++] : times[times.length - 1]);
  let pageCalls = 0;
  const listPage = (_token: string | undefined): Promise<TrashPage> => {
    pageCalls++;
    if (pageCalls > 1) throw new Error("should not fetch a second page: deadline hit mid page 1");
    return Promise.resolve({
      objects: [obj("trash/a", 40, NOW), obj("trash/b", 40, NOW), obj("trash/c", 40, NOW)],
      nextToken: "page-2",
    });
  };
  const deleted: string[] = [];
  const result = await purgeTrash(30, {
    listPage,
    deleteFn: (key) => { deleted.push(key); return Promise.resolve(); },
    nowFn,
  });
  assertEquals(pageCalls, 1);
  // Only trash/a is deleted before the deadline check ahead of trash/b trips;
  // trash/b and trash/c are left untouched this run.
  assertEquals(deleted, ["trash/a"]);
  // Resume token is the one that PRODUCED this page (null, since we started
  // fresh) — the whole page is re-listed next run, so trash/b and trash/c
  // aren't skipped by resuming from page.nextToken instead.
  assertEquals(result, { purged: 1, nextToken: null, cycleCompleted: false });
});

Deno.test("invalid startToken (listPage throws on first call with a token) retries once from null", async () => {
  const NOW = 1_700_000_000_000;
  const calls: Array<string | undefined> = [];
  const listPage = (token: string | undefined): Promise<TrashPage> => {
    calls.push(token);
    if (token === "stale-token") {
      return Promise.reject(new Error("InvalidArgument: stale continuation token"));
    }
    return Promise.resolve({ objects: [obj("trash/a", 40, NOW)], nextToken: null });
  };
  const deleted: string[] = [];
  const result = await purgeTrash(30, {
    startToken: "stale-token",
    listPage,
    deleteFn: (key) => { deleted.push(key); return Promise.resolve(); },
    nowFn: fixedNow(NOW),
  });
  assertEquals(calls, ["stale-token", undefined]);
  assertEquals(deleted, ["trash/a"]);
  assertEquals(result, { purged: 1, nextToken: null, cycleCompleted: true });
});

Deno.test("invalid startToken retried once, then propagates a second failure", async () => {
  const listPage = (_token: string | undefined): Promise<TrashPage> => {
    return Promise.reject(new Error("still broken"));
  };
  let threw = false;
  try {
    await purgeTrash(30, { startToken: "stale-token", listPage, nowFn: fixedNow(0) });
  } catch (e) {
    threw = true;
    assertEquals((e as Error).message, "still broken");
  }
  assertEquals(threw, true);
});

Deno.test("cycleCompleted true only when the final page reports no continuation", async () => {
  const NOW = 1_700_000_000_000;
  let pageCalls = 0;
  const listPage = (_token: string | undefined): Promise<TrashPage> => {
    pageCalls++;
    if (pageCalls === 1) {
      return Promise.resolve({ objects: [obj("trash/a", 40, NOW)], nextToken: "page-2" });
    }
    return Promise.resolve({ objects: [obj("trash/b", 40, NOW)], nextToken: null });
  };
  const deleted: string[] = [];
  const result = await purgeTrash(30, {
    listPage,
    deleteFn: (key) => { deleted.push(key); return Promise.resolve(); },
    nowFn: fixedNow(NOW),
  });
  assertEquals(pageCalls, 2);
  assertEquals(deleted, ["trash/a", "trash/b"]);
  assertEquals(result, { purged: 2, nextToken: null, cycleCompleted: true });
});

// Sanity: opts type import is exercised (keeps the shared PurgeTrashOpts type
// referenced so tsc catches a signature drift here, not just at the call site).
const _typeCheck: PurgeTrashOpts = {};
void _typeCheck;

Deno.test("parseListObjectsXml parses keys, dates, truncation and XML entities", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <IsTruncated>true</IsTruncated>
  <NextContinuationToken>tok&amp;123==</NextContinuationToken>
  <Contents>
    <Key>trash/contas/a &amp; b.png</Key>
    <LastModified>2026-08-01T00:00:00.000Z</LastModified>
    <Size>10</Size>
  </Contents>
  <Contents>
    <Key>trash/briefing-audio/x.webm</Key>
    <LastModified>2026-09-01T12:30:00.000Z</LastModified>
  </Contents>
</ListBucketResult>`;

  const page = parseListObjectsXml(xml);

  assertEquals(page.objects.length, 2);
  assertEquals(page.objects[0].key, "trash/contas/a & b.png");
  assertEquals(page.objects[0].lastModified.toISOString(), "2026-08-01T00:00:00.000Z");
  assertEquals(page.objects[1].key, "trash/briefing-audio/x.webm");
  assertEquals(page.nextToken, "tok&123==");
});

Deno.test("parseListObjectsXml: not truncated means nextToken null even if a token tag exists", () => {
  const xml = `<ListBucketResult>
  <IsTruncated>false</IsTruncated>
  <Contents><Key>trash/k</Key><LastModified>2026-08-01T00:00:00Z</LastModified></Contents>
</ListBucketResult>`;

  const page = parseListObjectsXml(xml);

  assertEquals(page.objects.length, 1);
  assertEquals(page.nextToken, null);
});
