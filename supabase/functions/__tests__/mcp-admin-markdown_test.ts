import { assert, assertEquals } from "./assert.ts";
import {
  decodeOpaque, encodeOpaque, IFRAME_ALLOWED_HOSTS, markdownToTiptap, validateTiptapDoc,
} from "../mcp-admin/markdown.ts";
import { McpInputError } from "../_shared/mcp-token.ts";

const t = (text: string, marks?: Array<{ type: string; attrs?: Record<string, unknown> }>) =>
  marks ? { type: "text", text, marks } : { type: "text", text };
const p = (...content: unknown[]) => ({ type: "paragraph", content });

function throwsInput(fn: () => unknown, needle: string) {
  let caught: unknown;
  try { fn(); } catch (e) { caught = e; }
  assert(caught instanceof McpInputError, `esperava McpInputError, veio ${String(caught)}`);
  assert((caught as Error).message.includes(needle), `mensagem "${(caught as Error).message}" sem "${needle}"`);
}

Deno.test("markdownToTiptap: headings (h1→2, h4→3), parágrafos e marks", () => {
  const doc = markdownToTiptap("# Título\n\n#### Sub\n\nTexto **negrito**, *itálico*, ~~risco~~ e `código`.");
  assertEquals(doc.content, [
    { type: "heading", attrs: { level: 2 }, content: [t("Título")] },
    { type: "heading", attrs: { level: 3 }, content: [t("Sub")] },
    p(t("Texto "), t("negrito", [{ type: "bold" }]), t(", "), t("itálico", [{ type: "italic" }]),
      t(", "), t("risco", [{ type: "strike" }]), t(" e "), t("código", [{ type: "code" }]), t(".")),
  ]);
});

Deno.test("markdownToTiptap: link, hard break, escape e html inline viram texto", () => {
  const doc = markdownToTiptap("Veja [ajuda](https://mesaas.com.br/ajuda) e [x](/ajuda)\\\nlinha 2 \\*lit\\* <b>");
  assertEquals(doc.content, [
    p(t("Veja "), t("ajuda", [{ type: "link", attrs: { href: "https://mesaas.com.br/ajuda" } }]),
      t(" e "), t("x", [{ type: "link", attrs: { href: "/ajuda" } }]),
      { type: "hardBreak" }, t("linha 2 *lit* <b>")),
  ]);
  throwsInput(() => markdownToTiptap("[x](http://inseguro)"), "link");
  throwsInput(() => markdownToTiptap("[x](javascript:alert(1))"), "link");
});

Deno.test("markdownToTiptap: listas (aninhada, ordenada com start), citação, código, hr", () => {
  const doc = markdownToTiptap("- um\n- **dois**\n  - sub\n\n3. três\n4. quatro\n\n> cit\n\n```ts\nconst a = 1;\n```\n\n---");
  assertEquals(doc.content, [
    { type: "bulletList", content: [
      { type: "listItem", content: [p(t("um"))] },
      { type: "listItem", content: [p(t("dois", [{ type: "bold" }])),
        { type: "bulletList", content: [{ type: "listItem", content: [p(t("sub"))] }] }] },
    ] },
    { type: "orderedList", attrs: { start: 3 }, content: [
      { type: "listItem", content: [p(t("três"))] },
      { type: "listItem", content: [p(t("quatro"))] },
    ] },
    { type: "blockquote", content: [p(t("cit"))] },
    { type: "codeBlock", attrs: { language: "ts" }, content: [t("const a = 1;")] },
    { type: "horizontalRule" },
  ]);
});

Deno.test("markdownToTiptap: imagem em linha própria vira inlineImage; no meio do texto divide o parágrafo", () => {
  const doc = markdownToTiptap("![Legenda](https://x.y/z.png)\n\nantes ![a](https://x.y/w.png) depois");
  const img = (src: string, alt: string) => ({ type: "inlineImage", attrs: {
    r2Key: null, src, alt, width: null, height: null, blurSrc: null, displayWidth: null, loading: false,
  } });
  assertEquals(doc.content, [
    img("https://x.y/z.png", "Legenda"),
    p(t("antes ")), img("https://x.y/w.png", "a"), p(t(" depois")),
  ]);
  throwsInput(() => markdownToTiptap("![a](http://x.y/w.png)"), "https");
});

Deno.test("markdownToTiptap: URL solta do YouTube vira youtube com defaults", () => {
  const doc = markdownToTiptap("https://www.youtube.com/watch?v=abc123");
  assertEquals(doc.content, [{ type: "youtube", attrs: { src: "https://www.youtube.com/watch?v=abc123", width: 640, height: 480, start: 0 } }]);
  const plain = markdownToTiptap("https://mesaas.com.br");
  assertEquals(plain.content[0].type, "paragraph");
});

Deno.test("markdownToTiptap: callout com emoji/cor e conteúdo aninhado; defaults", () => {
  const doc = markdownToTiptap(":::callout emoji=🚀 color=blue\nOlá **mundo**\n\n- item\n:::\n\n:::callout\nsó texto\n:::");
  assertEquals(doc.content, [
    { type: "callout", attrs: { emoji: "🚀", color: "blue" }, content: [
      p(t("Olá "), t("mundo", [{ type: "bold" }])),
      { type: "bulletList", content: [{ type: "listItem", content: [p(t("item"))] }] },
    ] },
    { type: "callout", attrs: { emoji: "💡", color: "brown" }, content: [p(t("só texto"))] },
  ]);
  throwsInput(() => markdownToTiptap(":::callout color=neon\nx\n:::"), "color");
  throwsInput(() => markdownToTiptap(":::callout\nsem fechar"), "callout");
});

