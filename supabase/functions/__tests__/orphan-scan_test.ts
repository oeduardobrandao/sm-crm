import { assertEquals } from "./assert.ts";
import {
  DEFAULT_PAGES_PER_RUN,
  EMPTY_KNOWN_FLOOR,
  KNOWN_CHUNK,
  MAX_TRASH_PER_RUN,
  runOrphanScan,
  scanKeyFor,
  type OrphanKeyPage,
  type OrphanScanDeps,
} from "../post-media-cleanup-cron/orphan-scan.ts";

type KnownRow = { r2_key: string | null; thumbnail_r2_key: string | null };

function makeDb(
  respond: (table: string, column: string, batch: string[]) => {
    data: KnownRow[] | null;
    error: { message: string } | null;
  },
) {
  const queries: Array<{ table: string; column: string; batchSize: number }> = [];
  const db: OrphanScanDeps["db"] = {
    from(table) {
      return {
        select(_columns: string) {
          return {
            in(column: string, values: string[]) {
              queries.push({ table, column, batchSize: values.length });
              return Promise.resolve(respond(table, column, values));
            },
          };
        },
      };
    },
  };
  return { db, queries };
}

/** Listing fake for the tests that predate paging: every key for a prefix comes
 * back as ONE page with no continuation token. */
function singlePage(
  keysFor: (prefix: string) => string[],
): OrphanScanDeps["listOrphanKeyPage"] {
  return (prefix) => Promise.resolve({ keys: keysFor(prefix), nextToken: null });
}

/** In-memory stand-in for cron_scan_state. Returned so a test can seed a resume
 * position and assert where the next run was told to pick up. */
function makeCheckpoints(seed: Record<string, string | null> = {}) {
  const store: Record<string, string | null> = { ...seed };
  const writes: Array<{ scanKey: string; token: string | null; cycleCompleted: boolean }> = [];
  return {
    store,
    writes,
    deps: {
      readCheckpoint: (scanKey: string) => Promise.resolve(store[scanKey] ?? null),
      writeCheckpoint: (
        scanKey: string,
        token: string | null,
        opts: { cycleCompleted: boolean },
      ) => {
        store[scanKey] = token;
        writes.push({ scanKey, token, cycleCompleted: opts.cycleCompleted });
        return Promise.resolve();
      },
    },
  };
}

/** Checkpoint deps for the tests that are not about checkpointing. */
function noCheckpoint(): Pick<OrphanScanDeps, "readCheckpoint" | "writeCheckpoint"> {
  return makeCheckpoints().deps;
}

Deno.test("orphan-scan: chunks known-set queries and only deletes true orphans", async () => {
  const candidates = Array.from({ length: KNOWN_CHUNK + 50 }, (_, i) => `contas/w/files/obj-${i}.png`);
  // Every candidate except obj-0 is known via files.r2_key.
  const { db, queries } = makeDb((table, column, batch) => ({
    data: table === "files" && column === "r2_key"
      ? batch.filter((k) => k !== "contas/w/files/obj-0.png").map((k) => ({ r2_key: k, thumbnail_r2_key: null }))
      : [],
    error: null,
  }));
  const deleted: string[] = [];
  const result = await runOrphanScan({
    ...noCheckpoint(),
    db,
    listOrphanKeyPage: singlePage((prefix) => (prefix === "contas/" ? candidates : [])),
    trashObject: async (key) => {
      deleted.push(key);
    },
  });
  assertEquals(result.aborted, null);
  assertEquals(result.trashed, 1);
  assertEquals(deleted, ["contas/w/files/obj-0.png"]);
  // 4 table/column pairs x 2 chunks each (100 candidates, KNOWN_CHUNK = 50).
  assertEquals(queries.length, 8);
  assertEquals(Math.max(...queries.map((q) => q.batchSize)), KNOWN_CHUNK);
});

