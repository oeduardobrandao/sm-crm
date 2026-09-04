import { assert, assertEquals } from "./assert.ts";
import { createBanner, getBanner, listBanners, updateBanner } from "../mcp-admin/queries.ts";
import { expectInputError, has, insertPayload, makeDeps, makeFakeDb, updatePayload } from "./mcp-admin-helpers.ts";

const ROW = { id: "b1", type: "info", content: "Oi", link: null, custom_color: null, target_mode: "all", target_plan_ids: null, target_workspace_ids: null, dismissible: true, starts_at: null, ends_at: null, status: "draft", created_by: "adm-1", created_at: "t", updated_at: "t" };

Deno.test("listBanners: filtra por status e agrega dismissal_count numa única query", async () => {
  const { db, calls } = makeFakeDb({
    global_banners: [{ data: [ROW, { ...ROW, id: "b2" }], error: null }],
    banner_dismissals: [{ data: [{ banner_id: "b1" }, { banner_id: "b1" }, { banner_id: "b2" }], error: null }],
  });
  const r = await listBanners(makeDeps(db), { status: "draft" });
  assertEquals(r.banners.map((b) => [b.id, b.dismissal_count]), [["b1", 2], ["b2", 1]]);
  assert(has(calls, "global_banners", "eq", ["status", "draft"]));
  assert(has(calls, "banner_dismissals", "in", ["banner_id", ["b1", "b2"]]));
  assertEquals(calls.filter((c) => c.table === "banner_dismissals" && c.method === "from").length, 1);
});

Deno.test("getBanner: devolve o banner com dismissal_count; ausente → McpInputError", async () => {
  const { db } = makeFakeDb({ global_banners: [{ data: ROW, error: null }], banner_dismissals: [{ data: [{ banner_id: "b1" }], error: null }] });
  assertEquals((await getBanner(makeDeps(db), { banner_id: "b1" })).banner.dismissal_count, 1);
  await expectInputError(() => getBanner(makeDeps(makeFakeDb({ global_banners: [{ data: null, error: null }] }).db), { banner_id: "zz" }), "não encontrado");
});

Deno.test("createBanner: allowlist + normalize + validate, created_by = admin_id, status default draft", async () => {
  const { db, calls } = makeFakeDb({ global_banners: [{ data: { id: "b9", status: "draft" }, error: null }] });
  const r = await createBanner(makeDeps(db), { type: "warning", content: "  Manutenção  ", target_mode: "all", link: "", created_by: "hacker", id: "x" });
  assertEquals(r, { id: "b9", status: "draft" });
  assertEquals(insertPayload(calls, "global_banners"), { type: "warning", content: "Manutenção", target_mode: "all", link: null, created_by: "adm-1" });
  await expectInputError(() => createBanner(makeDeps(db), { type: "info", content: "x", target_mode: "plan", target_plan_ids: [] }), "plan");
});

Deno.test("updateBanner: valida a linha mesclada; patch vazio e id inexistente → McpInputError", async () => {
  const { db, calls } = makeFakeDb({ global_banners: [{ data: ROW, error: null }, { data: { id: "b1", status: "active" }, error: null }] });
  const r = await updateBanner(makeDeps(db), { banner_id: "b1", status: "active", custom_color: "#ffbf30" });
  assertEquals(r, { id: "b1", status: "active" });
  assertEquals(updatePayload(calls, "global_banners"), { status: "active", custom_color: "#ffbf30" });
  await expectInputError(() => updateBanner(makeDeps(db), { banner_id: "b1" }), "Nada para atualizar");
  await expectInputError(() => updateBanner(makeDeps(makeFakeDb({ global_banners: [{ data: null, error: null }] }).db), { banner_id: "zz", status: "active" }), "não encontrado");
  // patch que quebra a linha mesclada: virar 'plan' sem lista
  await expectInputError(() => updateBanner(makeDeps(makeFakeDb({ global_banners: [{ data: ROW, error: null }] }).db), { banner_id: "b1", target_mode: "plan" }), "plan");
  // linha legada com link "" continua editável (a atual é normalizada antes de mesclar)
  const legacy = makeFakeDb({ global_banners: [{ data: { ...ROW, link: "", custom_color: "" }, error: null }, { data: { id: "b1", status: "archived" }, error: null }] });
  assertEquals(await updateBanner(makeDeps(legacy.db), { banner_id: "b1", status: "archived" }), { id: "b1", status: "archived" });
});
