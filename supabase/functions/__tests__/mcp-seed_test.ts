import { assertEquals } from "./assert.ts";
import { MCP_PROP_ANOTACAO, MCP_PROP_MODO, planTemplateSeed } from "../mcp/seed.ts";

Deno.test("planTemplateSeed: adds both when room and none exist", () => {
  const r = planTemplateSeed([], 0, 10);
  assertEquals(r.map((d) => d.name), [MCP_PROP_MODO, MCP_PROP_ANOTACAO]);
});

Deno.test("planTemplateSeed: skips already-existing defs (idempotent)", () => {
  const r = planTemplateSeed([MCP_PROP_MODO], 1, 10);
  assertEquals(r.map((d) => d.name), [MCP_PROP_ANOTACAO]);
});

Deno.test("planTemplateSeed: respects remaining cap (only 1 slot)", () => {
  const r = planTemplateSeed([], 4, 5);
  assertEquals(r.map((d) => d.name), [MCP_PROP_MODO]);
});

Deno.test("planTemplateSeed: at cap => nothing (trigger would otherwise block)", () => {
  assertEquals(planTemplateSeed([], 5, 5), []);
});

Deno.test("planTemplateSeed: unlimited cap (null max)", () => {
  const r = planTemplateSeed([], 999, null);
  assertEquals(r.map((d) => d.name), [MCP_PROP_MODO, MCP_PROP_ANOTACAO]);
});
