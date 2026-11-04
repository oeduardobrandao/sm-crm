import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { assertDocInScope, assertGenerateClientInScope } from "./client-scope-gate.ts";
import { DocActionError, GenerateError } from "./errors.ts";
import { allClientsScope, type ClientScope } from "../_shared/client-scope.ts";

const restricted = (ids: number[]): ClientScope => ({ all: false, ids: new Set(ids), membroIds: new Set([7]) });

function docDb(row: Record<string, unknown> | null, error: unknown = null) {
  const reads: string[] = [];
  return {
    reads,
    from: (table: string) => {
      reads.push(table);
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: row, error }),
      };
      return chain;
    },
  };
}

async function thrown(p: Promise<unknown> | (() => void)): Promise<unknown> {
  try {
    if (typeof p === "function") p();
    else await p;
    return null;
  } catch (e) {
    return e;
  }
}

Deno.test("report-docs scope: /generate on a hidden client is the existing not_found", async () => {
  const e = await thrown(() => assertGenerateClientInScope(restricted([9]), 42));
  assertEquals(e instanceof GenerateError && e.code, "not_found");
  assertEquals(await thrown(() => assertGenerateClientInScope(restricted([42]), 42)), null);
  assertEquals(await thrown(() => assertGenerateClientInScope(allClientsScope(), 42)), null);
});

Deno.test("report-docs scope: a document of a hidden client is the existing not_found", async () => {
  const e = await thrown(assertDocInScope(docDb({ client_id: 42, conta_id: "ws" }), restricted([9]), "ws", "d1"));
  assertEquals(e instanceof DocActionError && e.code, "not_found");
  assertEquals(await thrown(assertDocInScope(docDb({ client_id: 42, conta_id: "ws" }), restricted([42]), "ws", "d1")), null);
});

Deno.test("report-docs scope: unrestricted callers skip the extra read", async () => {
  const db = docDb(null);
  assertEquals(await thrown(assertDocInScope(db, allClientsScope(), "ws", "d1")), null);
  assertEquals(db.reads, []);
});

Deno.test("report-docs scope: a read error throws (generic 500), never passes", async () => {
  const e = await thrown(assertDocInScope(docDb(null, { message: "x" }), restricted([42]), "ws", "d1"));
  assertEquals(e instanceof Error && !(e instanceof DocActionError), true);
});
