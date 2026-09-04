import { assert, assertEquals } from "./assert.ts";
import {
  handleCreatePopup,
  handleDeletePopup,
  handleListPopups,
  handleUpdatePopup,
  validatePages,
  validatePopupFields,
} from "../platform-admin/popups.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const IMG = "contas/11111111-1111-1111-1111-111111111111/files/abc.png";

Deno.test("validatePages: aceita 1 página mínima e normaliza opcionais para null", () => {
  const r = validatePages([{ title: " Olá ", body: "corpo" }]);
  assert(r.ok, "esperava ok");
  assertEquals(r.pages, [{ title: "Olá", eyebrow: null, body: "corpo", image_key: null }]);
});

Deno.test("validatePages: aceita eyebrow e image_key válidos", () => {
  const r = validatePages([{ title: "T", body: "B", eyebrow: "Novo", image_key: IMG }]);
  assert(r.ok);
  assertEquals(r.pages[0].eyebrow, "Novo");
  assertEquals(r.pages[0].image_key, IMG);
});

Deno.test("validatePages: rejeita não-array, vazio e mais de 6", () => {
  assertEquals(validatePages("x").ok, false);
  assertEquals(validatePages([]).ok, false);
  const seven = Array.from({ length: 7 }, () => ({ title: "T", body: "B" }));
  assertEquals(validatePages(seven).ok, false);
});

Deno.test("validatePages: rejeita title/body vazios ou longos e eyebrow longo", () => {
  assertEquals(validatePages([{ title: "", body: "B" }]).ok, false);
  assertEquals(validatePages([{ title: "T", body: "   " }]).ok, false);
  assertEquals(validatePages([{ title: "x".repeat(121), body: "B" }]).ok, false);
  assertEquals(validatePages([{ title: "T", body: "x".repeat(2001) }]).ok, false);
  assertEquals(validatePages([{ title: "T", body: "B", eyebrow: "x".repeat(61) }]).ok, false);
});

Deno.test("validatePages: rejeita image_key fora do formato R2 e chaves desconhecidas", () => {
  assertEquals(validatePages([{ title: "T", body: "B", image_key: "https://x/y.png" }]).ok, false);
  assertEquals(validatePages([{ title: "T", body: "B", image_key: "contas/abc/files/x.png" }]).ok, false);
  assertEquals(validatePages([{ title: "T", body: "B", extra: 1 }]).ok, false);
});

Deno.test("validatePages: string vazia em eyebrow e image_key vira null", () => {
  const r = validatePages([{ title: "T", body: "B", eyebrow: "", image_key: "   " }]);
  assert(r.ok, "esperava ok");
  assertEquals(r.pages[0].eyebrow, null);
  assertEquals(r.pages[0].image_key, null);
});

