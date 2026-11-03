// _shared/file-client-scope.ts: which client a folder / file of the library belongs to.
import { assert, assertEquals } from "./assert.ts";
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

const page = (rows: Record<string, unknown>[]) => ({ data: rows, error: null });
const EMPTY = page([]);

Deno.test("subtreeHasHiddenClient: walks every level and resolves workflow / post folders in batch", async () => {
  const r = restricted([42]);
  const clean = createSupabaseQueryMock();
  clean.queue(
    "folders",
    "select",
    page([{ id: 6, source_type: null, source_id: null }, { id: 7, source_type: "client", source_id: 42 }]),
    EMPTY, // level 1 done
    page([{ id: 8, source_type: "workflow", source_id: 100 }]),
    EMPTY, // level 2 done
    page([{ id: 9, source_type: "post", source_id: 500 }]),
    EMPTY, // level 3 done
    EMPTY, // level 4: nothing below
  );
  clean.queue("workflows", "select", { data: [{ id: 100, cliente_id: 42 }], error: null });
  clean.queue("workflow_posts", "select", { data: [{ id: 500, cliente_id: 42 }], error: null });
  assertEquals(await subtreeHasHiddenClient(clean, r, 5, W), false);
  // Each level is ordered by id and paged with .range().
  const levelReads = clean.calls.filter((c) => c.table === "folders");
  assertEquals(levelReads.length, 7);
  assertEquals(levelReads[1].modifiers.find((m) => m.method === "range")?.args, [2, 1001]);
  assert(levelReads[0].modifiers.some((m) => m.method === "order" && m.args[0] === "id"));

  const deepHidden = createSupabaseQueryMock();
  deepHidden.queue(
    "folders",
    "select",
    page([{ id: 6, source_type: null, source_id: null }]),
    EMPTY,
    page([{ id: 9, source_type: "post", source_id: 500 }]),
    EMPTY,
    EMPTY,
  );
  deepHidden.queue("workflow_posts", "select", { data: [{ id: 500, cliente_id: 43 }], error: null });
  assertEquals(await subtreeHasHiddenClient(deepHidden, r, 5, W), true);

  // A workflow folder whose workflow is gone is hidden by default.
  const orphan = createSupabaseQueryMock();
  orphan.queue("folders", "select", page([{ id: 8, source_type: "workflow", source_id: 100 }]), EMPTY, EMPTY);
  orphan.queue("workflows", "select", { data: [], error: null });
  assertEquals(await subtreeHasHiddenClient(orphan, r, 5, W), true);

  assertEquals(await subtreeHasHiddenClient(createSupabaseQueryMock(), allClientsScope(), 5, W), false);
});

Deno.test("subtreeHasHiddenClient: a level past the row cap is read page by page (hidden on page 2)", async () => {
  const r = restricted([42]);
  const db = createSupabaseQueryMock();
  const firstPage = Array.from({ length: 1000 }, (_, i) => ({ id: 1000 + i, source_type: "client", source_id: 42 }));
  db.queue(
    "folders",
    "select",
    page(firstPage), // a full page: PostgREST would stop here at its 1000-row cap
    page([{ id: 5000, source_type: "client", source_id: 43 }]), // the hidden client, on page 2
    EMPTY, // level 1 done
    EMPTY, // level 2 (1001 parents, chunked in 3 reads of up to 500 ids)
    EMPTY,
    EMPTY,
  );
  assertEquals(await subtreeHasHiddenClient(db, r, 5, W), true);
  const reads = db.calls.filter((c) => c.table === "folders");
  assertEquals(reads[1].modifiers.find((m) => m.method === "range")?.args, [1000, 1999]);
  // The 1001-folder frontier of level 2 goes out in chunks of at most 500 ids.
  const level2 = reads.slice(3).map((c) => (c.modifiers.find((m) => m.method === "in")?.args[1] as number[]).length);
  assertEquals(level2, [500, 500, 1]);
});

Deno.test("subtreeHasHiddenClient: a page error throws (fails closed)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("folders", "select", page([{ id: 6, source_type: null, source_id: null }]), {
    data: null,
    error: { message: "boom" },
  });
  let threw = false;
  try {
    await subtreeHasHiddenClient(db, restricted([42]), 5, W);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
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