Deno.test("orphan-scan: any known-set query error aborts with ZERO deletions", async () => {
  const candidates = Array.from({ length: 300 }, (_, i) => `contas/w/files/obj-${i}.png`);
  const { db } = makeDb((table, column) =>
    table === "files" && column === "thumbnail_r2_key"
      ? { data: null, error: { message: "uri too long" } }
      : { data: [], error: null }
  );
  const deleted: string[] = [];
  const result = await runOrphanScan({
    ...noCheckpoint(),
    db,
    listOrphanKeyPage: singlePage((prefix) => (prefix === "contas/" ? candidates : [])),
    trashObject: async (key) => {
      deleted.push(key);
    },
  });
  assertEquals(result.aborted, "contas/: known-query:files.thumbnail_r2_key");
  assertEquals(result.trashed, 0);
  assertEquals(deleted.length, 0);
});

Deno.test("orphan-scan: empty known set with many candidates trips the circuit breaker", async () => {
  const candidates = Array.from({ length: EMPTY_KNOWN_FLOOR }, (_, i) => `contas/w/files/obj-${i}.png`);
  const { db } = makeDb(() => ({ data: [], error: null }));
  const deleted: string[] = [];
  const result = await runOrphanScan({
    ...noCheckpoint(),
    db,
    listOrphanKeyPage: singlePage((prefix) => (prefix === "contas/" ? candidates : [])),
    trashObject: async (key) => {
      deleted.push(key);
    },
  });
  assertEquals(result.aborted, "contas/: empty-known-set");
  assertEquals(result.trashed, 0);
  assertEquals(deleted.length, 0);
});

Deno.test("orphan-scan: a small all-orphan candidate set below the floor still deletes", async () => {
  const candidates = ["contas/w/files/tmp-a.png", "contas/w/files/tmp-b.png"];
  const { db } = makeDb(() => ({ data: [], error: null }));
  const deleted: string[] = [];
  const result = await runOrphanScan({
    ...noCheckpoint(),
    db,
    listOrphanKeyPage: singlePage((prefix) => (prefix === "contas/" ? candidates : [])),
    trashObject: async (key) => {
      deleted.push(key);
    },
  });
  assertEquals(result.aborted, null);
  assertEquals(result.trashed, 2);
});

Deno.test("orphan-scan: MAX_TRASH_PER_RUN caps removals and reports the deferred remainder", async () => {
  const candidates = Array.from({ length: MAX_TRASH_PER_RUN + 30 }, (_, i) => `contas/w/files/orph-${i}.png`);
  const { db } = makeDb(() => ({
    // One known key keeps the empty-known-set breaker out of the way.
    data: [{ r2_key: "contas/other/known.png", thumbnail_r2_key: null }],
    error: null,
  }));
  const trashed: string[] = [];
  const result = await runOrphanScan({
    ...noCheckpoint(),
    db,
    listOrphanKeyPage: singlePage((prefix) => (prefix === "contas/" ? candidates : [])),
    trashObject: async (key) => {
      trashed.push(key);
    },
  });
  assertEquals(result.aborted, null);
  assertEquals(result.trashed, MAX_TRASH_PER_RUN);
  assertEquals(result.capped, 30);
  assertEquals(trashed.length, MAX_TRASH_PER_RUN);
  assertEquals(result.targets.map((t) => t.prefix), ["contas/", "briefing-audio/"]);
  assertEquals(result.targets[0], {
    prefix: "contas/", candidates: MAX_TRASH_PER_RUN + 30, trashed: MAX_TRASH_PER_RUN, capped: 30,
    aborted: null, pages: 1, resumed: false,
    // Cut short by the cap, so the sweep did NOT reach the end of the prefix.
    cycleCompleted: false,
  });
  assertEquals(result.targets[1], {
    prefix: "briefing-audio/", candidates: 0, trashed: 0, capped: 0, aborted: null,
    pages: 1, resumed: false, cycleCompleted: true,
  });
});