Deno.test("validatePopupFields: par de CTA, until_cta, require_ack, tamanhos e formato da URL", () => {
  const base = { cta_label: null, cta_url: null, secondary_label: null, frequency: "once", require_ack: false, target_mode: "all" };
  assertEquals(validatePopupFields(base), null);
  assertEquals(validatePopupFields({ ...base, cta_label: "Ver", cta_url: "/ajuda" }), null);
  assertEquals(validatePopupFields({ ...base, cta_label: "Ver", cta_url: "https://x.y/z" }), null);
  assert(validatePopupFields({ ...base, cta_label: "Ver" }) !== null, "label sem url");
  assert(validatePopupFields({ ...base, cta_url: "/x" }) !== null, "url sem label");
  assert(validatePopupFields({ ...base, frequency: "until_cta" }) !== null, "until_cta sem cta");
  assert(validatePopupFields({ ...base, frequency: "until_cta", cta_label: "Ver", cta_url: "/x", require_ack: true }) !== null, "require_ack + until_cta");
  assert(validatePopupFields({ ...base, cta_label: "x".repeat(41), cta_url: "/x" }) !== null, "label longo");
  assert(validatePopupFields({ ...base, secondary_label: "x".repeat(41) }) !== null, "secondary longo");
  assert(validatePopupFields({ ...base, cta_label: "Ver", cta_url: "javascript:alert(1)" }) !== null, "url sem prefixo permitido");
  assert(validatePopupFields({ ...base, cta_label: "Ver", cta_url: "/" + "x".repeat(2048) }) !== null, "url longa");
  assert(validatePopupFields({ ...base, frequency: "weekly" }) !== null, "frequency inválida");
  assert(validatePopupFields({ ...base, cta_style: "neon" }) !== null, "cta_style inválido");
  // Targeting: o CHECK do banco só cobre NULL; array vazio precisa ser barrado aqui.
  assertEquals(validatePopupFields({ ...base, target_mode: "plan", target_plan_ids: ["pro"] }), null);
  assert(validatePopupFields({ ...base, target_mode: "plan", target_plan_ids: [] }) !== null, "plan sem ids");
  assert(validatePopupFields({ ...base, target_mode: "plan" }) !== null, "plan sem coluna");
  assert(validatePopupFields({ ...base, target_mode: "workspace", target_workspace_ids: [] }) !== null, "workspace sem ids");
  assert(validatePopupFields({ ...base, target_mode: "bogus" }) !== null, "target_mode inválido");
  // "" conta como ausente: par vazio é válido, e um lado vazio com o outro preenchido é par incompleto
  assertEquals(validatePopupFields({ ...base, cta_label: "", cta_url: "", secondary_label: "" }), null);
  assert(validatePopupFields({ ...base, cta_label: "Ver", cta_url: "" }) !== null, "url vazia com label");
  assert(validatePopupFields({ ...base, cta_label: "Ver", cta_url: "//evil.com" }) !== null, "url protocol-relative");
  assertEquals(validatePopupFields({ ...base, starts_at: "2026-09-01T00:00:00Z", ends_at: "2026-09-02T00:00:00Z" }), null);
  assert(validatePopupFields({ ...base, starts_at: "2026-09-02T00:00:00Z", ends_at: "2026-09-01T00:00:00Z" }) !== null, "ends antes de starts");
  assert(validatePopupFields({ ...base, starts_at: "2026-09-02T00:00:00Z", ends_at: "2026-09-02T00:00:00Z" }) !== null, "ends igual a starts");
  assert(validatePopupFields({ ...base, starts_at: "not-a-date", ends_at: "2026-09-02T00:00:00Z" }) !== null, "timestamp invalido");
});

type Resp = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

// Fake gravador de chamadas (mesmo padrão de platform-admin-plan-mutations_test.ts).
function makeFakeDb(responses: Record<string, Resp[]>) {
  const calls: Call[] = [];
  const queues: Record<string, Resp[]> = {};
  for (const k of Object.keys(responses)) queues[k] = [...responses[k]];
  function recorder(table: string) {
    // deno-lint-ignore no-explicit-any
    const rec: any = {};
    const next = (): Resp => (queues[table] ?? []).shift() ?? { data: null, error: null };
    for (const m of ["select", "eq", "in", "order", "insert", "update", "delete"]) {
      rec[m] = (...args: unknown[]) => { calls.push({ table, method: m, args }); return rec; };
    }
    rec.single = () => { calls.push({ table, method: "single", args: [] }); return Promise.resolve(next()); };
    rec.maybeSingle = () => { calls.push({ table, method: "maybeSingle", args: [] }); return Promise.resolve(next()); };
    rec.then = (resolve: (r: Resp) => unknown) => Promise.resolve(resolve(next()));
    return rec;
  }
  const db = { from: (t: string) => { calls.push({ table: t, method: "from", args: [t] }); return recorder(t); } };
  return { db: db as unknown as SupabaseClient, calls };
}

function lastPayload(calls: Call[], table: string, method: string): Record<string, unknown> | undefined {
  return calls.filter((x) => x.table === table && x.method === method).at(-1)?.args[0] as
    | Record<string, unknown>
    | undefined;
}

