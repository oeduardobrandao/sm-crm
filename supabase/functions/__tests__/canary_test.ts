import { assertEquals } from "./assert.ts";
import { CANARY_SAMPLE, runIntegrityCanary } from "../post-media-cleanup-cron/canary.ts";

function makeDb(rows: Array<{ id: number; r2_key: string }>, error: { message: string } | null = null) {
  return {
    from(_table: "files") {
      return {
        select(_c: string) {
          return {
            is(_col: string, _v: null) {
              return {
                order(_ocol: string, _o: { ascending: boolean }) {
                  return {
                    limit(_n: number) {
                      return Promise.resolve({ data: error ? null : rows, error });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

// Deterministic RNG cycling through [0,1).
function seqRandom(): () => number {
  let i = 0;
  return () => {
    i = (i + 7) % 100;
    return i / 100;
  };
}

Deno.test("canary: reports missing objects from the sampled pool", async () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ id: 1000 - i, r2_key: `contas/w/files/f-${i}.png` }));
  // First two indexes the deterministic RNG picks: floor(0.07*60)=4, floor(0.14*60)=8.
  const gone = new Set([rows[4].r2_key, rows[8].r2_key]);
  const result = await runIntegrityCanary({
    db: makeDb(rows),
    headObject: async (key) => (gone.has(key) ? null : { contentLength: 10 }),
    random: seqRandom(),
  });
  assertEquals(result.checked, CANARY_SAMPLE);
  assertEquals(result.missing.length, 2);
  assertEquals(result.missing.every((m) => gone.has(m.r2_key)), true);
});

Deno.test("canary: all-present sample reports zero missing", async () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: 500 - i, r2_key: `contas/w/files/ok-${i}.png` }));
  const result = await runIntegrityCanary({
    db: makeDb(rows),
    headObject: async () => ({ contentLength: 1 }),
    random: seqRandom(),
  });
  assertEquals(result.checked, CANARY_SAMPLE);
  assertEquals(result.missing.length, 0);
});

Deno.test("canary: pool smaller than the sample size checks every row once", async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: 10 - i, r2_key: `contas/w/files/s-${i}.png` }));
  const result = await runIntegrityCanary({
    db: makeDb(rows),
    headObject: async () => null,
    random: seqRandom(),
  });
  assertEquals(result.checked, 5);
  assertEquals(result.missing.length, 5);
});

Deno.test("canary: a failed pool query throws (caller logs, never deletes anything)", async () => {
  let threw = false;
  try {
    await runIntegrityCanary({
      db: makeDb([], { message: "db unavailable" }),
      headObject: async () => ({ contentLength: 1 }),
    });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});