Deno.test("orphan-scan: scans both contas/ and briefing-audio/ prefixes, once each", async () => {
  const calledPrefixes: string[] = [];
  const { db } = makeDb(() => ({ data: [], error: null }));
  const result = await runOrphanScan({
    ...noCheckpoint(),
    db,
    listOrphanKeyPage: singlePage((prefix) => {
      calledPrefixes.push(prefix);
      return [];
    }),
    trashObject: async () => {},
  });
  assertEquals(calledPrefixes, ["contas/", "briefing-audio/"]);
  assertEquals(result.aborted, null);
});

Deno.test("orphan-scan: a briefing-audio/ key referenced in hub_briefing_questions.audio_r2_key is not trashed", async () => {
  const key = "briefing-audio/c/q/x.webm";
  const { db } = makeDb((table, column, batch) => ({
    data: table === "hub_briefing_questions" && column === "audio_r2_key"
      ? batch.filter((k) => k === key).map((k) => ({ audio_r2_key: k }))
      : [],
    error: null,
  }));
  const deleted: string[] = [];
  const result = await runOrphanScan({
    ...noCheckpoint(),
    db,
    listOrphanKeyPage: singlePage((prefix) => (prefix === "briefing-audio/" ? [key] : [])),
    trashObject: async (k) => {
      deleted.push(k);
    },
  });
  assertEquals(result.aborted, null);
  assertEquals(deleted, []);
  assertEquals(result.trashed, 0);
});

Deno.test("orphan-scan: an unreferenced briefing-audio/ key is trashed", async () => {
  const key = "briefing-audio/c/q/orphan.webm";
  const { db } = makeDb(() => ({ data: [], error: null }));
  const deleted: string[] = [];
  const result = await runOrphanScan({
    ...noCheckpoint(),
    db,
    listOrphanKeyPage: singlePage((prefix) => (prefix === "briefing-audio/" ? [key] : [])),
    trashObject: async (k) => {
      deleted.push(k);
    },
  });
  assertEquals(result.aborted, null);
  assertEquals(deleted, [key]);
  assertEquals(result.trashed, 1);
});

Deno.test("orphan-scan: a hub_briefing_questions query error aborts only the briefing-audio/ target — contas/ still scans", async () => {
  const contasOrphan = "contas/w/files/orphan.png";
  const briefingKey = "briefing-audio/c/q/x.webm";
  const { db } = makeDb((table, column) =>
    table === "hub_briefing_questions" && column === "audio_r2_key"
      ? { data: null, error: { message: "boom" } }
      : { data: [], error: null }
  );
  const deleted: string[] = [];
  const result = await runOrphanScan({
    ...noCheckpoint(),
    db,
    listOrphanKeyPage: singlePage((prefix) => (prefix === "contas/" ? [contasOrphan] : [briefingKey])),
    trashObject: async (k) => {
      deleted.push(k);
    },
  });
  assertEquals(result.aborted, "briefing-audio/: known-query:hub_briefing_questions.audio_r2_key");
  // Zero exclusões no alvo abortado (briefing-audio/) — mas o alvo contas/,
  // que não foi tocado pelo erro, roda normalmente e trasha seu próprio órfão.
  assertEquals(deleted, [contasOrphan]);
  assertEquals(result.trashed, 1);
});

Deno.test("orphan-scan: a contas/ query error aborts only that target — briefing-audio/ still scans", async () => {
  const briefingOrphan = "briefing-audio/c/q/orphan.webm";
  const { db } = makeDb((table, column) =>
    table === "post_media" && column === "r2_key"
      ? { data: null, error: { message: "boom" } }
      : { data: [], error: null }
  );
  const deleted: string[] = [];
  const result = await runOrphanScan({
    ...noCheckpoint(),
    db,
    listOrphanKeyPage: singlePage((prefix) => (prefix === "contas/" ? ["contas/w/files/whatever.png"] : [briefingOrphan])),
    trashObject: async (k) => {
      deleted.push(k);
    },
  });
  assertEquals(result.aborted, "contas/: known-query:post_media.r2_key");
  assertEquals(deleted, [briefingOrphan]);
  assertEquals(result.trashed, 1);
});