const H = { "Content-Type": "application/json" };
const PAGES = [{ title: "T", body: "B" }];
const ROW = {
  id: "p1", pages: [{ title: "T", eyebrow: null, body: "B", image_key: null }],
  cta_label: null, cta_url: null, cta_style: "ink", secondary_label: null,
  frequency: "once", require_ack: false, target_mode: "all", status: "draft",
};

Deno.test("list-popups: junta counts da view por popup, zerando ações ausentes", async () => {
  const { db, calls } = makeFakeDb({
    global_popups: [{ data: [{ ...ROW, id: "p1" }, { ...ROW, id: "p2" }], error: null }],
    popup_interaction_counts: [{
      data: [{ popup_id: "p1", action: "seen", users: 5 }, { popup_id: "p1", action: "cta", users: 2 }],
      error: null,
    }],
  });
  const res = await handleListPopups(db, { status: "active" }, H);
  assertEquals(res.status, 200);
  const { popups } = await res.json();
  assertEquals(popups[0].counts, { seen: 5, closed: 0, cta: 2, ack: 0 });
  assertEquals(popups[1].counts, { seen: 0, closed: 0, cta: 0, ack: 0 });
  assert(
    calls.some((c) => c.table === "global_popups" && c.method === "eq" && c.args[0] === "status"),
    "esperava filtro por status",
  );
});

Deno.test("create-popup: 400 sem pages/target_mode, 400 com pages inválido, 201 com allowlist e created_by", async () => {
  let r = await handleCreatePopup(makeFakeDb({}).db, { action: "create-popup", target_mode: "all" }, "adm", H);
  assertEquals(r.status, 400);
  assertEquals((await r.json()).error, "Invalid popup");
  r = await handleCreatePopup(makeFakeDb({}).db, { action: "create-popup", pages: [], target_mode: "all" }, "adm", H);
  assertEquals(r.status, 400);

  const { db, calls } = makeFakeDb({ global_popups: [{ data: ROW, error: null }] });
  r = await handleCreatePopup(
    db,
    { action: "create-popup", pages: PAGES, target_mode: "all", cta_label: "Ver", cta_url: "/x", bogus: 1 },
    "adm",
    H,
  );
  assertEquals(r.status, 201);
  const payload = lastPayload(calls, "global_popups", "insert")!;
  assertEquals(payload.created_by, "adm");
  assertEquals(payload.cta_label, "Ver");
  assertEquals((payload.pages as unknown[]).length, 1);
  assertEquals("bogus" in payload, false);
});

Deno.test("create-popup: 400 quando as regras cruzadas falham (until_cta sem CTA)", async () => {
  const r = await handleCreatePopup(
    makeFakeDb({}).db,
    { action: "create-popup", pages: PAGES, target_mode: "all", frequency: "until_cta" },
    "adm",
    H,
  );
  assertEquals(r.status, 400);
  assertEquals((await r.json()).error, "Invalid popup");
});

Deno.test("update-popup: valida sobre a linha mesclada e atualiza só a allowlist", async () => {
  const current = { ...ROW, cta_label: "Ver", cta_url: "/x" };
  const { db, calls } = makeFakeDb({
    global_popups: [{ data: current, error: null }, { data: { ...current, frequency: "until_cta" }, error: null }],
  });
  const r = await handleUpdatePopup(db, { action: "update-popup", popup_id: "p1", frequency: "until_cta", id: "hack" }, H);
  assertEquals(r.status, 200);
  const payload = lastPayload(calls, "global_popups", "update")!;
  assertEquals(payload.frequency, "until_cta");
  assertEquals("id" in payload, false);
});

