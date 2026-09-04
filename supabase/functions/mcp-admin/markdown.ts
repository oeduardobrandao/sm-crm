// Markdown ⇄ TipTap para kb_articles.content (spec 2026-09-04-mcp-admin §6). Puro.
// Parser: marked (só o lexer); a árvore de tokens é mapeada para nós TipTap e o doc inteiro
// passa por validateTiptapDoc antes de sair daqui, incluindo nós decodificados de blocos
// opacos <!--tiptap:BASE64--> (texto livre do agente = vetor de injeção de nó).
import { marked, type Token, type Tokens } from "npm:marked@15.0.12";
import { McpInputError } from "../_shared/mcp-token.ts";

export type TiptapMark = { type: string; attrs?: Record<string, unknown> };
export type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: TiptapMark[];
};

/** ESPELHO de apps/admin/src/components/editor/IframeExtension.ts (ALLOWED_DOMAINS);
 * mcp-admin-markdown_test.ts falha se divergir. */
export const IFRAME_ALLOWED_HOSTS = [
  "loom.com", "www.loom.com",
  "arcade.software", "www.arcade.software", "app.arcade.software",
  "scribehow.com", "www.scribehow.com",
];
/** Espelho de CalloutExtension.tsx (CALLOUT_COLORS). */
export const CALLOUT_COLORS = ["brown", "gray", "orange", "yellow", "green", "blue", "purple", "pink"];
export const YOUTUBE_RE = /^https:\/\/(www\.)?(youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)[\w-]+/;
export const YOUTUBE_DEFAULTS = { width: 640, height: 480, start: 0 };
export const R2_KEY_RE = /^contas\/[0-9a-f-]{36}\/files\/[^/]+$/;
const HREF_RE = /^(\/(?!\/)|https:\/\/)/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// Reconhece qualquer conteúdo entre os delimitadores (não só base64 válido): um
// <!--tiptap:...--> malformado deve virar McpInputError de decodeOpaque ("opaco"),
// não cair como texto solto por não casar o charset.
const OPAQUE_RE = /^<!--tiptap:(.*)-->$/;
const CALLOUT_OPEN_RE = /^:::callout(?:\s+(.*))?$/;

export function encodeOpaque(node: TiptapNode): string {
  const bytes = new TextEncoder().encode(JSON.stringify(node));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `<!--tiptap:${btoa(bin)}-->`;
}

export function decodeOpaque(b64: string): TiptapNode {
  try {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as TiptapNode;
  } catch {
    throw new McpInputError("Bloco opaco <!--tiptap:...--> inválido (base64 de JSON de um nó).");
  }
}

// ---------------------------------------------------------------------------
// Validação de schema (allowlist recursiva)
// ---------------------------------------------------------------------------

type AttrRule = (v: unknown) => boolean;
const isNull = (v: unknown) => v === null || v === undefined;
const isInt = (v: unknown) => Number.isInteger(v);
const isIntOrNull = (v: unknown) => isNull(v) || Number.isInteger(v);
const isStr = (v: unknown) => typeof v === "string";
const isStrOrNull = (v: unknown) => isNull(v) || typeof v === "string";
const isBool = (v: unknown) => typeof v === "boolean";
const hostAllowed = (hostname: string) =>
  IFRAME_ALLOWED_HOSTS.some((d) => hostname === d || hostname.endsWith(`.${d}`));

function isSafeHttpsUrl(v: unknown, hostCheck?: (h: string) => boolean): boolean {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && (!hostCheck || hostCheck(u.hostname));
  } catch {
    return false;
  }
}

/** attrs permitidos por tipo de nó: chave → regra. Chave fora da lista = erro. */
const NODE_ATTRS: Record<string, Record<string, AttrRule>> = {
  doc: {}, paragraph: {}, text: {}, bulletList: {}, listItem: {}, blockquote: {},
  horizontalRule: {}, hardBreak: {},
  heading: { level: (v) => v === 2 || v === 3 },
  orderedList: { start: (v) => isNull(v) || (isInt(v) && (v as number) >= 0), type: isStrOrNull },
  codeBlock: { language: isStrOrNull },
  inlineImage: {
    r2Key: (v) => isNull(v) || (isStr(v) && R2_KEY_RE.test(v as string)),
    src: (v) => isNull(v) || isSafeHttpsUrl(v),
    alt: isStrOrNull,
    width: isIntOrNull, height: isIntOrNull, displayWidth: isIntOrNull,
    blurSrc: (v) => isNull(v) || (isStr(v) && (v as string).startsWith("data:image/")),
    loading: (v) => isNull(v) || isBool(v),
  },
  youtube: {
    src: (v) => isStr(v) && YOUTUBE_RE.test(v as string),
    width: isIntOrNull, height: isIntOrNull, start: isIntOrNull,
  },
  iframe: {
    src: (v) => isSafeHttpsUrl(v, hostAllowed),
    width: isStrOrNull, height: isStrOrNull,
  },
  callout: {
    emoji: (v) => isStr(v) && (v as string).length > 0 && (v as string).length <= 8,
    color: (v) => isStr(v) && CALLOUT_COLORS.includes(v as string),
  },
};
/** Nós-folha que não podem ter `content`. */
const LEAF = new Set(["text", "horizontalRule", "hardBreak", "inlineImage", "youtube", "iframe"]);

