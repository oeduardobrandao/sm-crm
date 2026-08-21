import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildDefaultLayout } from "./default-layout.ts";
import { validateLayout } from "./layout.ts";

const seqId = () => { let n = 0; return () => `b${++n}`; };

Deno.test("layout padrão completo passa no validador e começa com capa", () => {
  const l = buildDefaultLayout({ hasAi: true, hasAudience: true, hasBestTimes: true, hasTags: true, makeId: seqId() });
  assert(validateLayout(l).ok);
  assertEquals(l.blocks[0].type, "cover");
  assertEquals(l.blocks[1].type, "ai_summary");
  const types = l.blocks.map((b) => b.type);
  assert(types.includes("top_posts"));
  assert(types.includes("audience_gender"));
  assert(types.includes("ai_recommendations"));
});

Deno.test("sem audiência/horários/tags/IA os blocos correspondentes somem", () => {
  const l = buildDefaultLayout({ hasAi: false, hasAudience: false, hasBestTimes: false, hasTags: false, makeId: seqId() });
  const types = l.blocks.map((b) => b.type);
  assert(!types.includes("audience_gender"));
  assert(!types.includes("chart_best_times"));
  assert(!types.includes("tags_table"));
  assert(!types.includes("ai_recommendations"));
  assert(!types.includes("ai_goals"));
  assert(types.includes("ai_summary")); // sempre presente: recebe fallback
  assert(validateLayout(l).ok);
});

Deno.test("ids são únicos", () => {
  const l = buildDefaultLayout({ hasAi: true, hasAudience: true, hasBestTimes: true, hasTags: true, makeId: seqId() });
  assertEquals(new Set(l.blocks.map((b) => b.id)).size, l.blocks.length);
});
