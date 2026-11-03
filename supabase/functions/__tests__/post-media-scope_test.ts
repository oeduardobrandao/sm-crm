// _shared/post-media-scope.ts: the post check of post-media-upload-url and post-media-finalize.
import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { POST_NOT_FOUND, postMediaWriteGate } from "../_shared/post-media-scope.ts";
import { allClientsScope, type ClientScope } from "../_shared/client-scope.ts";

const W = "conta-1";
const restrictedTo = (ids: number[], membroIds: number[] = []) => () =>
  Promise.resolve<ClientScope>({ all: false, ids: new Set(ids), membroIds: new Set(membroIds) });
const postRow = (over: Record<string, unknown> = {}) => ({
  data: { id: 50, conta_id: W, cliente_id: 42, responsavel_id: 9, ...over },
  error: null,
});

async function gate(row: unknown, loader: Parameters<typeof postMediaWriteGate>[4]) {
  const db = createSupabaseQueryMock();
  db.queue("workflow_posts", "select", row as never);
  return await postMediaWriteGate(db, "user-1", W, 50, loader);
}

Deno.test("post-media gate: assigned client and unrestricted callers may write", async () => {
  assertEquals(await gate(postRow(), restrictedTo([42])), null);
  assertEquals(await gate(postRow(), () => Promise.resolve(allClientsScope())), null);
});

Deno.test("post-media gate: a hidden client's post answers exactly like a missing or foreign one", async () => {
  const hidden = await gate(postRow(), restrictedTo([7]));
  assertEquals(hidden, POST_NOT_FOUND);
  assertEquals(await gate({ data: null, error: null }, restrictedTo([7])), hidden);
  assertEquals(await gate(postRow({ conta_id: "other" }), restrictedTo([7])), hidden);
});

Deno.test("post-media gate: own post in a hidden client is limitado (writes have no é dele)", async () => {
  assertEquals(await gate(postRow(), restrictedTo([7], [9])), {
    status: 403,
    body: { error: "Seu acesso é limitado aos clientes atribuídos." },
  });
});

Deno.test("post-media gate: a scope read error is a generic 500", async () => {
  assertEquals(await gate(postRow(), () => Promise.reject(new Error("boom"))), {
    status: 500,
    body: { error: "Internal server error" },
  });
});