const MARK_ATTRS: Record<string, Record<string, AttrRule>> = {
  bold: {}, italic: {}, strike: {}, code: {}, underline: {},
  link: {
    href: (v) => isStr(v) && HREF_RE.test(v as string) && (v as string).length <= 2048,
    target: isStrOrNull, rel: isStrOrNull, class: isStrOrNull,
  },
  textStyle: { color: (v) => isNull(v) || (isStr(v) && HEX_COLOR_RE.test(v as string)) },
  highlight: { color: (v) => isNull(v) || (isStr(v) && (v as string).length <= 20) },
};

function checkAttrs(kind: string, name: string, attrs: unknown, rules: Record<string, AttrRule>) {
  if (attrs === undefined) return;
  if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) {
    throw new McpInputError(`${kind} ${name}: attrs inválidos`);
  }
  for (const [k, v] of Object.entries(attrs as Record<string, unknown>)) {
    const rule = rules[k];
    if (!rule) throw new McpInputError(`${kind} ${name}: atributo "${k}" não permitido`);
    if (!rule(v)) throw new McpInputError(`${kind} ${name}: atributo "${k}" inválido`);
  }
  for (const k of Object.keys(rules)) {
    // Atributos obrigatórios: os que não aceitam null.
    if (!(k in (attrs as object)) && !rules[k](null)) throw new McpInputError(`${kind} ${name}: atributo "${k}" obrigatório`);
  }
}

function validateNode(node: unknown, path: string): TiptapNode {
  if (!node || typeof node !== "object" || Array.isArray(node)) throw new McpInputError(`${path}: nó inválido`);
  const n = node as TiptapNode;
  const rules = NODE_ATTRS[n.type];
  if (typeof n.type !== "string" || !rules) throw new McpInputError(`${path}: tipo de nó "${String(n.type)}" não permitido`);
  for (const k of Object.keys(n)) {
    if (!["type", "attrs", "content", "text", "marks"].includes(k)) throw new McpInputError(`${path}: chave "${k}" não permitida em ${n.type}`);
  }
  if (n.type === "text") {
    if (typeof n.text !== "string" || n.text.length === 0) throw new McpInputError(`${path}: text sem texto`);
    if (n.marks !== undefined) {
      if (!Array.isArray(n.marks)) throw new McpInputError(`${path}: marks inválidas`);
      for (const m of n.marks) {
        const mr = m && typeof m === "object" ? MARK_ATTRS[(m as TiptapMark).type] : undefined;
        if (!mr) throw new McpInputError(`${path}: mark "${String((m as TiptapMark)?.type)}" não permitida`);
        checkAttrs("mark", (m as TiptapMark).type, (m as TiptapMark).attrs, mr);
      }
    }
  } else {
    if (n.text !== undefined || n.marks !== undefined) throw new McpInputError(`${path}: text/marks só em nós text`);
  }
  if (n.type === "heading" || n.type === "inlineImage" || n.type === "youtube" || n.type === "iframe" || n.type === "callout") {
    if (n.attrs === undefined) throw new McpInputError(`${path}: ${n.type} exige attrs`);
  }
  checkAttrs("nó", n.type, n.attrs, rules);
  if (n.content !== undefined) {
    if (LEAF.has(n.type)) throw new McpInputError(`${path}: ${n.type} não aceita content`);
    if (!Array.isArray(n.content)) throw new McpInputError(`${path}: content inválido`);
    n.content.forEach((c, i) => validateNode(c, `${path}.${n.type}[${i}]`));
  }
  return n;
}

