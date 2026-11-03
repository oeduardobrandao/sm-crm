// _shared/file-client-scope.ts: which client a folder / file of the library belongs to.
import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import {
  fileClienteId,
  folderClienteId,
  itemVisible,
  NOT_IN_WORKSPACE,
  subtreeVisible,
  visibleFolderRows,
} from "../_shared/file-client-scope.ts";
import { allClientsScope, type ClientScope } from "../_shared/client-scope.ts";

const W = "conta-1";
const restricted = (ids: number[]): ClientScope => ({ all: false, ids: new Set(ids), membroIds: new Set() });

function tree(rows: Record<string, unknown>[]) {
  const db = createSupabaseQueryMock();
  db.queueRpc("folder_breadcrumbs", { data: rows.map((r) => ({ id: r.id })), error: null });
  db.queue("folders", "select", { data: rows, error: null });
  return db;
}

Deno.test("folderClienteId: nearest typed ancestor decides; root and user folders are workspace-level", async () => {
  const root = { id: 1, conta_id: W, source_type: "root_clients", source_id: null };
  const client = { id: 2, conta_id: W, source_type: "client", source_id: 42 };
  const user = { id: 5, conta_id: W, source_type: null, source_id: null };
  assertEquals(await folderClienteId(tree([root, client, user]), 5, W), 42);
  assertEquals(await folderClienteId(tree([root]), 1, W), null);
  assertEquals(await folderClienteId(tree([user]), 5, W), null);

  const wf = tree([root, client, { id: 6, conta_id: W, source_type: "workflow", source_id: 9 }]);
  wf.queue("workflows", "select", { data: { cliente_id: 43 }, error: null });
  assertEquals(await folderClienteId(wf, 6, W), 43);

  assertEquals(await folderClienteId(tree([{ ...user, conta_id: "other" }]), 5, W), NOT_IN_WORKSPACE);
});

Deno.test("fileClienteId: folder's client, post-reference files follow their post", async () => {
  const db = createSupabaseQueryMock();
  db.queue("files", "select", { data: { conta_id: W, folder_id: null, attached_to: null }, error: null });
  assertEquals(await fileClienteId(db, 10, W), null);

  const ref = createSupabaseQueryMock();
  ref.queue("files", "select", { data: { conta_id: W, folder_id: null, attached_to: "post_reference" }, error: null });
  ref.queue("post_references", "select", { data: { post_id: 50 }, error: null });
  ref.queue("workflow_posts", "select", { data: { cliente_id: 42 }, error: null });
  assertEquals(await fileClienteId(ref, 10, W), 42);

  const foreign = createSupabaseQueryMock();
  foreign.queue("files", "select", { data: { conta_id: "other", folder_id: null }, error: null });
  assertEquals(await fileClienteId(foreign, 10, W), NOT_IN_WORKSPACE);
});

Deno.test("item / subtree / listing visibility", () => {
  const r = restricted([42]);
  assertEquals([itemVisible(r, 42), itemVisible(r, 43), itemVisible(r, null)], [true, false, true]);
  assertEquals([subtreeVisible(r, 42), subtreeVisible(r, null), subtreeVisible(allClientsScope(), null)], [true, false, true]);
  const rows = [
    { id: 1, source_type: "client", source_id: 42 },
    { id: 2, source_type: "client", source_id: 43 },
    { id: 3, source_type: null, source_id: null },
  ];
  assertEquals(visibleFolderRows(rows, r).map((x) => x.id), [1, 3]);
  assertEquals(visibleFolderRows(rows, allClientsScope()).length, 3);
});
