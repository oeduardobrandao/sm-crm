import { assertEquals } from "./assert.ts";
import {
  EMPTY_KNOWN_FLOOR,
  KNOWN_CHUNK,
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
    listOrphanKeys: async () => candidates,
    deleteObject: async (key) => {
      deleted.push(key);
    },
  });
  assertEquals(result.aborted, null);
  assertEquals(result.deleted, 1);
  assertEquals(deleted, ["contas/w/files/obj-0.png"]);
  // 4 table/column pairs x 2 chunks each (251 candidates, chunk 200).
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
    listOrphanKeys: async () => candidates,
    deleteObject: async (key) => {
      deleted.push(key);
    },
  });
  assertEquals(result.aborted, "known-query:files.thumbnail_r2_key");
  assertEquals(result.deleted, 0);
  assertEquals(deleted.length, 0);
});

Deno.test("orphan-scan: empty known set with many candidates trips the circuit breaker", async () => {
  const candidates = Array.from({ length: EMPTY_KNOWN_FLOOR }, (_, i) => `contas/w/files/obj-${i}.png`);
  const { db } = makeDb(() => ({ data: [], error: null }));
  const deleted: string[] = [];
  const result = await runOrphanScan({
    db,
    listOrphanKeys: async () => candidates,
    deleteObject: async (key) => {
      deleted.push(key);
    },
  });
  assertEquals(result.aborted, "empty-known-set");
  assertEquals(result.deleted, 0);
  assertEquals(deleted.length, 0);
});

Deno.test("orphan-scan: a small all-orphan candidate set below the floor still deletes", async () => {
  const candidates = ["contas/w/files/tmp-a.png", "contas/w/files/tmp-b.png"];
  const { db } = makeDb(() => ({ data: [], error: null }));
  const deleted: string[] = [];
  const result = await runOrphanScan({
    db,
    listOrphanKeys: async () => candidates,
    deleteObject: async (key) => {
      deleted.push(key);
    },
  });
  assertEquals(result.aborted, null);
  assertEquals(result.deleted, 2);
});