/** Lança McpInputError para qualquer nó, atributo ou mark fora da allowlist. */
export function validateTiptapDoc(doc: unknown): TiptapNode {
  if (!doc || typeof doc !== "object" || (doc as TiptapNode).type !== "doc") {
    throw new McpInputError("content: raiz deve ser um nó doc");
  }
  return validateNode(doc, "doc");
}

// ---------------------------------------------------------------------------
// Markdown → TipTap
// ---------------------------------------------------------------------------

type Segment =
  | { kind: "md"; text: string }
  | { kind: "opaque"; b64: string }
  | { kind: "callout"; emoji: string; color: string; text: string };

/** Separa diretivas (:::callout … ::: e <!--tiptap:…-->) do Markdown comum, linha a linha. */
function splitSegments(md: string): Segment[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Segment[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) out.push({ kind: "md", text: buf.join("\n") });
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const op = line.trim().match(OPAQUE_RE);
    if (op) { flush(); out.push({ kind: "opaque", b64: op[1] }); continue; }
    const co = line.trim().match(CALLOUT_OPEN_RE);
    if (co) {
      flush();
      const { emoji, color } = parseCalloutArgs(co[1] ?? "");
      const body: string[] = [];
      let closed = false;
      for (i = i + 1; i < lines.length; i++) {
        if (lines[i].trim() === ":::") { closed = true; break; }
        body.push(lines[i]);
      }
      if (!closed) throw new McpInputError(":::callout sem a linha de fechamento ':::'");
      out.push({ kind: "callout", emoji, color, text: body.join("\n") });
      continue;
    }
    buf.push(line);
  }
  flush();
  return out;
}

function parseCalloutArgs(args: string): { emoji: string; color: string } {
  let emoji = "💡";
  let color = "brown";
  for (const m of args.matchAll(/(emoji|color)=(\S+)/g)) {
    if (m[1] === "emoji") emoji = m[2];
    else color = m[2];
  }
  if (!CALLOUT_COLORS.includes(color)) throw new McpInputError(`callout: color "${color}" inválida (${CALLOUT_COLORS.join(", ")})`);
  if (emoji.length === 0 || emoji.length > 8) throw new McpInputError("callout: emoji inválido");
  return { emoji, color };
}

function text(value: string, marks: TiptapMark[]): TiptapNode {
  return marks.length ? { type: "text", text: value, marks: [...marks] } : { type: "text", text: value };
}

/** Funde nós text adjacentes com as mesmas marks (evita `**a****b**` na serialização). */
function mergeText(nodes: TiptapNode[]): TiptapNode[] {
  const out: TiptapNode[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (prev && prev.type === "text" && n.type === "text" && JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])) {
      prev.text = (prev.text ?? "") + (n.text ?? "");
    } else {
      out.push({ ...n });
    }
  }
  return out.filter((n) => n.type !== "text" || (n.text ?? "").length > 0);
}

function inlineNodes(tokens: Token[], marks: TiptapMark[]): TiptapNode[] {
  const out: TiptapNode[] = [];
  for (const tok of tokens) {
    switch (tok.type) {
      case "text":
      case "escape":
        out.push(text((tok as Tokens.Text).text, marks));
        break;
      case "html":
        out.push(text((tok as Tokens.HTML).text, marks));
        break;
      case "strong":
        out.push(...inlineNodes((tok as Tokens.Strong).tokens, [...marks, { type: "bold" }]));
        break;
      case "em":
        out.push(...inlineNodes((tok as Tokens.Em).tokens, [...marks, { type: "italic" }]));
        break;
      case "del":
        out.push(...inlineNodes((tok as Tokens.Del).tokens, [...marks, { type: "strike" }]));
        break;
      case "codespan":
        out.push(text((tok as Tokens.Codespan).text, [...marks, { type: "code" }]));
        break;
      case "link": {
        const href = (tok as Tokens.Link).href;
        if (!HREF_RE.test(href)) throw new McpInputError(`link "${href}": use https:// ou um caminho iniciado por /`);
        out.push(...inlineNodes((tok as Tokens.Link).tokens, [...marks, { type: "link", attrs: { href } }]));
        break;
      }
      case "image":
        // Imagem no meio de uma mark (ex.: dentro de **…**): fica o alt como texto.
        out.push(text((tok as Tokens.Image).text, marks));
        break;
      case "br":
        out.push({ type: "hardBreak" });
        break;
      default:
        throw new McpInputError(`Markdown: elemento inline "${tok.type}" não suportado`);
    }
  }
  return mergeText(out);
}

