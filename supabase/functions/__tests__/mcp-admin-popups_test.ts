import { assert, assertEquals } from "./assert.ts";
import { createPopup, getPopup, listPopups, updatePopup } from "../mcp-admin/queries.ts";
import { expectInputError, has, insertPayload, makeDeps, makeFakeDb, rpcPayload, updatePayload } from "./mcp-admin-helpers.ts";

const CONTA = "11111111-1111-1111-1111-111111111111";
const KEY_OLD = `contas/${CONTA}/files/old.png`;
const KEY_NEW = `contas/${CONTA}/files/new.png`;
const ROW = { id: "p1", pages: [{ title: "T", eyebrow: null, body: "B", image_key: KEY_OLD }], cta_label: null, cta_url: null, cta_style: "ink", secondary_label: null, frequency: "once", require_ack: false, target_mode: "all", target_plan_ids: null, target_workspace_ids: null, starts_at: null, ends_at: null, status: "draft", created_by: "adm-1", created_at: "t", updated_at: "t" };

Deno.test("listPopups: junta contadores da view popup_interaction_counts", async () => {
  const { db } = makeFakeDb({
    global_popups: [{ data: [ROW], error: null }],
    popup_interaction_counts: [{ data: [{ popup_id: "p1", action: "seen", users: 4 }, { popup_id: "p1", action: "cta", users: 1 }], error: null }],
  });
  const r = await listPopups(makeDeps(db), {});
  assertEquals(r.popups[0].counts, { seen: 4, closed: 0, cta: 1, ack: 0 });
});

Deno.test("getPopup: ausente → McpInputError", async () => {
  await expectInputError(() => getPopup(makeDeps(makeFakeDb({ global_popups: [{ data: null, error: null }] }).db), { popup_id: "zz" }), "não encontrado");
});

Deno.test("createPopup sem imagens: não consulta profiles; created_by = admin_id; cta_label/cta_url validados", async () => {
  const { db, calls } = makeFakeDb({ global_popups: [{ data: { id: "p9", status: "draft" }, error: null }] });
  const r = await createPopup(makeDeps(db), { pages: [{ title: " Olá ", body: "corpo" }], target_mode: "all", cta_label: "Ver", cta_url: "/ajuda" });
  assertEquals(r, { id: "p9", status: "draft" });
  const ins = insertPayload(calls, "global_popups")!;
  assertEquals(ins.pages, [{ title: "Olá", eyebrow: null, body: "corpo", image_key: null }]);
  assertEquals(ins.created_by, "adm-1");
  assert(!calls.some((c) => c.table === "profiles"));
  await expectInputError(() => createPopup(makeDeps(db), { pages: [{ title: "T", body: "B" }], target_mode: "all", cta_label: "Ver" }), "cta");
  await expectInputError(() => createPopup(makeDeps(db), { pages: [], target_mode: "all" }), "pages");
});

Deno.test("createPopup com imagem nova: resolve conta do admin, finaliza (headObject + files) e persiste", async () => {
  const { db, calls } = makeFakeDb(
    { profiles: [{ data: { conta_id: CONTA }, error: null }], files: [{ data: null, error: null }], global_popups: [{ data: { id: "p9", status: "draft" }, error: null }] },
    { file_insert_with_quota: [{ data: { id: 3 }, error: null }] },
  );
  await createPopup(makeDeps(db), { pages: [{ title: "T", body: "B", image_key: KEY_NEW }], target_mode: "all" });
  assertEquals(rpcPayload(calls, "file_insert_with_quota")?.r2_key, KEY_NEW);
  assert(has(calls, "global_popups", "insert", [{ pages: [{ title: "T", eyebrow: null, body: "B", image_key: KEY_NEW }], target_mode: "all", created_by: "adm-1" }]));
});

Deno.test("createPopup com imagem de outro workspace, ou admin sem conta_id → McpInputError", async () => {
  await expectInputError(() => createPopup(makeDeps(makeFakeDb({ profiles: [{ data: { conta_id: CONTA }, error: null }] }).db), { pages: [{ title: "T", body: "B", image_key: "contas/22222222-2222-2222-2222-222222222222/files/x.png" }], target_mode: "all" }), "another workspace");
  await expectInputError(() => createPopup(makeDeps(makeFakeDb({ profiles: [{ data: null, error: null }] }).db), { pages: [{ title: "T", body: "B", image_key: KEY_NEW }], target_mode: "all" }), "workspace");
});

Deno.test("updatePopup: image_key já persistida passa sem profiles/headObject; nova é finalizada; regras cruzadas na linha mesclada", async () => {
  const { db, calls } = makeFakeDb({ global_popups: [{ data: ROW, error: null }, { data: { id: "p1", status: "active" }, error: null }] });
  const r = await updatePopup(makeDeps(db), { popup_id: "p1", status: "active", pages: [{ title: "T2", body: "B2", image_key: KEY_OLD }] });
  assertEquals(r, { id: "p1", status: "active" });
  assertEquals(updatePayload(calls, "global_popups")!.pages, [{ title: "T2", eyebrow: null, body: "B2", image_key: KEY_OLD }]);
  assert(!calls.some((c) => c.table === "profiles" || c.table === "files"));

  const { db: db2, calls: calls2 } = makeFakeDb(
    { global_popups: [{ data: ROW, error: null }, { data: { id: "p1", status: "draft" }, error: null }], profiles: [{ data: { conta_id: CONTA }, error: null }], files: [{ data: null, error: null }] },
    { file_insert_with_quota: [{ data: { id: 4 }, error: null }] },
  );
  await updatePopup(makeDeps(db2), { popup_id: "p1", pages: [{ title: "T", body: "B", image_key: KEY_NEW }] });
  assertEquals(rpcPayload(calls2, "file_insert_with_quota")?.r2_key, KEY_NEW);

  await expectInputError(() => updatePopup(makeDeps(makeFakeDb({ global_popups: [{ data: ROW, error: null }] }).db), { popup_id: "p1", frequency: "until_cta" }), "until_cta");
  await expectInputError(() => updatePopup(makeDeps(makeFakeDb({ global_popups: [{ data: null, error: null }] }).db), { popup_id: "zz", status: "active" }), "não encontrado");
});
