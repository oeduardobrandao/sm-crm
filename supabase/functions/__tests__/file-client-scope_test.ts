// _shared/file-client-scope.ts: which client a folder / file of the library belongs to.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import {
  fileAccess,
  folderClienteId,
  folderInfo,
  folderReadable,
  folderWritable,
  linkedToVisiblePost,
  NOT_IN_WORKSPACE,
  subtreeHasHiddenClient,
  visibleFileRows,
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

Deno.test("folderInfo: flags the Clientes root; readable vs writable follow migration C3", async () => {
  const root = { id: 1, conta_id: W, source_type: "root_clients", source_id: null };
  const client = { id: 2, conta_id: W, source_type: "client", source_id: 42 };
  const user = { id: 5, conta_id: W, source_type: null, source_id: null };
  const r = restricted([42]);
  const rootInfo = await folderInfo(tree([root]), 1, W);
  assertEquals(rootInfo, { client: null, rootClients: true });
  // The Clientes root is navigation only: readable, never writable by a restricted member.
  assertEquals([folderReadable(r, rootInfo), folderWritable(r, rootInfo)], [true, false]);
  // A folder with no client (a user folder at the top) is hidden.
  const userInfo = await folderInfo(tree([user]), 5, W);
  assertEquals(userInfo, { client: null, rootClients: false });
  assertEquals([folderReadable(r, userInfo), folderWritable(r, userInfo)], [false, false]);
  // An untyped folder inside a client folder belongs to that client.
  const inside = await folderInfo(tree([root, client, user]), 5, W);
  assertEquals([folderReadable(r, inside), folderWritable(r, inside)], [true, true]);
  const hidden = await folderInfo(tree([root, { ...client, source_id: 43 }]), 2, W);
  assertEquals([folderReadable(r, hidden), folderWritable(r, hidden)], [false, false]);
  // Missing items pass: the route answers its own not-found.
  assertEquals(await folderInfo(tree([{ ...user, conta_id: "other" }]), 5, W), NOT_IN_WORKSPACE);
  assertEquals([folderReadable(r, NOT_IN_WORKSPACE), folderWritable(r, NOT_IN_WORKSPACE)], [true, true]);
  // Unrestricted: everything.
  assertEquals([folderReadable(allClientsScope(), userInfo), folderWritable(allClientsScope(), rootInfo)], [true, true]);
});

const ME = "user-1";

Deno.test("fileAccess: own uploads, the folder's client and visible-post links open a file", async () => {
  const r = restricted([42]);
  // No client, not his: hidden (and no link to a visible post).
  assertEquals(await fileAccess(noneAgain(), r, 10, W, ME), { read: false, del: false, folderId: null });

  // No client, his upload: readable and deletable (delete "é dele" only without a client).
  const own = createSupabaseQueryMock();
  own.queue("files", "select", { data: { conta_id: W, folder_id: null, uploaded_by: ME }, error: null });
  assertEquals(await fileAccess(own, r, 10, W, ME), { read: true, del: true, folderId: null });

  // His upload inside a hidden client's folder: readable, but delete / move are not his to do.
  const ownHidden = tree([{ id: 2, conta_id: W, source_type: "client", source_id: 43 }]);
  ownHidden.queue("files", "select", { data: { conta_id: W, folder_id: 2, uploaded_by: ME }, error: null });
  assertEquals(await fileAccess(ownHidden, r, 10, W, ME), { read: true, del: false, folderId: 2 });

  // A colleague's file in a hidden client, linked to his own post there: readable, not deletable.
  const linked = tree([{ id: 2, conta_id: W, source_type: "client", source_id: 43 }]);
  linked.queue("files", "select", { data: { conta_id: W, folder_id: 2, uploaded_by: "other" }, error: null });
  linked.queue("post_file_links", "select", { data: [{ id: 1, file_id: 10, post_id: 50 }], error: null });
  linked.queue("workflow_posts", "select", { data: [{ id: 50, cliente_id: 43, responsavel_id: 9 }], error: null });
  const rOwn = { ...r, membroIds: new Set([9]) };
  assertEquals(await fileAccess(linked, rOwn, 10, W, ME), { read: true, del: false, folderId: 2 });

  // Assigned client's folder: everything.
  const assigned = tree([{ id: 2, conta_id: W, source_type: "client", source_id: 42 }]);
  assigned.queue("files", "select", { data: { conta_id: W, folder_id: 2, uploaded_by: "other" }, error: null });
  assertEquals(await fileAccess(assigned, r, 10, W, ME), { read: true, del: true, folderId: 2 });

  const foreign = createSupabaseQueryMock();
  foreign.queue("files", "select", { data: { conta_id: "other", folder_id: null, uploaded_by: ME }, error: null });
  assertEquals(await fileAccess(foreign, r, 10, W, ME), NOT_IN_WORKSPACE);
});

