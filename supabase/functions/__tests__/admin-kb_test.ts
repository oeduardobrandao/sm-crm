import { assert, assertEquals } from "./assert.ts";
import {
  isUniqueViolation, KB_CATEGORIES, normalizeKb, pickKbColumns, validateKbArticle,
} from "../_shared/admin-kb.ts";

const BASE = { title: "Como criar um post", slug: "como-criar-um-post", category: "primeiros-passos", status: "draft" };

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
  assertEquals(validateKbArticle({ ...BASE, cover_image_url: "https://x.supabase.co/storage/v1/object/public/kb-images/a/b.png" }), null);
  assertEquals(validateKbArticle({ ...BASE, cover_image_url: "contas/11111111-1111-1111-1111-111111111111/files/abc.png" }), null);
  assert(validateKbArticle({ ...BASE, cover_image_url: "http://x/y.png" }) !== null);
});

Deno.test("validateKbArticle: content deve ser doc TipTap e vir junto de content_plain", () => {
  assertEquals(validateKbArticle({ ...BASE, content: { type: "doc", content: [] }, content_plain: "" }), null);
  assertEquals(validateKbArticle({ ...BASE, content: null, content_plain: "" }), null); // artigo novo sem corpo
  assert(validateKbArticle({ ...BASE, content: "<p>x</p>", content_plain: "x" }) !== null);
  assert(validateKbArticle({ ...BASE, content: { type: "doc", content: [] } }) !== null);
  assert(validateKbArticle({ ...BASE, content_plain: "x" }) !== null);
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
