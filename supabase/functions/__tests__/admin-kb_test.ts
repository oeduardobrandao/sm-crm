import { assert, assertEquals } from "./assert.ts";
import {
  coverNeedsOwnership, isUniqueViolation, KB_CATEGORIES, normalizeKb, pickKbColumns, validateKbArticle,
} from "../_shared/admin-kb.ts";

const BASE = { title: "Como criar um post", slug: "como-criar-um-post", category: "primeiros-passos", status: "draft" };
const CONTA = "11111111-1111-1111-1111-111111111111";
const OWN_KEY = `contas/${CONTA}/files/abc.png`;
const OTHER_KEY = "contas/22222222-2222-2222-2222-222222222222/files/x.png";

Deno.test("validateKbArticle: linha mínima válida", () => {
  assertEquals(validateKbArticle(BASE), null);
});

Deno.test("validateKbArticle: title 1..200, slug no formato e fora dos reservados", () => {
  assert(validateKbArticle({ ...BASE, title: "" }) !== null);
  assert(validateKbArticle({ ...BASE, title: "x".repeat(201) }) !== null);
  assert(validateKbArticle({ ...BASE, slug: "Com Espaço" }) !== null);
  assert(validateKbArticle({ ...BASE, slug: "-a" }) !== null);
  assert(validateKbArticle({ ...BASE, slug: "novo" }) !== null);
  assert(validateKbArticle({ ...BASE, slug: "editar" }) !== null);
});

Deno.test("validateKbArticle: category na lista; status draft|published", () => {
  assert(validateKbArticle({ ...BASE, category: "outra" }) !== null);
  for (const c of KB_CATEGORIES) assertEquals(validateKbArticle({ ...BASE, category: c }), null);
  assert(validateKbArticle({ ...BASE, status: "archived" }) !== null);
});

Deno.test("validateKbArticle: tags, display_order, excerpt, cover_image_url", () => {
  assertEquals(validateKbArticle({ ...BASE, tags: ["a", "b"] }), null);
  assert(validateKbArticle({ ...BASE, tags: "a,b" }) !== null);
  assert(validateKbArticle({ ...BASE, tags: ["x".repeat(41)] }) !== null);
  assert(validateKbArticle({ ...BASE, display_order: -1 }) !== null);
  assert(validateKbArticle({ ...BASE, display_order: 1.5 }) !== null);
  assert(validateKbArticle({ ...BASE, excerpt: "x".repeat(301) }) !== null);
  assert(validateKbArticle({ ...BASE, cover_image_url: "http://x/y.png" }) !== null);
});

Deno.test("validateKbArticle: cover_image_url em chave R2 exige posse do workspace do admin (ou capa já persistida)", () => {
  // https é sempre ok, sem precisar de opts.
  assertEquals(validateKbArticle({ ...BASE, cover_image_url: "https://x.supabase.co/storage/v1/object/public/kb-images/a/b.png" }), null);
  // Chave R2 sem opts (nenhum allowedContaId, nenhuma persistedCover) é rejeitada.
  assert(validateKbArticle({ ...BASE, cover_image_url: OWN_KEY })?.includes("another workspace"));
  // Chave sob o workspace do admin chamador passa.
  assertEquals(validateKbArticle({ ...BASE, cover_image_url: OWN_KEY }, { allowedContaId: CONTA }), null);
  // Chave de outro workspace, mesmo com allowedContaId setado, é rejeitada.
  assert(validateKbArticle({ ...BASE, cover_image_url: OTHER_KEY }, { allowedContaId: CONTA })?.includes("another workspace"));
  // Chave igual à capa já persistida passa mesmo sem allowedContaId (pode ter sido enviada por outro admin).
  assertEquals(validateKbArticle({ ...BASE, cover_image_url: OTHER_KEY }, { persistedCover: OTHER_KEY }), null);
});

