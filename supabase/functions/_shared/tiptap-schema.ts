// Schema/allowlist recursivo para documentos TipTap (kb_articles.content). Compartilhado por
// mcp-admin/markdown.ts (Markdown → TipTap, agente) e _shared/admin-kb.ts (editor do Admin) --
// os dois caminhos escrevem na mesma coluna e precisam do mesmo portão de validação.
import { McpInputError } from "./mcp-token.ts";
import { isSafeHref } from "./safe-href.ts";

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
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

type AttrRule = (v: unknown) => boolean;
const isNull = (v: unknown) => v === null || v === undefined;
const isInt = (v: unknown) => Number.isInteger(v);
const isIntOrNull = (v: unknown) => isNull(v) || Number.isInteger(v);
const isStr = (v: unknown) => typeof v === "string";
const isStrOrNull = (v: unknown) => isNull(v) || typeof v === "string";
const isBool = (v: unknown) => typeof v === "boolean";
const hostAllowed = (hostname: string) =>
  IFRAME_ALLOWED_HOSTS.some((d) => hostname === d || hostname.endsWith(`.${d}`));

// Exportada: mcp-admin/markdown.ts também usa isSafeHttpsUrl fora do allowlist (imageNode(),
// ao converter `![alt](url)` do Markdown solto em nó inlineImage).
export function isSafeHttpsUrl(v: unknown, hostCheck?: (h: string) => boolean): boolean {
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
    href: (v) => isStr(v) && isSafeHref(v as string),
    // "title" é atributo padrão de @tiptap/extension-link (default: null); o editor do Admin
    // sempre emite os 5 (href/target/rel/class/title) no JSON do mark mesmo sem o autor tocar
    // neles -- faltar aqui rejeitaria TODO link criado pela toolbar do Admin.
    target: isStrOrNull, rel: isStrOrNull, class: isStrOrNull, title: isStrOrNull,
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
        const mk = m as TiptapMark;
        const mr = m && typeof m === "object" && !Array.isArray(m) ? MARK_ATTRS[mk.type] : undefined;
        if (!mr) throw new McpInputError(`${path}: mark "${String(mk?.type)}" não permitida`);
        for (const k of Object.keys(mk)) {
          if (k !== "type" && k !== "attrs") throw new McpInputError(`${path}: chave "${k}" não permitida na mark ${mk.type}`);
        }
        // Marks com atributo obrigatório (link.href) não podem vir sem attrs.
        if (mk.attrs === undefined && Object.values(mr).some((rule) => !rule(null))) {
          throw new McpInputError(`${path}: mark ${mk.type} exige attrs`);
        }
        checkAttrs("mark", mk.type, mk.attrs, mr);
      }
    }
  } else {
    if (n.text !== undefined || n.marks !== undefined) throw new McpInputError(`${path}: text/marks só em nós text`);
  }
  if (n.type === "heading" || n.type === "inlineImage" || n.type === "youtube" || n.type === "iframe" || n.type === "callout") {
    if (n.attrs === undefined) throw new McpInputError(`${path}: ${n.type} exige attrs`);
  }
  checkAttrs("nó", n.type, n.attrs, rules);
  if (n.type === "inlineImage" && n.attrs?.r2Key == null && n.attrs?.src == null) {
    throw new McpInputError(`${path}: inlineImage precisa de r2Key ou src`);
  }
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
