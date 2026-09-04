import { assertEquals } from "./assert.ts";
import {
  EMPTY_KNOWN_FLOOR,
  KNOWN_CHUNK,
  MAX_TRASH_PER_RUN,
  runOrphanScan,
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
    db,
    listOrphanKeys: async (prefix) => (prefix === "contas/" ? candidates : []),
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
    db,
    listOrphanKeys: async (prefix) => (prefix === "contas/" ? candidates : []),
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
    db,
    listOrphanKeys: async (prefix) => (prefix === "contas/" ? candidates : []),
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
    db,
    listOrphanKeys: async (prefix) => (prefix === "contas/" ? candidates : []),
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
    db,
    listOrphanKeys: async (prefix) => (prefix === "contas/" ? candidates : []),
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
    prefix: "contas/", candidates: MAX_TRASH_PER_RUN + 30, trashed: MAX_TRASH_PER_RUN, capped: 30, aborted: null,
  });
  assertEquals(result.targets[1], {
    prefix: "briefing-audio/", candidates: 0, trashed: 0, capped: 0, aborted: null,
  });
});

Deno.test("orphan-scan: scans both contas/ and briefing-audio/ prefixes, once each", async () => {
  const calledPrefixes: string[] = [];
  const { db } = makeDb(() => ({ data: [], error: null }));
  const result = await runOrphanScan({
    db,
    listOrphanKeys: async (prefix) => {
      calledPrefixes.push(prefix);
      return [];
    },
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
    db,
    listOrphanKeys: async (prefix) => (prefix === "briefing-audio/" ? [key] : []),
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
    db,
    listOrphanKeys: async (prefix) => (prefix === "briefing-audio/" ? [key] : []),
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
    db,
    listOrphanKeys: async (prefix) => (prefix === "contas/" ? [contasOrphan] : [briefingKey]),
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
    db,
    listOrphanKeys: async (prefix) => (prefix === "contas/" ? ["contas/w/files/whatever.png"] : [briefingOrphan]),
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
    db,
    listOrphanKeys: async (prefix) => (prefix === "contas/" ? contasOrphans : briefingOrphans),
    trashObject: async (k) => {
      trashed.push(k);
    },
  });
  assertEquals(result.aborted, null);
  assertEquals(result.targets[0], {
    prefix: "contas/", candidates: MAX_TRASH_PER_RUN + 10, trashed: MAX_TRASH_PER_RUN, capped: 10, aborted: null,
  });
  assertEquals(result.targets[1], {
    prefix: "briefing-audio/", candidates: 3, trashed: 3, capped: 0, aborted: null,
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
    db,
    listOrphanKeys: async (prefix) => (prefix === "contas/" ? ["contas/w/files/a.png"] : ["briefing-audio/c/q/b.webm"]),
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
