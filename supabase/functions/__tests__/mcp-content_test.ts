import { assert, assertEquals } from "./assert.ts";
import {
  allowlistClient,
  buildPostFeedback,
  buildPropertyDefinitions,
  buildTiptapDoc,
  deriveFormatMeta,
  extractTemplateOptionIds,
  firstLine,
  instantiateTemplateEtapas,
  isPlanLimitExceeded,
  normalizeTemplateEtapas,
  pageContentToMarkdown,
  performanceTier,
  projectTemplateEtapas,
  quartiles,
  topDistinctPostIds,
  validatePropertyValue,
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

Deno.test("projectTemplateEtapas projects, drops responsavel_id, applies defaults", () => {
  const raw = [
    { nome: "Conteúdo", prazo_dias: 0, tipo_prazo: "corridos", tipo: "padrao", responsavel_id: 9 },
    { nome: "Aprovação", prazo_dias: 2, tipo_prazo: "uteis", tipo: "aprovacao_cliente" },
    { nome: "Sem tipo" }, // missing prazo_dias/tipo_prazo/tipo -> defaults
  ];
  assertEquals(projectTemplateEtapas(raw), [
    { nome: "Conteúdo", prazo_dias: 0, tipo_prazo: "corridos", tipo: "padrao" },
    { nome: "Aprovação", prazo_dias: 2, tipo_prazo: "uteis", tipo: "aprovacao_cliente" },
    { nome: "Sem tipo", prazo_dias: 0, tipo_prazo: "corridos", tipo: "padrao" },
  ]);
});

Deno.test("projectTemplateEtapas fails closed on non-array and skips non-objects", () => {
  assertEquals(projectTemplateEtapas(null), []);
  assertEquals(projectTemplateEtapas({}), []);
  assertEquals(projectTemplateEtapas("x"), []);
  assertEquals(projectTemplateEtapas([null, "nope", 3, ["inner"], { nome: "ok" }]), [
    { nome: "ok", prazo_dias: 0, tipo_prazo: "corridos", tipo: "padrao" },
  ]);
});

Deno.test("extractTemplateOptionIds pulls string ids from config.options, defensive", () => {
  assertEquals(extractTemplateOptionIds({ options: [{ id: "a", label: "A" }, { id: "b" }] }), ["a", "b"]);
  assertEquals(extractTemplateOptionIds({ options: [{ label: "no id" }, { id: 5 }, "x", null] }), []);
  assertEquals(extractTemplateOptionIds({ options: [{ id: "a" }, { id: 5 }, { id: "b" }, "x", { id: "c" }] }), ["a", "b", "c"]);
  assertEquals(extractTemplateOptionIds({}), []);
  assertEquals(extractTemplateOptionIds(null), []);
  assertEquals(extractTemplateOptionIds([{ id: "a" }]), []); // array config, not object-with-options
  assertEquals(extractTemplateOptionIds("x"), []);
});

Deno.test("instantiateTemplateEtapas: contiguous ordem, responsavel_id kept, lifecycle fields, no workflow_id", () => {
  const rows = instantiateTemplateEtapas([
    { nome: "Roteiro", prazo_dias: 2, tipo_prazo: "uteis", tipo: "padrao", responsavel_id: 8 },
    { nome: "Aprovação", prazo_dias: 1, tipo_prazo: "corridos", tipo: "aprovacao_cliente" },
  ], "T");
  assertEquals(rows, [
    { ordem: 0, nome: "Roteiro", prazo_dias: 2, tipo_prazo: "uteis", tipo: "padrao", responsavel_id: 8, status: "ativo", iniciado_em: "T", concluido_em: null, data_limite: null },
    { ordem: 1, nome: "Aprovação", prazo_dias: 1, tipo_prazo: "corridos", tipo: "aprovacao_cliente", responsavel_id: null, status: "pendente", iniciado_em: null, concluido_em: null, data_limite: null },
  ]);
  assert(!Object.hasOwn(rows[0], "workflow_id"), "no workflow_id key");
});

Deno.test("instantiateTemplateEtapas: fail-closed, skip non-objects, integer guards, defaults", () => {
  assertEquals(instantiateTemplateEtapas(null, "T"), []);
  assertEquals(instantiateTemplateEtapas({}, "T"), []);
  assertEquals(instantiateTemplateEtapas("x", "T"), []);
  const rows = instantiateTemplateEtapas(
    [null, "nope", { prazo_dias: 1.5, responsavel_id: 2.7 }, ["arr"], { nome: "ok" }],
    "T",
  );
  assertEquals(rows.length, 2);                  // 2 object elements survive
  assertEquals(rows[0].ordem, 0);
  assertEquals(rows[0].prazo_dias, 0);           // 1.5 (non-integer) -> 0
  assertEquals(rows[0].responsavel_id, null);    // 2.7 (non-integer) -> null
  assertEquals(rows[0].nome, "");                // missing -> ""
  assertEquals(rows[0].tipo_prazo, "corridos");  // default
  assertEquals(rows[0].tipo, "padrao");          // default
  assertEquals(rows[1].ordem, 1);                // contiguous after skips
  assertEquals(rows[1].nome, "ok");
});

Deno.test("validatePropertyValue: settable types, null clear, non-settable rejection, options", () => {
  const opts = new Set(["o1", "o2"]);
  // null clears any settable type
  assertEquals(validatePropertyValue("text", null, opts), null);
  assertEquals(validatePropertyValue("select", null, opts), null);
  // non-settable rejected even for null
  assert(validatePropertyValue("person", null, opts) !== null);
  assert(validatePropertyValue("created_time", "2026-01-01", opts) !== null);
  assert(validatePropertyValue("bogus", "x", opts) !== null);
  // scalars: happy + mismatch
  assertEquals(validatePropertyValue("text", "hi", opts), null);
  assert(validatePropertyValue("text", 5, opts) !== null);
  assertEquals(validatePropertyValue("number", 5, opts), null);
  assert(validatePropertyValue("number", "5", opts) !== null);
  assertEquals(validatePropertyValue("checkbox", true, opts), null);
  assert(validatePropertyValue("checkbox", "true", opts) !== null);
  assertEquals(validatePropertyValue("date", "2026-06-24", opts), null);
  assert(validatePropertyValue("date", "24/06/2026", opts) !== null);
  // select/status option membership
  assertEquals(validatePropertyValue("select", "o1", opts), null);
  assert(validatePropertyValue("select", "nope", opts) !== null);
  assertEquals(validatePropertyValue("status", "o2", opts), null);
  // multiselect
  assertEquals(validatePropertyValue("multiselect", ["o1", "o2"], opts), null);
  assert(validatePropertyValue("multiselect", ["o1", "nope"], opts) !== null);
  assert(validatePropertyValue("multiselect", "o1", opts) !== null); // not an array
});

Deno.test("normalizeTemplateEtapas: defaults, integer guard, skip non-objects, no extra fields", () => {
  assertEquals(normalizeTemplateEtapas([
    { nome: "Roteiro", prazo_dias: 2, tipo_prazo: "uteis", tipo: "aprovacao_cliente" },
    { nome: "Sem campos" },
  ]), [
    { nome: "Roteiro", prazo_dias: 2, tipo_prazo: "uteis", tipo: "aprovacao_cliente" },
    { nome: "Sem campos", prazo_dias: 0, tipo_prazo: "corridos", tipo: "padrao" },
  ]);
  assertEquals(normalizeTemplateEtapas(null), []);
  assertEquals(normalizeTemplateEtapas([null, "x", { prazo_dias: 1.5, nome: "ok" }]), [
    { nome: "ok", prazo_dias: 0, tipo_prazo: "corridos", tipo: "padrao" },
  ]);
});

Deno.test("buildPropertyDefinitions: select options get generated ids, defaults, display_order", () => {
  let n = 0;
  const genId = () => "opt-" + (++n);
  const out = buildPropertyDefinitions(
    [
      { name: "modo", type: "select", options: ["A", "B"], portal_visible: true },
      { name: "nota", type: "text" },
    ],
    genId,
  );
  assertEquals("defs" in out, true);
  if ("defs" in out) {
    assertEquals(out.defs[0], {
      name: "modo", type: "select",
      config: { options: [{ id: "opt-1", label: "A", color: "#94a3b8" }, { id: "opt-2", label: "B", color: "#94a3b8" }] },
      portal_visible: true, display_order: 0,
    });
    assertEquals(out.defs[1], { name: "nota", type: "text", config: {}, portal_visible: false, display_order: 1 });
  }
});

Deno.test("buildPropertyDefinitions: validation errors", () => {
  const g = () => "x";
  assertEquals("error" in buildPropertyDefinitions([{ name: "a", type: "select" }], g), true);            // option type w/o options
  assertEquals("error" in buildPropertyDefinitions([{ name: "a", type: "text", options: ["x"] }], g), true); // non-option w/ options
  assertEquals("error" in buildPropertyDefinitions([{ name: "a", type: "text" }, { name: "a", type: "text" }], g), true); // dup names
  assertEquals("error" in buildPropertyDefinitions([{ name: "a", type: "select", options: ["x", "x"] }], g), true); // dup options
});

Deno.test("isPlanLimitExceeded: keyed match only", () => {
  const err = { message: "plan_limit_exceeded:max_workflow_templates" };
  assertEquals(isPlanLimitExceeded(err, "max_workflow_templates"), true);
  assertEquals(isPlanLimitExceeded(err, "max_custom_properties_per_template"), false);
  assertEquals(isPlanLimitExceeded({ message: "other" }, "max_workflow_templates"), false);
  assertEquals(isPlanLimitExceeded(null, "max_workflow_templates"), false);
});