Deno.test("markdownToTiptap: bloco opaco é decodificado e validado", () => {
  const iframe = { type: "iframe", attrs: { src: "https://www.loom.com/embed/abc", width: "100%", height: "400px" } };
  const doc = markdownToTiptap(`antes\n\n${encodeOpaque(iframe)}\n\ndepois`);
  assertEquals(doc.content, [p(t("antes")), iframe, p(t("depois"))]);
  const evil = { type: "iframe", attrs: { src: "https://evil.example/x", width: "100%", height: "400px" } };
  throwsInput(() => markdownToTiptap(encodeOpaque(evil)), "iframe");
  throwsInput(() => markdownToTiptap("<!--tiptap:@@@-->"), "opaco");
  throwsInput(() => markdownToTiptap(encodeOpaque({ type: "script" } as never)), "script");
});

Deno.test("markdownToTiptap: tabela e outros blocos sem equivalente são rejeitados; vazio vira doc vazio", () => {
  throwsInput(() => markdownToTiptap("| a | b |\n|---|---|\n| 1 | 2 |"), "table");
  assertEquals(markdownToTiptap("   \n"), { type: "doc", content: [] });
});

Deno.test("validateTiptapDoc: aceita todos os tipos e marks da allowlist", () => {
  const doc = { type: "doc", content: [
    { type: "heading", attrs: { level: 3 }, content: [t("h", [{ type: "underline" }, { type: "textStyle", attrs: { color: "#337EA9" } }, { type: "highlight", attrs: { color: "yellow" } }])] },
    { type: "inlineImage", attrs: { r2Key: "contas/11111111-1111-1111-1111-111111111111/files/a.png", src: "https://r2/x", alt: null, width: 10, height: 20, blurSrc: "data:image/webp;base64,AA==", displayWidth: null, loading: false } },
    { type: "youtube", attrs: { src: "https://youtu.be/abc", width: 320, height: 240, start: 5 } },
    { type: "iframe", attrs: { src: "https://app.arcade.software/share/x", width: "100%", height: "400px" } },
    { type: "callout", attrs: { emoji: "💡", color: "green" }, content: [p(t("x"))] },
    { type: "codeBlock", attrs: { language: null }, content: [t("a")] },
    { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [p(t("i"))] }] },
    { type: "horizontalRule" }, { type: "paragraph" },
  ] };
  assertEquals(validateTiptapDoc(doc), doc);
});

Deno.test("validateTiptapDoc: rejeita tipo, atributo, mark e domínio fora da allowlist", () => {
  const wrap = (n: unknown) => ({ type: "doc", content: [n] });
  throwsInput(() => validateTiptapDoc(wrap({ type: "table" })), "table");
  throwsInput(() => validateTiptapDoc(wrap({ type: "heading", attrs: { level: 1 }, content: [t("x")] })), "heading");
  throwsInput(() => validateTiptapDoc(wrap(p(t("x", [{ type: "fontFamily" }])))), "fontFamily");
  throwsInput(() => validateTiptapDoc(wrap(p(t("x", [{ type: "link", attrs: { href: "javascript:x" } }])))), "link");
  throwsInput(() => validateTiptapDoc(wrap(p(t("x", [{ type: "link" }])))), "link"); // sem attrs → sem href
  throwsInput(() => validateTiptapDoc(wrap(p(t("x", [{ type: "bold", onclick: "x" }])))), "onclick");
  throwsInput(() => validateTiptapDoc(wrap({ type: "inlineImage", attrs: { r2Key: "../etc", src: null, alt: null, width: null, height: null, blurSrc: null, displayWidth: null, loading: false } })), "inlineImage");
  throwsInput(() => validateTiptapDoc(wrap({ type: "inlineImage", attrs: { r2Key: null, src: "https://x/y", alt: null, width: null, height: null, blurSrc: null, displayWidth: null, loading: false, onload: "x" } })), "inlineImage");
  throwsInput(() => validateTiptapDoc(wrap({ type: "youtube", attrs: { src: "https://vimeo.com/1", width: 640, height: 480, start: 0 } })), "youtube");
  throwsInput(() => validateTiptapDoc(wrap({ type: "callout", attrs: { emoji: "💡", color: "neon" }, content: [p()] })), "callout");
  throwsInput(() => validateTiptapDoc(wrap(p({ type: "text" }))), "text");
  throwsInput(() => validateTiptapDoc({ type: "paragraph" }), "doc");
});

Deno.test("encodeOpaque/decodeOpaque: round-trip com UTF-8", () => {
  const n = { type: "paragraph", content: [t("ação ✓")] };
  const enc = encodeOpaque(n);
  assert(/^<!--tiptap:[A-Za-z0-9+/=]+-->$/.test(enc));
  assertEquals(decodeOpaque(enc.slice("<!--tiptap:".length, -"-->".length)), n);
});

Deno.test("IFRAME_ALLOWED_HOSTS espelha apps/admin/src/components/editor/IframeExtension.ts", async () => {
  const src = await Deno.readTextFile(new URL("../../../apps/admin/src/components/editor/IframeExtension.ts", import.meta.url));
  const body = src.slice(src.indexOf("ALLOWED_DOMAINS"), src.indexOf("];"));
  const hosts = [...body.matchAll(/'([a-z0-9.-]+)'/g)].map((m) => m[1]);
  assertEquals([...IFRAME_ALLOWED_HOSTS].sort(), hosts.sort());
});
