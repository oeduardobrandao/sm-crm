// _shared/file-client-scope.ts: which client a folder / file of the library belongs to.
import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import {
  fileClienteId,
  folderClienteId,
  itemVisible,
  NOT_IN_WORKSPACE,
  subtreeHasHiddenClient,
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

Deno.test("itemVisible: assigned and workspace-level pass, hidden clients do not", () => {
  const r = restricted([42]);
  assertEquals([itemVisible(r, 42), itemVisible(r, 43), itemVisible(r, null)], [true, false, true]);
  assertEquals(itemVisible(r, NOT_IN_WORKSPACE), true); // the route answers its own not-found
});

Deno.test("subtreeHasHiddenClient: walks every level and resolves workflow / post folders in batch", async () => {
  const r = restricted([42]);
  const clean = createSupabaseQueryMock();
  clean.queue(
    "folders",
    "select",
    { data: [{ id: 6, source_type: null, source_id: null }, { id: 7, source_type: "client", source_id: 42 }], error: null },
    { data: [{ id: 8, source_type: "workflow", source_id: 100 }], error: null },
    { data: [{ id: 9, source_type: "post", source_id: 500 }], error: null },
    { data: [], error: null },
  );
  clean.queue("workflows", "select", { data: [{ id: 100, cliente_id: 42 }], error: null });
  clean.queue("workflow_posts", "select", { data: [{ id: 500, cliente_id: 42 }], error: null });
  assertEquals(await subtreeHasHiddenClient(clean, r, 5, W), false);

  const deepHidden = createSupabaseQueryMock();
  deepHidden.queue(
    "folders",
    "select",
    { data: [{ id: 6, source_type: null, source_id: null }], error: null },
    { data: [{ id: 9, source_type: "post", source_id: 500 }], error: null },
    { data: [], error: null },
  );
  deepHidden.queue("workflow_posts", "select", { data: [{ id: 500, cliente_id: 43 }], error: null });
  assertEquals(await subtreeHasHiddenClient(deepHidden, r, 5, W), true);

  // A workflow folder whose workflow is gone is hidden by default.
  const orphan = createSupabaseQueryMock();
  orphan.queue("folders", "select", { data: [{ id: 8, source_type: "workflow", source_id: 100 }], error: null }, {
    data: [],
    error: null,
  });
  orphan.queue("workflows", "select", { data: [], error: null });
  assertEquals(await subtreeHasHiddenClient(orphan, r, 5, W), true);

  assertEquals(await subtreeHasHiddenClient(createSupabaseQueryMock(), allClientsScope(), 5, W), false);
});

Deno.test("visibleFolderRows: drops client, workflow and post folders of hidden clients", async () => {
  const r = restricted([42]);
  const db = createSupabaseQueryMock();
  db.queue("workflows", "select", { data: [{ id: 100, cliente_id: 42 }, { id: 101, cliente_id: 43 }], error: null });
  db.queue("workflow_posts", "select", { data: [{ id: 500, cliente_id: 43 }], error: null });
  const rows = [
    { id: 1, source_type: "client", source_id: 42 },
    { id: 2, source_type: "client", source_id: 43 },
    { id: 3, source_type: null, source_id: null },
    { id: 4, source_type: "workflow", source_id: 100 },
    { id: 5, source_type: "workflow", source_id: 101 },
    { id: 6, source_type: "post", source_id: 500 },
    { id: 7, source_type: "root_clients", source_id: null },
  ];
  assertEquals((await visibleFolderRows(db, rows, r, W)).map((x) => x.id), [1, 3, 4, 7]);
  assertEquals((await visibleFolderRows(createSupabaseQueryMock(), rows, allClientsScope(), W)).length, 7);
});
