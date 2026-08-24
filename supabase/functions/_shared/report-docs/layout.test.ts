import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { BLOCK_TYPES, LAYOUT_VERSION, validateLayout } from "./layout.ts";

const block = (over: Record<string, unknown> = {}) => ({
  id: "b1", type: "text", size: "full", ...over,
});
const layout = (blocks: unknown[]) => ({ version: LAYOUT_VERSION, blocks });

Deno.test("validateLayout aceita layout mínimo válido", () => {
  const r = validateLayout(layout([block()]));
  assert(r.ok);
  assertEquals(r.layout.blocks.length, 1);
});

Deno.test("validateLayout rejeita não-objeto, version errada e blocks ausente", () => {
  assert(!validateLayout(null).ok);
  assert(!validateLayout([]).ok);
  assert(!validateLayout({ version: 99, blocks: [] }).ok);
  assert(!validateLayout({ version: LAYOUT_VERSION }).ok);
});

Deno.test("validateLayout rejeita bloco com tipo desconhecido, size inválido e id vazio", () => {
  assert(!validateLayout(layout([block({ type: "nope" })])).ok);
  assert(!validateLayout(layout([block({ size: "xl" })])).ok);
  assert(!validateLayout(layout([block({ id: "" })])).ok);
});

Deno.test("validateLayout: text só em blocos textuais; count do top_posts entre 1 e 12", () => {
  assert(validateLayout(layout([block({ type: "ai_summary", text: { type: "doc" } })])).ok);
  assert(!validateLayout(layout([block({ type: "kpi_reach", size: "third", text: {} })])).ok);
  assert(validateLayout(layout([block({ type: "top_posts", config: { count: 6 } })])).ok);
  assert(!validateLayout(layout([block({ type: "top_posts", config: { count: 0 } })])).ok);
  assert(!validateLayout(layout([block({ type: "top_posts", config: { count: 13 } })])).ok);
});

Deno.test("validateLayout rejeita mais de 200 blocos e ids duplicados", () => {
  const many = Array.from({ length: 201 }, (_, i) => block({ id: `b${i}` }));
  assert(!validateLayout(layout(many)).ok);
  assert(!validateLayout(layout([block({ id: "x" }), block({ id: "x" })])).ok);
});

Deno.test("catálogo tem os 26 tipos da spec (25 + kpi_views de 2026-08)", () => {
  assertEquals(BLOCK_TYPES.length, 26);
});

Deno.test("validateLayout: accent opcional precisa ser hex #rrggbb", () => {
  assert(validateLayout({ version: LAYOUT_VERSION, accent: "#9f1239", blocks: [block()] }).ok);
  assert(!validateLayout({ version: LAYOUT_VERSION, accent: "vermelho", blocks: [block()] }).ok);
  assert(!validateLayout({ version: LAYOUT_VERSION, accent: "#fff", blocks: [block()] }).ok);
});
