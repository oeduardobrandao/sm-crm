import { assert, assertEquals } from "./assert.ts";
import {
  allowlistClient,
  deriveFormatMeta,
  firstLine,
  performanceTier,
  quartiles,
} from "../mcp/content.ts";

Deno.test("deriveFormatMeta by tipo", () => {
  assertEquals(
    deriveFormatMeta("carrossel", [{ kind: "image" }, { kind: "image" }, { kind: "image" }]),
    { num_slides: 3, duration_seconds: null },
  );
  assertEquals(
    deriveFormatMeta("reels", [{ kind: "video", duration_seconds: 42 }]),
    { num_slides: null, duration_seconds: 42 },
  );
  assertEquals(deriveFormatMeta("feed", [{ kind: "image" }]), { num_slides: 1, duration_seconds: null });
  assertEquals(deriveFormatMeta("carrossel", []), { num_slides: null, duration_seconds: null });
});

Deno.test("firstLine returns first non-empty trimmed line", () => {
  assertEquals(firstLine("  \n\nHello world\nsecond"), "Hello world");
  assertEquals(firstLine(""), null);
  assertEquals(firstLine(null), null);
  assertEquals(firstLine(undefined), null);
});

Deno.test("quartiles + performanceTier", () => {
  const q = quartiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert(q !== null);
  assert(q!.p50 >= 5 && q!.p50 <= 6, "median of 1..10 ~ 5.5");
  assertEquals(quartiles([]), null);
  assertEquals(performanceTier(null, q), null);
  assertEquals(performanceTier(100, q), "top_quartile");
  assertEquals(performanceTier(1, q), "bottom_quartile");
});

Deno.test("allowlistClient drops sensitive fields", () => {
  const row = {
    id: 1, nome: "X", sigla: "X", especialidade: "derm", cor: "#fff", status: "ativo",
    email: "a@b.c", telefone: "99", valor_mensal: 1000, notion_page_url: "http://x", conta_id: "w",
  };
  const out = allowlistClient(row);
  assertEquals(out, { id: 1, nome: "X", sigla: "X", especialidade: "derm", cor: "#fff", status: "ativo" });
  assert(!("email" in out));
  assert(!("valor_mensal" in out));
  assert(!("conta_id" in out));
});