Deno.test("orphan-scan: MAX_TRASH_PER_RUN is a budget PER target, not one shared pot", async () => {
  // Regression: with a single shared budget, a contas/ flood that exhausts the
  // cap left briefing-audio/ reaping ZERO orphans on every single run.
  const contasOrphans = Array.from({ length: MAX_TRASH_PER_RUN + 10 }, (_, i) => `contas/w/files/o-${i}.png`);
  const briefingOrphans = Array.from({ length: 3 }, (_, i) => `briefing-audio/c/q/o-${i}.webm`);
  // One known contas/ key keeps the empty-known-set breaker out of the way for
  // that target; it contributes nothing to briefing-audio/ (different column).
  const { db } = makeDb(() => ({
    data: [{ r2_key: "contas/other/known.png", thumbnail_r2_key: null }],
    error: null,
  }));
  const trashed: string[] = [];
  const result = await runOrphanScan({
    ...noCheckpoint(),
    db,
    listOrphanKeyPage: singlePage((prefix) => (prefix === "contas/" ? contasOrphans : briefingOrphans)),
    trashObject: async (k) => {
      trashed.push(k);
    },
  });
  assertEquals(result.aborted, null);
  assertEquals(result.targets[0], {
    prefix: "contas/", candidates: MAX_TRASH_PER_RUN + 10, trashed: MAX_TRASH_PER_RUN, capped: 10,
    aborted: null, pages: 1, resumed: false, cycleCompleted: false,
  });
  assertEquals(result.targets[1], {
    prefix: "briefing-audio/", candidates: 3, trashed: 3, capped: 0, aborted: null,
    pages: 1, resumed: false, cycleCompleted: true,
  });
  // Top-level numbers stay the sums.
  assertEquals(result.trashed, MAX_TRASH_PER_RUN + 3);
  assertEquals(result.capped, 10);
  assertEquals(result.candidates, MAX_TRASH_PER_RUN + 13);
  assertEquals(trashed.filter((k) => k.startsWith("briefing-audio/")), briefingOrphans);
});

Deno.test("orphan-scan: an abort in briefing-audio/ is reported even when contas/ also aborts", async () => {
  const { db } = makeDb((table) =>
    table === "post_media" || table === "hub_briefing_questions"
      ? { data: null, error: { message: "boom" } }
      : { data: [], error: null }
  );
  const deleted: string[] = [];
  const result = await runOrphanScan({
    ...noCheckpoint(),
    db,
    listOrphanKeyPage: singlePage((prefix) => (prefix === "contas/" ? ["contas/w/files/a.png"] : ["briefing-audio/c/q/b.webm"])),
    trashObject: async (k) => {
      deleted.push(k);
    },
  });
  assertEquals(
    result.aborted,
    "contas/: known-query:post_media.r2_key; briefing-audio/: known-query:hub_briefing_questions.audio_r2_key",
  );
  assertEquals(result.targets[1].aborted, "known-query:hub_briefing_questions.audio_r2_key");
  assertEquals(deleted, []);
  assertEquals(result.trashed, 0);
});

// ---------------------------------------------------------------------------
// Paging + checkpoint. The scan used to materialise the whole prefix in one
// isolate (WORKER_RESOURCE_LIMIT on prod, 2026-08-13); these cover the bounded
// replacement and, above all, that the cursor never advances past ground the
// run did not actually finish.
// ---------------------------------------------------------------------------

/** Pages keyed by continuation token: null -> page 0, "p<i>" -> page i. */
function makePagedListing(pagesByPrefix: Record<string, OrphanKeyPage[]>) {
  const calls: Array<{ prefix: string; token: string | null }> = [];
  const listOrphanKeyPage: OrphanScanDeps["listOrphanKeyPage"] = (prefix, _age, token) => {
    calls.push({ prefix, token });
    const pages = pagesByPrefix[prefix];
    if (!pages) return Promise.resolve({ keys: [], nextToken: null });
    const idx = token === null ? 0 : Number(String(token).slice(1));
    return Promise.resolve(pages[idx] ?? { keys: [], nextToken: null });
  };
  return { listOrphanKeyPage, calls };
}