Deno.test("update-popup: 400 quando a mescla viola regra (require_ack sobre until_cta), 404 sem linha", async () => {
  const current = { ...ROW, cta_label: "Ver", cta_url: "/x", frequency: "until_cta" };
  let r = await handleUpdatePopup(
    makeFakeDb({ global_popups: [{ data: current, error: null }] }).db,
    { action: "update-popup", popup_id: "p1", require_ack: true },
    H,
  );
  assertEquals(r.status, 400);
  r = await handleUpdatePopup(makeFakeDb({ global_popups: [{ data: null, error: null }] }).db,
    { action: "update-popup", popup_id: "nope", status: "active" }, H);
  assertEquals(r.status, 404);
  r = await handleUpdatePopup(makeFakeDb({}).db, { action: "update-popup", popup_id: "p1" }, H);
  assertEquals(r.status, 400);
});

Deno.test("delete-popup: só draft; 404 sem linha", async () => {
  let r = await handleDeletePopup(makeFakeDb({ global_popups: [{ data: { status: "active" }, error: null }] }).db, { popup_id: "p1" }, H);
  assertEquals(r.status, 400);
  r = await handleDeletePopup(makeFakeDb({ global_popups: [{ data: null, error: null }] }).db, { popup_id: "nope" }, H);
  assertEquals(r.status, 404);
  const { db, calls } = makeFakeDb({ global_popups: [{ data: { status: "draft" }, error: null }] });
  r = await handleDeletePopup(db, { popup_id: "p1" }, H);
  assertEquals(r.status, 200);
  assert(calls.some((c) => c.table === "global_popups" && c.method === "delete"));
});

Deno.test("list-popups: ignora action desconhecida na view e devolve lista vazia sem consultar a view", async () => {
  const { db } = makeFakeDb({
    global_popups: [{ data: [{ ...ROW, id: "p1" }], error: null }],
    popup_interaction_counts: [{ data: [{ popup_id: "p1", action: "bogus", users: 9 }], error: null }],
  });
  const res = await handleListPopups(db, {}, H);
  assertEquals((await res.json()).popups[0].counts, { seen: 0, closed: 0, cta: 0, ack: 0 });

  const empty = makeFakeDb({ global_popups: [{ data: [], error: null }] });
  const res2 = await handleListPopups(empty.db, {}, H);
  assertEquals((await res2.json()).popups, []);
  assert(!empty.calls.some((c) => c.table === "popup_interaction_counts"), "view consultada com lista vazia");
});

Deno.test("create-popup: texto só com espaços vira null antes de persistir (par nulo válido); url vazia com label é 400", async () => {
  const { db, calls } = makeFakeDb({ global_popups: [{ data: ROW, error: null }] });
  const r = await handleCreatePopup(
    db,
    { action: "create-popup", pages: PAGES, target_mode: "all", cta_label: "   ", cta_url: null, secondary_label: "" },
    "adm",
    H,
  );
  assertEquals(r.status, 201);
  const payload = lastPayload(calls, "global_popups", "insert")!;
  assertEquals(payload.cta_label, null);
  assertEquals(payload.secondary_label, null);

  const bad = await handleCreatePopup(
    makeFakeDb({}).db,
    { action: "create-popup", pages: PAGES, target_mode: "all", cta_label: "Ver", cta_url: "   " },
    "adm",
    H,
  );
  assertEquals(bad.status, 400);
});

Deno.test("update-popup: patch com espaços é normalizado antes da mescla", async () => {
  const current = { ...ROW, cta_label: "Ver", cta_url: "/x" };
  const { db, calls } = makeFakeDb({
    global_popups: [{ data: current, error: null }, { data: { ...current, secondary_label: null }, error: null }],
  });
  const r = await handleUpdatePopup(db, { action: "update-popup", popup_id: "p1", secondary_label: "  " }, H);
  assertEquals(r.status, 200);
  assertEquals(lastPayload(calls, "global_popups", "update")!.secondary_label, null);

  const bad = await handleUpdatePopup(
    makeFakeDb({ global_popups: [{ data: current, error: null }] }).db,
    { action: "update-popup", popup_id: "p1", cta_url: " " },
    H,
  );
  assertEquals(bad.status, 400);
});
