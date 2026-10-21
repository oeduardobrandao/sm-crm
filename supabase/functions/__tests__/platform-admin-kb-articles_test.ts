import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { QueryCall } from "../../../test/shared/supabaseMock.ts";
import { handleReorderKbArticles } from "../platform-admin/kb-articles.ts";

type Db = ReturnType<typeof createSupabaseQueryMock>;
const H = { "Content-Type": "application/json" };
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function updates(db: Db) {
  return db.calls.filter((c: QueryCall) => c.table === "kb_articles" && c.operation === "update");
}

Deno.test("reorder-kb-articles: validates every item before writing", async () => {
  for (
    const items of [
      [],
      [{ id: A, display_order: 10 }, { id: 7, display_order: 20 }],
      [{ id: "not-a-uuid", display_order: 10 }],
      [{ id: A, display_order: -1 }],
      [{ id: A, display_order: 1.5 }],
      [{ id: A, display_order: 10_001 }],
    ]
  ) {
    const db = createSupabaseQueryMock();
    const res = await handleReorderKbArticles(db as never, { items }, H);
    assertEquals(res.status, 400, `items ${JSON.stringify(items)} must be rejected`);
    assertEquals(updates(db).length, 0);
  }
});

Deno.test("reorder-kb-articles: writes only display_order, row by row", async () => {
  const db = createSupabaseQueryMock();
  const res = await handleReorderKbArticles(
    db as never,
    { items: [{ id: A, display_order: 20 }, { id: B, display_order: 10 }] },
    H,
  );
  assertEquals(res.status, 200);
  const calls = updates(db);
  assertEquals(calls.map((c) => c.payload), [{ display_order: 20 }, { display_order: 10 }]);
  assertEquals(
    calls.map((c) => c.modifiers.filter((m) => m.method === "eq")),
    [[{ method: "eq", args: ["id", A] }], [{ method: "eq", args: ["id", B] }]],
  );
});

Deno.test("platform-admin: reorder-kb-articles is dispatched behind the admin gate", async () => {
  const src = await Deno.readTextFile(new URL("../platform-admin/index.ts", import.meta.url));
  const gate = src.indexOf("if (!admin)");
  assert(gate > 0, "admin gate not found");
  assert(src.indexOf(`case "reorder-kb-articles":`) > gate);
});
