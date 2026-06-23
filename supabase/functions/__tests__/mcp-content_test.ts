import { assert, assertEquals } from "./assert.ts";
import {
  allowlistClient,
  deriveFormatMeta,
  firstLine,
  pageContentToMarkdown,
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

Deno.test("pageContentToMarkdown renders block types", () => {
  // markdown passthrough
  assertEquals(
    pageContentToMarkdown([{ type: "markdown", content: "## Estratégia\n- um" }]),
    "## Estratégia\n- um",
  );
  // heading levels + clamp
  assertEquals(pageContentToMarkdown([{ type: "heading", content: "T", level: 1 }]), "# T");
  assertEquals(pageContentToMarkdown([{ type: "heading", content: "T", level: 2 }]), "## T");
  assertEquals(pageContentToMarkdown([{ type: "heading", content: "T", level: 3 }]), "### T");
  assertEquals(pageContentToMarkdown([{ type: "heading", content: "T" }]), "# T"); // absent → 1
  assertEquals(pageContentToMarkdown([{ type: "heading", content: "T", level: 0 }]), "# T"); // clamp low
  assertEquals(pageContentToMarkdown([{ type: "heading", content: "T", level: 7 }]), "### T"); // clamp high
  // link with/without href
  assertEquals(
    pageContentToMarkdown([{ type: "link", content: "Brief", href: "https://x" }]),
    "[Brief](https://x)",
  );
  assertEquals(pageContentToMarkdown([{ type: "link", content: "Brief" }]), "Brief");
  // image (content is the URL)
  assertEquals(
    pageContentToMarkdown([{ type: "image", content: "https://img/x.png" }]),
    "![](https://img/x.png)",
  );
  // paragraph + blank-line join
  assertEquals(
    pageContentToMarkdown([
      { type: "paragraph", content: "um" },
      { type: "paragraph", content: "dois" },
    ]),
    "um\n\ndois",
  );
  // unknown type → paragraph fallback (mirrors Hub renderer default case)
  assertEquals(pageContentToMarkdown([{ type: "callout", content: "nota" }]), "nota");
});

Deno.test("pageContentToMarkdown fails closed on bad input", () => {
  // empty / non-array top-level
  assertEquals(pageContentToMarkdown([]), "");
  assertEquals(pageContentToMarkdown(null), "");
  assertEquals(pageContentToMarkdown(undefined), "");
  assertEquals(pageContentToMarkdown("nope"), "");
  assertEquals(pageContentToMarkdown(42), "");
  // malformed blocks: non-object skipped, non-string content contributes nothing
  assertEquals(
    pageContentToMarkdown(["str", 1, null, { type: "paragraph", content: 5 }]),
    "",
  );
  // non-string type → falls back to paragraph branch, renders its text
  assertEquals(pageContentToMarkdown([{ type: 123, content: "texto" }]), "texto");
  // empty image content skipped
  assertEquals(pageContentToMarkdown([{ type: "image", content: "" }]), "");
});
