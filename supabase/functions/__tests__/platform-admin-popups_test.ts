import { assert, assertEquals } from "./assert.ts";
import { validatePages, validatePopupFields } from "../platform-admin/popups.ts";

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
});