function imageNode(href: string, alt: string): TiptapNode {
  if (!isSafeHttpsUrl(href)) throw new McpInputError(`imagem "${href}": use uma URL https`);
  return { type: "inlineImage", attrs: {
    r2Key: null, src: href, alt: alt || null, width: null, height: null,
    blurSrc: null, displayWidth: null, loading: false,
  } };
}

/** Parágrafo: imagens viram blocos inlineImage próprios; URL solta do YouTube vira youtube. */
function paragraphBlocks(tokens: Token[]): TiptapNode[] {
  const meaningful = tokens.filter((t) => !(t.type === "text" && (t as Tokens.Text).text.trim() === ""));
  if (meaningful.length === 1 && meaningful[0].type === "link") {
    const l = meaningful[0] as Tokens.Link;
    if (l.text === l.href && YOUTUBE_RE.test(l.href)) {
      return [{ type: "youtube", attrs: { src: l.href, ...YOUTUBE_DEFAULTS } }];
    }
  }
  const out: TiptapNode[] = [];
  let run: Token[] = [];
  const flush = () => {
    const content = inlineNodes(run, []);
    if (content.length) out.push({ type: "paragraph", content });
    run = [];
  };
  for (const tok of tokens) {
    if (tok.type === "image") {
      flush();
      out.push(imageNode((tok as Tokens.Image).href, (tok as Tokens.Image).text));
    } else {
      run.push(tok);
    }
  }
  flush();
  return out;
}

function blockNodes(tokens: Token[]): TiptapNode[] {
  const out: TiptapNode[] = [];
  for (const tok of tokens) {
    switch (tok.type) {
      case "space":
        break;
      case "heading": {
        const depth = (tok as Tokens.Heading).depth;
        const level = depth <= 2 ? 2 : 3;
        out.push({ type: "heading", attrs: { level }, content: inlineNodes((tok as Tokens.Heading).tokens, []) });
        break;
      }
      case "paragraph":
        out.push(...paragraphBlocks((tok as Tokens.Paragraph).tokens));
        break;
      case "text": {
        // Texto "solto" dentro de item de lista (lista tight): equivale a um parágrafo.
        const inner = (tok as Tokens.Text).tokens ?? [tok];
        out.push(...paragraphBlocks(inner));
        break;
      }
      case "list": {
        const list = tok as Tokens.List;
        const items = list.items.map((it) => {
          const content = blockNodes(it.tokens);
          return { type: "listItem", content: content.length ? content : [{ type: "paragraph" }] };
        });
        if (list.ordered) {
          const start = typeof list.start === "number" ? list.start : 1;
          out.push({ type: "orderedList", attrs: { start }, content: items });
        } else {
          out.push({ type: "bulletList", content: items });
        }
        break;
      }
      case "blockquote":
        out.push({ type: "blockquote", content: blockNodes((tok as Tokens.Blockquote).tokens) });
        break;
      case "code": {
        const c = tok as Tokens.Code;
        const node: TiptapNode = { type: "codeBlock", attrs: { language: c.lang ? c.lang : null } };
        if (c.text.length) node.content = [{ type: "text", text: c.text }];
        out.push(node);
        break;
      }
      case "hr":
        out.push({ type: "horizontalRule" });
        break;
      case "html": {
        const raw = (tok as Tokens.HTML).text.trim();
        const op = raw.match(OPAQUE_RE);
        if (op) out.push(decodeOpaque(op[1]));
        else if (raw.length) out.push({ type: "paragraph", content: [{ type: "text", text: raw }] });
        break;
      }
      default:
        throw new McpInputError(`Markdown: bloco "${tok.type}" não suportado`);
    }
  }
  return out;
}

/** Markdown → doc TipTap validado. Lança McpInputError em sintaxe fora do subconjunto. */
export function markdownToTiptap(md: string): TiptapNode {
  const content: TiptapNode[] = [];
  for (const seg of splitSegments(md)) {
    if (seg.kind === "opaque") {
      content.push(decodeOpaque(seg.b64));
    } else if (seg.kind === "callout") {
      const inner = markdownToTiptap(seg.text).content ?? [];
      content.push({ type: "callout", attrs: { emoji: seg.emoji, color: seg.color },
        content: inner.length ? inner : [{ type: "paragraph" }] });
    } else if (seg.text.trim().length) {
      content.push(...blockNodes(marked.lexer(seg.text, { gfm: true })));
    }
  }
  return validateTiptapDoc({ type: "doc", content });
}
