// Markdown ⇄ TipTap para kb_articles.content (spec 2026-09-04-mcp-admin §6). Puro.
// Parser: marked (só o lexer); a árvore de tokens é mapeada para nós TipTap e o doc inteiro
// passa por validateTiptapDoc antes de sair daqui, incluindo nós decodificados de blocos
// opacos <!--tiptap:BASE64--> (texto livre do agente = vetor de injeção de nó).
import { marked, type Token, type Tokens } from "npm:marked@15.0.12";
import { McpInputError } from "../_shared/mcp-token.ts";
import { isSafeHref } from "../_shared/safe-href.ts";
import {
  CALLOUT_COLORS, IFRAME_ALLOWED_HOSTS, isSafeHttpsUrl, R2_KEY_RE, type TiptapMark,
  type TiptapNode, validateTiptapDoc, YOUTUBE_DEFAULTS, YOUTUBE_RE,
} from "../_shared/tiptap-schema.ts";

// Re-exportados para manter compatível quem já importava daqui (mcp-admin-markdown_test.ts
// inclusive): o schema/allowlist recursivo agora vive em _shared/tiptap-schema.ts, comum ao
// caminho do agente (aqui) e ao do editor do Admin (_shared/admin-kb.ts).
export type { TiptapMark, TiptapNode };
export { CALLOUT_COLORS, IFRAME_ALLOWED_HOSTS, R2_KEY_RE, validateTiptapDoc, YOUTUBE_DEFAULTS, YOUTUBE_RE };

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
// Markdown → TipTap
// ---------------------------------------------------------------------------

type Segment =
  | { kind: "md"; text: string }
  | { kind: "opaque"; b64: string }
  | { kind: "callout"; emoji: string; color: string; text: string };

/** Separa diretivas (:::callout … ::: e <!--tiptap:…-->) do Markdown comum, linha a linha. */
/** Estado de uma cerca de código CommonMark (```/~~~) aberta ao varrer linhas. */
type FenceState = { ch: string; len: number } | null;