function noneAgain() {
  const db = createSupabaseQueryMock();
  db.queue("files", "select", { data: { conta_id: W, folder_id: null, uploaded_by: "other" }, error: null });
  db.queue("post_file_links", "select", { data: [], error: null });
  return db;
}

Deno.test("linkedToVisiblePost: only links to posts the member sees count; read errors throw", async () => {
  const r = { all: false, ids: new Set([42]), membroIds: new Set([9]) };
  const db = createSupabaseQueryMock();
  db.queue("post_file_links", "select", {
    data: [{ id: 1, file_id: 10, post_id: 50 }, { id: 2, file_id: 11, post_id: 51 }, { id: 3, file_id: 12, post_id: 52 }],
    error: null,
  }, { data: [], error: null });
  db.queue("workflow_posts", "select", {
    data: [
      { id: 50, cliente_id: 42, responsavel_id: null }, // assigned client
      { id: 51, cliente_id: 43, responsavel_id: 9 }, // his post in a hidden client
      { id: 52, cliente_id: 43, responsavel_id: 8 }, // a colleague's post in a hidden client
    ],
    error: null,
  });
  assertEquals([...(await linkedToVisiblePost(db, r, [10, 11, 12], W, ME))].sort(), [10, 11]);

  const broken = createSupabaseQueryMock();
  broken.queue("post_file_links", "select", { data: null, error: { message: "boom" } });
  let threw = false;
  try {
    await linkedToVisiblePost(broken, r, [10], W, ME);
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("visibleFileRows: a client folder shows everything; elsewhere only own or post-linked files", async () => {
  const r = restricted([42]);
  const rows = [
    { id: 10, uploaded_by: ME },
    { id: 11, uploaded_by: "other" },
    { id: 12, uploaded_by: "other" },
  ];
  assertEquals((await visibleFileRows(createSupabaseQueryMock(), rows, r, W, ME, 42)).length, 3);
  const db = createSupabaseQueryMock();
  db.queue("post_file_links", "select", { data: [{ id: 1, file_id: 12, post_id: 50 }], error: null }, {
    data: [],
    error: null,
  });
  db.queue("workflow_posts", "select", { data: [{ id: 50, cliente_id: 42, responsavel_id: null }], error: null });
  assertEquals((await visibleFileRows(db, rows, r, W, ME, null)).map((f) => f.id), [10, 12]);
  assertEquals((await visibleFileRows(createSupabaseQueryMock(), rows, allClientsScope(), W, ME, null)).length, 3);
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
  // Each level is drained by keyset pages on id: .gt(id, last seen).order(id).limit().
  const levelReads = clean.calls.filter((c) => c.table === "folders");
  assertEquals(levelReads.length, 7);
  assertEquals(levelReads[0].modifiers.find((m) => m.method === "gt"), undefined);
  assertEquals(levelReads[1].modifiers.find((m) => m.method === "gt")?.args, ["id", 7]);
  assert(levelReads[0].modifiers.some((m) => m.method === "order" && m.args[0] === "id"));
  assertEquals(levelReads[0].modifiers.find((m) => m.method === "limit")?.args, [1000]);
  assertEquals(levelReads.some((c) => c.modifiers.some((m) => m.method === "range")), false);

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

Deno.test("subtreeHasHiddenClient: a level past the row cap is read by keyset pages (hidden on page 2)", async () => {
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
  // Page 2 re-anchors on the last id of page 1 (keyset), so a concurrent delete cannot skip a row.
  assertEquals(reads[1].modifiers.find((m) => m.method === "gt")?.args, ["id", 1999]);
  assertEquals(reads[2].modifiers.find((m) => m.method === "gt")?.args, ["id", 5000]);
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

Deno.test("visibleFolderRows: hidden clients go; untyped folders follow the parent's client", async () => {
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
  // Under an assigned client's folder the untyped folder (3) belongs to that client.
  assertEquals((await visibleFolderRows(db, rows, r, W, 42)).map((x) => x.id), [1, 3, 4, 7]);
  // At the top (or under the Clientes root) an untyped folder has no client: hidden.
  const top = createSupabaseQueryMock();
  top.queue("workflows", "select", { data: [{ id: 100, cliente_id: 42 }, { id: 101, cliente_id: 43 }], error: null });
  top.queue("workflow_posts", "select", { data: [{ id: 500, cliente_id: 43 }], error: null });
  assertEquals((await visibleFolderRows(top, rows, r, W, null)).map((x) => x.id), [1, 4, 7]);
  assertEquals((await visibleFolderRows(createSupabaseQueryMock(), rows, allClientsScope(), W, null)).length, 7);
});