/** N pages that chain p1 -> p2 -> ... and end with a null token. */
function emptyPages(count: number): OrphanKeyPage[] {
  return Array.from({ length: count }, (_, i) => ({
    keys: [],
    nextToken: i === count - 1 ? null : `p${i + 1}`,
  }));
}

Deno.test("orphan-scan: resumes from the stored checkpoint instead of page 1", async () => {
  const { db } = makeDb(() => ({ data: [], error: null }));
  const { listOrphanKeyPage, calls } = makePagedListing({ "contas/": emptyPages(4) });
  const cp = makeCheckpoints({ [scanKeyFor("contas/")]: "p3" });

  const result = await runOrphanScan({ db, listOrphanKeyPage, trashObject: async () => {}, ...cp.deps });

  // Picked up at p3 — page 1 and 2 were swept by earlier runs and are not re-read.
  assertEquals(calls[0], { prefix: "contas/", token: "p3" });
  assertEquals(result.targets[0].resumed, true);
  // p3 is the last page, so the cycle closes and the next run starts over.
  assertEquals(result.targets[0].cycleCompleted, true);
  assertEquals(cp.store[scanKeyFor("contas/")], null);
});

Deno.test("orphan-scan: spends at most pagesPerRun pages and checkpoints the rest", async () => {
  const { db } = makeDb(() => ({ data: [], error: null }));
  const { listOrphanKeyPage, calls } = makePagedListing({ "contas/": emptyPages(10) });
  const cp = makeCheckpoints();

  const result = await runOrphanScan({
    db,
    listOrphanKeyPage,
    trashObject: async () => {},
    pagesPerRun: 3,
    ...cp.deps,
  });

  const contasCalls = calls.filter((c) => c.prefix === "contas/");
  assertEquals(contasCalls.map((c) => c.token), [null, "p1", "p2"]);
  assertEquals(result.targets[0].pages, 3);
  assertEquals(result.targets[0].cycleCompleted, false);
  // Next run continues at p3 rather than restarting: this is the whole point.
  assertEquals(cp.store[scanKeyFor("contas/")], "p3");
  // A page of only-young objects (keys empty, nextToken set) is NOT a stop
  // condition — the run kept paging through all three.
  assertEquals(result.candidates, 0);
});

Deno.test("orphan-scan: a page cut short by the trash cap keeps the cursor on that page", async () => {
  const orphans = Array.from({ length: MAX_TRASH_PER_RUN + 20 }, (_, i) => `contas/w/files/o-${i}.png`);
  const { db } = makeDb(() => ({
    // One known key keeps the empty-known-set breaker out of the way.
    data: [{ r2_key: "contas/other/known.png", thumbnail_r2_key: null }],
    error: null,
  }));
  const { listOrphanKeyPage } = makePagedListing({
    "contas/": [{ keys: [], nextToken: "p1" }, { keys: orphans, nextToken: "p2" }, { keys: [], nextToken: null }],
  });
  const cp = makeCheckpoints({ [scanKeyFor("contas/")]: "p1" });
  const trashed: string[] = [];

  const result = await runOrphanScan({
    db,
    listOrphanKeyPage,
    trashObject: async (k) => {
      trashed.push(k);
    },
    ...cp.deps,
  });

  assertEquals(result.trashed, MAX_TRASH_PER_RUN);
  assertEquals(result.capped, 20);
  // Cursor stays on p1: the 20 orphans this run was not allowed to touch are
  // still there, and advancing to p2 would leave them unreachable until the
  // next full cycle. The 50 already trashed are gone from the listing, so
  // re-reading p1 next run returns the remainder — the sweep still advances.
  assertEquals(cp.store[scanKeyFor("contas/")], "p1");
  assertEquals(
    cp.writes.find((w) => w.scanKey === scanKeyFor("contas/"))?.cycleCompleted,
    false,
  );
  assertEquals(trashed.length, MAX_TRASH_PER_RUN);
});

