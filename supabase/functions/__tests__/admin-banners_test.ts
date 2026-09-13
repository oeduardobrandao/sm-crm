import { assert, assertEquals } from "./assert.ts";
import { normalizeBanner, pickBannerColumns, validateBanner } from "../_shared/admin-banners.ts";

const BASE = { type: "info", content: "Olá", target_mode: "all", status: "draft", dismissible: true };

Deno.test("validateBanner: linha mínima válida", () => {
  assertEquals(validateBanner(BASE), null);
});

Deno.test("validateBanner: type, status e target_mode fora do enum", () => {
  assert(validateBanner({ ...BASE, type: "danger" }) !== null);
  assert(validateBanner({ ...BASE, status: "live" }) !== null);
  assert(validateBanner({ ...BASE, target_mode: "everyone" }) !== null);
});

Deno.test("validateBanner: content obrigatório, 1..500", () => {
  assert(validateBanner({ ...BASE, content: "" }) !== null);
  assert(validateBanner({ ...BASE, content: "   " }) !== null);
  assert(validateBanner({ ...BASE, content: "x".repeat(501) }) !== null);
  assertEquals(validateBanner({ ...BASE, content: "x".repeat(500) }), null);
});

Deno.test("validateBanner: link https ou caminho relativo; custom_color hex", () => {
  assertEquals(validateBanner({ ...BASE, link: "https://mesaas.com.br/novidades" }), null);
  assertEquals(validateBanner({ ...BASE, link: "/ajuda" }), null);
  assert(validateBanner({ ...BASE, link: "http://x.y" }) !== null);
  assert(validateBanner({ ...BASE, link: "//evil" }) !== null);
  assert(validateBanner({ ...BASE, link: "/\\evil.com" }) !== null);
  assert(validateBanner({ ...BASE, link: "/\t\\evil.com" }) !== null);
  assert(validateBanner({ ...BASE, link: "javascript:alert(1)" }) !== null);
  assertEquals(validateBanner({ ...BASE, custom_color: "#ffbf30" }), null);
  assert(validateBanner({ ...BASE, custom_color: "ffbf30" }) !== null);
  assert(validateBanner({ ...BASE, custom_color: "#fff" }) !== null);
});

Deno.test("validateBanner: targeting exige lista não vazia (array vazio barra aqui, não no banco)", () => {
  assert(validateBanner({ ...BASE, target_mode: "plan" }) !== null);
  assert(validateBanner({ ...BASE, target_mode: "plan", target_plan_ids: [] }) !== null);
  assertEquals(validateBanner({ ...BASE, target_mode: "plan", target_plan_ids: ["max"] }), null);
  assert(validateBanner({ ...BASE, target_mode: "workspace", target_workspace_ids: [] }) !== null);
  assertEquals(validateBanner({ ...BASE, target_mode: "workspace", target_workspace_ids: ["11111111-1111-1111-1111-111111111111"] }), null);
  assert(validateBanner({ ...BASE, target_mode: "plan", target_plan_ids: [1] }) !== null);
});

Deno.test("validateBanner: dismissible booleano; timestamps parseáveis e ends_at > starts_at", () => {
  assert(validateBanner({ ...BASE, dismissible: "yes" }) !== null);
  assert(validateBanner({ ...BASE, starts_at: "ontem" }) !== null);
  assert(validateBanner({ ...BASE, starts_at: "2026-09-02T00:00:00Z", ends_at: "2026-09-01T00:00:00Z" }) !== null);
  assertEquals(validateBanner({ ...BASE, starts_at: "2026-09-01T00:00:00Z", ends_at: "2026-09-02T00:00:00Z" }), null);
  assertEquals(validateBanner({ ...BASE, starts_at: null, ends_at: null }), null);
});

Deno.test("normalizeBanner numa linha legada ('' em link/custom_color) deixa a linha mesclada válida", () => {
  const legacy = { ...BASE, link: "", custom_color: "" };
  assert(validateBanner(legacy) !== null, "sem normalizar, '' falha");
  assertEquals(validateBanner({ ...normalizeBanner(legacy), status: "archived" }), null);
});

Deno.test("pickBannerColumns + normalizeBanner: só colunas da allowlist; trim; '' → null", () => {
  const picked = pickBannerColumns({ type: "info", content: "  Oi  ", link: "", custom_color: "", created_by: "x", id: "y" });
  assertEquals(Object.keys(picked).sort(), ["content", "custom_color", "link", "type"]);
  const n = normalizeBanner(picked);
  assertEquals(n, { type: "info", content: "Oi", link: null, custom_color: null });
});