Deno.test("coverNeedsOwnership: https é sempre false; mesma chave já persistida é false; chave R2 nova é true", () => {
  assertEquals(coverNeedsOwnership("https://x/y.png", null), false);
  assertEquals(coverNeedsOwnership(OWN_KEY, OWN_KEY), false);
  assertEquals(coverNeedsOwnership(OWN_KEY, null), true);
  assertEquals(coverNeedsOwnership(OWN_KEY, OTHER_KEY), true);
  assertEquals(coverNeedsOwnership(null, null), false);
  assertEquals(coverNeedsOwnership(undefined, null), false);
});

Deno.test("validateKbArticle: content deve ser doc TipTap e vir junto de content_plain", () => {
  assertEquals(validateKbArticle({ ...BASE, content: { type: "doc", content: [] }, content_plain: "" }), null);
  assertEquals(validateKbArticle({ ...BASE, content: null, content_plain: "" }), null); // artigo novo sem corpo
  assert(validateKbArticle({ ...BASE, content: "<p>x</p>", content_plain: "x" }) !== null);
  assert(validateKbArticle({ ...BASE, content: { type: "doc", content: [] } }) !== null);
  assert(validateKbArticle({ ...BASE, content_plain: "x" }) !== null);
});

Deno.test("validateKbArticle: content passa pela allowlist de nós (rejeita nó desconhecido; aceita tudo que o editor do Admin produz)", () => {
  assert(
    validateKbArticle({
      ...BASE,
      content: { type: "doc", content: [{ type: "script", attrs: {} }] },
      content_plain: "x",
    })?.includes("script"),
  );

  const fullDoc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Título" }] },
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Subtítulo" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "negrito", marks: [{ type: "bold" }] },
          { type: "text", text: "itálico", marks: [{ type: "italic" }] },
          { type: "text", text: "riscado", marks: [{ type: "strike" }] },
          { type: "text", text: "código", marks: [{ type: "code" }] },
          { type: "text", text: "sublinhado", marks: [{ type: "underline" }] },
          {
            type: "text",
            text: "link",
            marks: [{
              type: "link",
              attrs: { href: "https://x.y", target: "_blank", rel: "noopener noreferrer nofollow", class: null },
            }],
          },
          { type: "text", text: "colorido", marks: [{ type: "textStyle", attrs: { color: "#337EA9" } }] },
          { type: "text", text: "marcado", marks: [{ type: "highlight", attrs: { color: "yellow" } }] },
        ],
      },
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }] }],
      },
      {
        type: "orderedList",
        attrs: { start: 1, type: null },
        content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }] }],
      },
      { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "citação" }] }] },
      { type: "codeBlock", attrs: { language: null }, content: [{ type: "text", text: "code" }] },
      { type: "horizontalRule" },
      { type: "paragraph", content: [{ type: "text", text: "quebra" }, { type: "hardBreak" }, { type: "text", text: "linha" }] },
      {
        type: "inlineImage",
        attrs: {
          r2Key: "contas/11111111-1111-1111-1111-111111111111/files/a.png",
          src: "https://signed",
          alt: "x",
          width: 800,
          height: 600,
          blurSrc: "data:image/webp;base64,AA==",
          displayWidth: 400,
          loading: false,
        },
      },
      {
        type: "inlineImage",
        attrs: {
          r2Key: null,
          src: "https://x.supabase.co/storage/v1/object/public/kb-images/a/b.png",
          alt: "a",
          width: 1440,
          height: 900,
          blurSrc: null,
          displayWidth: null,
          loading: false,
        },
      },
      { type: "youtube", attrs: { src: "https://www.youtube.com/watch?v=abc123", start: 0, width: 640, height: 480 } },
      { type: "iframe", attrs: { src: "https://www.loom.com/embed/x", width: "100%", height: "400px" } },
      {
        type: "callout",
        attrs: { emoji: "💡", color: "brown" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "dica" }] }],
      },
    ],
  };
  assertEquals(validateKbArticle({ ...BASE, content: fullDoc, content_plain: "x" }), null);
});

Deno.test("pickKbColumns + normalizeKb: allowlist, trim, '' → null", () => {
  const p = pickKbColumns({ title: " T ", slug: "t", category: "clientes", excerpt: "", cover_image_url: " ", author_id: "x" });
  assertEquals(Object.keys(p).sort(), ["category", "cover_image_url", "excerpt", "slug", "title"]);
  assertEquals(normalizeKb(p), { title: "T", slug: "t", category: "clientes", excerpt: null, cover_image_url: null });
});