Deno.test("orphan-scan: a known-query abort leaves the cursor untouched", async () => {
  const { db } = makeDb((table, column) =>
    table === "post_media" && column === "r2_key"
      ? { data: null, error: { message: "uri too long" } }
      : { data: [], error: null }
  );
  const { listOrphanKeyPage } = makePagedListing({
    "contas/": [{ keys: [], nextToken: "p1" }, { keys: ["contas/w/files/a.png"], nextToken: "p2" }],
  });
  const cp = makeCheckpoints({ [scanKeyFor("contas/")]: "p1" });
  const trashed: string[] = [];

  const result = await runOrphanScan({
    db,
    listOrphanKeyPage,
    trashObject: async (k) => {
      trashed.push(k);
    },
    ...cp.deps,
  });

  assertEquals(result.aborted, "contas/: known-query:post_media.r2_key");
  assertEquals(trashed, []);
  // Nothing on p1 was evaluated against a trustworthy known set, so p1 is where
  // the next run has to start. Advancing here would skip a page permanently.
  assertEquals(cp.store[scanKeyFor("contas/")], "p1");
});

Deno.test("orphan-scan: a listing error on a stored token clears it so the sweep is not wedged", async () => {
  const { db } = makeDb(() => ({ data: [], error: null }));
  const calls: Array<string | null> = [];
  const listOrphanKeyPage: OrphanScanDeps["listOrphanKeyPage"] = (prefix, _age, token) => {
    if (prefix !== "contas/") return Promise.resolve({ keys: [], nextToken: null });
    calls.push(token);
    return Promise.reject(new Error("InvalidArgument: continuation token"));
  };
  const cp = makeCheckpoints({ [scanKeyFor("contas/")]: "p7" });

  const result = await runOrphanScan({ db, listOrphanKeyPage, trashObject: async () => {}, ...cp.deps });

  assertEquals(calls, ["p7"]);
  assertEquals(result.aborted, "contas/: list:stale-token");
  // A token R2 rejects fails identically on every retry, so keeping it would
  // wedge this prefix forever. Dropping it re-sweeps covered ground once.
  assertEquals(cp.store[scanKeyFor("contas/")], null);
  // briefing-audio/ is untouched by the failure.
  assertEquals(result.targets[1].aborted, null);
});

Deno.test("orphan-scan: a checkpoint read failure skips the target without listing it", async () => {
  const { db } = makeDb(() => ({ data: [], error: null }));
  const { listOrphanKeyPage, calls } = makePagedListing({ "contas/": emptyPages(2) });

  const result = await runOrphanScan({
    db,
    listOrphanKeyPage,
    trashObject: async () => {},
    readCheckpoint: (scanKey) =>
      scanKey === scanKeyFor("contas/")
        ? Promise.reject(new Error("db down"))
        : Promise.resolve(null),
    writeCheckpoint: () => Promise.resolve(),
  });

  assertEquals(result.targets[0].aborted, "checkpoint-read");
  assertEquals(result.targets[0].pages, 0);
  // Never listed: without a resume position the only alternative is restarting
  // the cycle, which would burn the budget re-sweeping on every run.
  assertEquals(calls.filter((c) => c.prefix === "contas/").length, 0);
  assertEquals(result.targets[1].aborted, null);
});

Deno.test("orphan-scan: DEFAULT_PAGES_PER_RUN applies when the caller passes none", async () => {
  const { db } = makeDb(() => ({ data: [], error: null }));
  const { listOrphanKeyPage } = makePagedListing({
    "contas/": emptyPages(DEFAULT_PAGES_PER_RUN + 5),
  });
  const cp = makeCheckpoints();

  const result = await runOrphanScan({ db, listOrphanKeyPage, trashObject: async () => {}, ...cp.deps });

  assertEquals(result.targets[0].pages, DEFAULT_PAGES_PER_RUN);
  assertEquals(result.targets[0].cycleCompleted, false);
});
