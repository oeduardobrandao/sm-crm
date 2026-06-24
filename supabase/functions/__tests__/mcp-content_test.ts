import { assert, assertEquals } from "./assert.ts";
import {
  allowlistClient,
  buildPostFeedback,
  buildTiptapDoc,
  deriveFormatMeta,
  firstLine,
  pageContentToMarkdown,
  performanceTier,
  quartiles,
  topDistinctPostIds,
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

Deno.test("topDistinctPostIds: distinct in first-seen order; dups don't consume limit", () => {
  assertEquals(
    topDistinctPostIds(
      [{ post_id: 1 }, { post_id: 1 }, { post_id: 1 }, { post_id: 2 }, { post_id: 3 }],
      2,
    ),
    [1, 2], // the three "1" rows do not crowd out 2
  );
  assertEquals(topDistinctPostIds([{ post_id: 5 }, { post_id: 6 }], 10), [5, 6]); // fewer than limit
  assertEquals(topDistinctPostIds([], 5), []); // empty
});

Deno.test("buildPostFeedback groups, derives author, orders feedback/timeline/posts", () => {
  const feedback = [
    { post_id: 10, titulo: "A", status: "correcao_cliente", cliente_id: 1,
      action: "mensagem", comentario: "oi", is_workspace_user: true, created_at: "2026-06-01T10:00:00Z" },
    { post_id: 10, titulo: "A", status: "correcao_cliente", cliente_id: 1,
      action: "correcao", comentario: "muito clínico", is_workspace_user: false, created_at: "2026-06-02T10:00:00Z" },
    { post_id: 20, titulo: "B", status: "aprovado_cliente", cliente_id: 2,
      action: "aprovado", comentario: null, is_workspace_user: false, created_at: "2026-06-03T10:00:00Z" },
  ];
  const events = [
    { post_id: 10, from_status: "enviado_cliente", to_status: "correcao_cliente",
      source: "client", actor_name: null, created_at: "2026-06-02T10:00:00Z" },
    { post_id: 10, from_status: "rascunho", to_status: "enviado_cliente",
      source: "workspace_user", actor_name: "Ana", created_at: "2026-06-01T09:00:00Z" },
  ];
  const out = buildPostFeedback(feedback, events);

  // post 20 first: its latest feedback (06-03) is newer than post 10's (06-02)
  assertEquals(out.map((p) => p.post_id), [20, 10]);

  // post 20: aprovado w/ null comment, author client, no events -> timeline []
  assertEquals(out[0], {
    post_id: 20, titulo: "B", cliente_id: 2, status: "aprovado_cliente",
    latest_feedback_at: "2026-06-03T10:00:00Z",
    feedback: [{ action: "aprovado", comentario: null, author: "client", created_at: "2026-06-03T10:00:00Z" }],
    timeline: [],
  });

  // post 10: feedback newest-first; author derived; timeline oldest->newest
  assertEquals(out[1].latest_feedback_at, "2026-06-02T10:00:00Z");
  assertEquals(out[1].feedback, [
    { action: "correcao", comentario: "muito clínico", author: "client", created_at: "2026-06-02T10:00:00Z" },
    { action: "mensagem", comentario: "oi", author: "workspace", created_at: "2026-06-01T10:00:00Z" },
  ]);
  assertEquals(out[1].timeline, [
    { from_status: "rascunho", to_status: "enviado_cliente", source: "workspace_user", actor_name: "Ana", created_at: "2026-06-01T09:00:00Z" },
    { from_status: "enviado_cliente", to_status: "correcao_cliente", source: "client", actor_name: null, created_at: "2026-06-02T10:00:00Z" },
  ]);
});

Deno.test("buildPostFeedback empty input -> []", () => {
  assertEquals(buildPostFeedback([], []), []);
});

Deno.test("buildTiptapDoc builds core-node paragraphs", () => {
  assertEquals(buildTiptapDoc("Olá mundo"), {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Olá mundo" }] }],
  });
  // one paragraph per line; a blank line -> empty paragraph
  assertEquals(buildTiptapDoc("linha 1\n\nlinha 3"), {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "linha 1" }] },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "linha 3" }] },
    ],
  });
  // empty / undefined -> a doc with a single empty paragraph
  assertEquals(buildTiptapDoc(""), { type: "doc", content: [{ type: "paragraph" }] });
  assertEquals(buildTiptapDoc(undefined), { type: "doc", content: [{ type: "paragraph" }] });
});