Deno.test("isUniqueViolation: código 23505", () => {
  assert(isUniqueViolation({ code: "23505", message: "duplicate key" }));
  assertEquals(isUniqueViolation({ code: "23503" }), false);
  assertEquals(isUniqueViolation(null), false);
});

Deno.test("KB_CATEGORIES espelha apps/admin/src/lib/kb-categories.ts", async () => {
  const src = await Deno.readTextFile(new URL("../../../apps/admin/src/lib/kb-categories.ts", import.meta.url));
  const body = src.slice(src.indexOf("KB_CATEGORIES"), src.indexOf("};"));
  const keys = [...body.matchAll(/^\s*'?([a-z0-9-]+)'?\s*:/gm)].map((m) => m[1]);
  assertEquals([...KB_CATEGORIES].sort(), [...keys].sort());
});

// handleUpdateKbArticle roda a regra "content e content_plain juntos" sobre a linha MESCLADA
// (atual do select("*") + patch), e na linha mesclada os dois sempre existem -- a regra nunca
// dispara ali. Sem checar o par no PATCH em si, um PATCH só com `content` deixa content_plain
// desatualizado (FTS dessincronizado). platform-admin/index.ts não exporta handlers HTTP
// individuais para invocação direta neste suite (roteador cru), então este teste é um
// contrato de fonte: confirma que a checagem do par existe ANTES da leitura do select("*").
Deno.test("handleUpdateKbArticle: par content/content_plain checado no patch antes da mescla", async () => {
  const src = await Deno.readTextFile(new URL("../platform-admin/index.ts", import.meta.url));
  const start = src.indexOf("async function handleUpdateKbArticle");
  assert(start >= 0, "handleUpdateKbArticle not found");
  const rest = src.slice(start + "async function handleUpdateKbArticle".length);
  const nextFnOffset = rest.indexOf("async function");
  const fn = rest.slice(0, nextFnOffset >= 0 ? nextFnOffset : undefined);

  const pairCheckIdx = fn.search(/\(update\.content !== undefined\) !== \(update\.content_plain !== undefined\)/);
  assert(pairCheckIdx >= 0, "expected the content/content_plain pairing check inside handleUpdateKbArticle");

  const selectIdx = fn.indexOf('.from("kb_articles").select("*")');
  assert(selectIdx >= 0, "expected the current-row select inside handleUpdateKbArticle");

  assert(pairCheckIdx < selectIdx, "the pairing check must run before the current row is read/merged");
});

// Regressão da falha "cover_image_url em chave R2 de outro workspace publica arquivo alheio":
// handleCreateKbArticle e handleUpdateKbArticle precisam resolver a posse via
// coverNeedsOwnership()/adminContaId() antes de aceitar uma chave R2 como capa. Mesma
// limitação do teste acima (sem export de handlers HTTP individuais): contrato de fonte.
Deno.test("handleCreateKbArticle e handleUpdateKbArticle checam posse de cover_image_url (coverNeedsOwnership + adminContaId)", async () => {
  const src = await Deno.readTextFile(new URL("../platform-admin/index.ts", import.meta.url));

  function extractFn(name: string): string {
    const start = src.indexOf(`async function ${name}`);
    assert(start >= 0, `${name} not found`);
    const rest = src.slice(start + `async function ${name}`.length);
    const nextFnOffset = rest.indexOf("async function");
    return rest.slice(0, nextFnOffset >= 0 ? nextFnOffset : undefined);
  }

  const createFn = extractFn("handleCreateKbArticle");
  assert(createFn.includes("coverNeedsOwnership("), "handleCreateKbArticle must call coverNeedsOwnership(");
  assert(createFn.includes("adminContaId("), "handleCreateKbArticle must call adminContaId(");

  const updateFn = extractFn("handleUpdateKbArticle");
  assert(updateFn.includes("coverNeedsOwnership("), "handleUpdateKbArticle must call coverNeedsOwnership(");
  assert(updateFn.includes("adminContaId("), "handleUpdateKbArticle must call adminContaId(");
});