const FENCE_OPEN_RE = /^\s{0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE_RE = /^(`{3,}|~{3,})$/;

/** Casa a abertura de uma cerca de código na linha (indentação de até 3 espaços, CommonMark). */
function matchFenceOpen(line: string): FenceState {
  const m = line.match(FENCE_OPEN_RE);
  if (!m) return null;
  return { ch: m[1][0], len: m[1].length };
}

/** true se `line` fecha a cerca `fence` (mesmo caractere, corrida >= comprimento de abertura). */
function matchFenceClose(line: string, fence: FenceState): boolean {
  if (!fence) return false;
  const m = line.trim().match(FENCE_CLOSE_RE);
  return !!m && m[1][0] === fence.ch && m[1].length >= fence.len;
}

function splitSegments(md: string): Segment[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Segment[] = [];
  let buf: string[] = [];
  let fence: FenceState = null;
  const flush = () => {
    if (buf.length) out.push({ kind: "md", text: buf.join("\n") });
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      buf.push(line);
      if (matchFenceClose(line, fence)) fence = null;
      continue;
    }
    const open = matchFenceOpen(line);
    if (open) {
      fence = open;
      buf.push(line);
      continue;
    }
    const op = line.trim().match(OPAQUE_RE);
    if (op) { flush(); out.push({ kind: "opaque", b64: op[1] }); continue; }
    const co = line.trim().match(CALLOUT_OPEN_RE);
    if (co) {
      flush();
      const { emoji, color } = parseCalloutArgs(co[1] ?? "");
      const body: string[] = [];
      let closed = false;
      let calloutFence: FenceState = null;
      for (i = i + 1; i < lines.length; i++) {
        const inner = lines[i];
        if (calloutFence) {
          body.push(inner);
          if (matchFenceClose(inner, calloutFence)) calloutFence = null;
          continue;
        }
        const innerOpen = matchFenceOpen(inner);
        if (innerOpen) {
          calloutFence = innerOpen;
          body.push(inner);
          continue;
        }
        if (inner.trim() === ":::") { closed = true; break; }
        body.push(inner);
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
        if (!isSafeHref(href)) throw new McpInputError(`link "${href}": use https:// ou um caminho iniciado por /`);
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

// ---------------------------------------------------------------------------
// TipTap → Markdown
// ---------------------------------------------------------------------------

const SERIALIZABLE_MARKS = new Set(["bold", "italic", "strike", "code", "link"]);

function longestBacktickRun(s: string): number {
  let max = 0;
  for (const m of s.matchAll(/`+/g)) max = Math.max(max, m[0].length);
  return max;
}

/** Codespan com delimitador mais longo que qualquer crase interna; espaço de guarda quando o
 * texto começa/termina com crase (CommonMark descarta UM espaço de cada lado). */
function codeSpan(text: string): string {
  const ticks = "`".repeat(longestBacktickRun(text) + 1);
  const pad = text.startsWith("`") || text.endsWith("`") || text.length === 0 ? " " : "";
  return `${ticks}${pad}${text}${pad}${ticks}`;
}

/** Escapa o que o lexer interpretaria como sintaxe. Início de linha: #, >, -, +, N. */
function escapeMd(s: string): string {
  return s
    .replace(/[\\*_`\[\]~<]/g, (c) => `\\${c}`)
    .replace(/^(\s*)([#>+-]|\d+\.)/gm, (_m, ws, tok) => `${ws}\\${tok}`);
}

/** Destino de link/imagem: a forma simples do CommonMark não aceita parênteses desbalanceados
 * nem espaços; nesses casos usa a forma <…> (isSafeHref já barrou controle/espaço e <, >
 * nunca passam pelo parser sem quebrar, então basta checar parênteses). */
function mdDestination(url: string): string {
  return /[()]/.test(url) ? `<${url}>` : url;
}

/** null = tem mark fora do subconjunto (o bloco inteiro vira opaco). */
function serializeInline(nodes: TiptapNode[] | undefined): string | null {
  let out = "";
  for (const n of nodes ?? []) {
    if (n.type === "hardBreak") { out += "\\\n"; continue; }
    if (n.type !== "text") return null;
    const marks = n.marks ?? [];
    if (marks.some((m) => !SERIALIZABLE_MARKS.has(m.type))) return null;
    const has = (t: string) => marks.some((m) => m.type === t);
    let s = has("code") ? codeSpan(n.text ?? "") : escapeMd(n.text ?? "");
    if (has("bold")) s = `**${s}**`;
    if (has("italic")) s = `*${s}*`;
    if (has("strike")) s = `~~${s}~~`;
    const link = marks.find((m) => m.type === "link");
    if (link) {
      // "texto![x](url)" seria lido como imagem: escapa o "!" que fecha o trecho anterior.
      if (out.endsWith("!")) out = `${out.slice(0, -1)}\\!`;
      s = `[${s}](${mdDestination(String(link.attrs?.href ?? ""))})`;
    }
    out += s;
  }
  return out;
}

function indent(s: string, prefix: string): string {
  return s.split("\n").map((l) => (l.length ? prefix + l : prefix.trimEnd())).join("\n");
}

function serializeBlocks(nodes: TiptapNode[] | undefined, counter: { opaque: number }): string {
  return (nodes ?? []).map((n) => serializeBlock(n, counter)).join("\n\n");
}

function opaque(n: TiptapNode, counter: { opaque: number }): string {
  counter.opaque++;
  return encodeOpaque(n);
}

function serializeBlock(n: TiptapNode, counter: { opaque: number }): string {
  switch (n.type) {
    case "paragraph": {
      const s = serializeInline(n.content);
      return s === null ? opaque(n, counter) : s;
    }
    case "heading": {
      const s = serializeInline(n.content);
      if (s === null) return opaque(n, counter);
      return `${"#".repeat(Number(n.attrs?.level ?? 2))} ${s}`;
    }
    case "bulletList":
    case "orderedList": {
      const ordered = n.type === "orderedList";
      const start = Number(n.attrs?.start ?? 1);
      const lines: string[] = [];
      (n.content ?? []).forEach((item, i) => {
        const marker = ordered ? `${start + i}. ` : "- ";
        const body = serializeBlocks(item.content, counter).replace(/\n\n/g, "\n");
        const [first = "", ...rest] = body.split("\n");
        lines.push(marker + first);
        for (const r of rest) lines.push(" ".repeat(marker.length) + r);
      });
      return lines.join("\n");
    }
    case "blockquote":
      return indent(serializeBlocks(n.content, counter), "> ");
    case "codeBlock": {
      const lang = typeof n.attrs?.language === "string" ? n.attrs.language : "";
      const body = (n.content ?? []).map((c) => c.text ?? "").join("");
      // Cerca sempre mais longa que qualquer sequência de crases do corpo (CommonMark permite
      // cercas de N>=3 crases), senão um ``` dentro do código fecha o bloco cedo.
      const fence = "`".repeat(Math.max(3, longestBacktickRun(body) + 1));
      return `${fence}${lang}\n${body}\n${fence}`;
    }
    case "horizontalRule":
      return "---";
    case "inlineImage": {
      const a = n.attrs ?? {};
      if (a.r2Key === null && typeof a.src === "string") return `![${String(a.alt ?? "")}](${mdDestination(a.src)})`;
      return opaque(n, counter);
    }
    case "youtube": {
      const a = n.attrs ?? {};
      const isDefault = (a.width ?? YOUTUBE_DEFAULTS.width) === YOUTUBE_DEFAULTS.width &&
        (a.height ?? YOUTUBE_DEFAULTS.height) === YOUTUBE_DEFAULTS.height &&
        (a.start ?? YOUTUBE_DEFAULTS.start) === YOUTUBE_DEFAULTS.start;
      return isDefault && typeof a.src === "string" ? a.src : opaque(n, counter);
    }
    case "callout": {
      const a = n.attrs ?? {};
      return `:::callout emoji=${String(a.emoji ?? "💡")} color=${String(a.color ?? "brown")}\n${serializeBlocks(n.content, counter)}\n:::`;
    }
    default:
      return opaque(n, counter);
  }
}

/** doc TipTap → Markdown do subconjunto; o resto vira <!--tiptap:…--> e é contado. */
export function tiptapToMarkdown(doc: unknown): { markdown: string; opaque_blocks: number } {
  if (!doc || typeof doc !== "object") return { markdown: "", opaque_blocks: 0 };
  const counter = { opaque: 0 };
  const markdown = serializeBlocks((doc as TiptapNode).content, counter);
  return { markdown, opaque_blocks: counter.opaque };
}

// ---------------------------------------------------------------------------
// TipTap → texto puro (content_plain: FTS + tempo de leitura no CRM)
// ---------------------------------------------------------------------------

function plainOf(n: TiptapNode): string {
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return " ";
  if (n.type === "inlineImage") return String(n.attrs?.alt ?? "");
  if (n.type === "listItem" || n.type === "blockquote" || n.type === "callout" ||
      n.type === "bulletList" || n.type === "orderedList") {
    return (n.content ?? []).map(plainOf).filter((s) => s.length).join("\n");
  }
  return (n.content ?? []).map(plainOf).join("");
}

export function tiptapToPlain(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";
  return ((doc as TiptapNode).content ?? []).map(plainOf).filter((s) => s.length).join("\n");
}
