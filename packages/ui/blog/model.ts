/** Pure blog post model shared by the CRM (loader, prerender, rendering) and
 * the Admin (draft review). Imports nothing but zod, and nothing from apps/.
 *
 * Mirrored for the edge functions by `supabase/functions/_shared/blog-rules.ts`,
 * which runs on `npm:zod@3` while this file runs on zod 4. That is why
 * `validateInfograficos` builds its own messages from issue fields both
 * majors share instead of using zod's default texts: the Admin, the MCP tools
 * and the build must all report the same string for the same mistake. A
 * change here needs the same change there (blog-rules-parity.test.ts and
 * supabase/functions/__tests__/blog-rules_test.ts hold them together). */
import { z } from 'zod';

export const BLOG_CATEGORIES = [
  'comparativo',
  'guia',
  'noticia',
  'tendencia',
  'planejamento',
] as const;
export type BlogCategory = (typeof BLOG_CATEGORIES)[number];

/** Every status a `blog_posts` row can hold. */
export const BLOG_STATUSES = [
  'rascunho',
  'ajuste_solicitado',
  'publicando',
  'publicado',
  'rejeitado',
  'despublicado',
] as const;
export type BlogStatus = (typeof BLOG_STATUSES)[number];

/** The statuses anon can read and the build ships. */
export const BLOG_LIVE_STATUSES = ['publicando', 'publicado'] as const;

/** SERP ranges, inclusive. Mirror the limits enforced for static routes in
 * apps/crm/src/content/site-meta.ts. */
export const BLOG_LIMITS = {
  title: [50, 60],
  h1: [10, 120],
  description: [120, 160],
} as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The shape check alone lets `2026-02-30` and `2026-13-01` through, and
 * JavaScript then rolls them over in silence: the page would print "02 de
 * março" while the sitemap kept an impossible `lastmod`. Round-tripping the
 * parts through Date is what catches a typo the author would never see. */
export function isRealCalendarDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return (
    parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d
  );
}

export const isoDate = z
  .string()
  .regex(DATE, 'must be YYYY-MM-DD')
  .refine(isRealCalendarDate, 'must be a real calendar date');

/** `z.string().url()` alone accepts `ftp:`, `javascript:` and friends. */
const httpUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'must be an http(s) URL');

export const blogSourceSchema = z
  .object({
    title: z.string().min(1).max(200),
    publisher: z.string().min(1).max(120),
    url: httpUrl,
    published_at: isoDate.optional(),
  })
  .strict();

/** `key` is what the body references as `![alt](img:<key>)`. */
export const blogImageSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9-]{1,40}$/, 'must be 1-40 chars of a-z, 0-9 or -'),
    url: httpUrl,
    alt: z.string().min(1).max(200),
    credit: z.string().min(1).max(200),
    license: z.string().min(1).max(120),
    source_url: httpUrl,
  })
  .strict();

const titulo = z.string().min(1).max(90);
/** Index into the post's `sources`; range-checked by validateInfograficos. */
const fonte = z.number().int().min(0);

const barrasSchema = z
  .object({
    tipo: z.literal('barras'),
    titulo,
    fonte,
    itens: z
      .array(
        z
          .object({
            rotulo: z.string().min(1).max(60),
            valor: z.number().min(0),
            exibicao: z.string().max(20).optional(),
          })
          .strict(),
      )
      .min(2)
      .max(8),
  })
  .strict();

const numerosSchema = z
  .object({
    tipo: z.literal('numeros'),
    titulo,
    fonte,
    itens: z
      .array(
        z
          .object({
            valor: z.string().min(1).max(16),
            legenda: z.string().min(1).max(90),
          })
          .strict(),
      )
      .min(2)
      .max(4),
  })
  .strict();

const etapasSchema = z
  .object({
    tipo: z.literal('etapas'),
    titulo,
    itens: z
      .array(z.object({ rotulo: z.string().min(1).max(60) }).strict())
      .min(3)
      .max(6),
  })
  .strict();

const SVG_MAX_CHARS = 20000;
const SVG_MAX_NODES = 300;
const SVG_MAX_DEPTH = 10;

/** Free-form infographic: the author draws an SVG, `parseSvg` keeps only what
 * is provably inert. `fonte` is optional because a drawing need not carry
 * data; one that does must cite the source it came from. */
const svgSchema = z
  .object({
    tipo: z.literal('svg'),
    titulo,
    alt: z.string().min(1).max(300),
    fonte: fonte.optional(),
    svg: z.string().min(1).max(SVG_MAX_CHARS),
  })
  .strict();

export const infograficoSchema = z.discriminatedUnion('tipo', [
  barrasSchema,
  numerosSchema,
  etapasSchema,
  svgSchema,
]);

export interface SvgNode {
  tag: string;
  attrs: Record<string, string>;
  children: Array<SvgNode | string>;
}

const SVG_TAGS = new Set([
  'svg',
  'g',
  'defs',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
  'tspan',
  'linearGradient',
  'radialGradient',
  'stop',
]);
const SVG_TEXT_TAGS = new Set(['text', 'tspan']);

const SVG_NUM = /^-?\d+(\.\d+)?(%|px)?$/;
const SVG_NUMS = /^[-0-9.,\s%]+$/;
const SVG_PAINT =
  /^(none|currentColor|#[0-9a-fA-F]{3,8}|var\(--blog-r-[a-z0-9-]+\)|url\(#[A-Za-z][A-Za-z0-9_-]{0,39}\))$/;
const SVG_PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9\s.,eE+-]+$/;
const SVG_TRANSFORM = /^(?:(?:translate|rotate|scale)\([-0-9.,\s]+\)\s*)+$/;

/** Allowlist, attribute by attribute: anything else (style, class, href,
 * on*, font-family...) is refused, never stripped, so a draft that passes
 * draws exactly what its author wrote. */
const SVG_ATTRS: Record<string, RegExp> = {
  viewBox: SVG_NUMS,
  x: SVG_NUM,
  y: SVG_NUM,
  x1: SVG_NUM,
  y1: SVG_NUM,
  x2: SVG_NUM,
  y2: SVG_NUM,
  cx: SVG_NUM,
  cy: SVG_NUM,
  r: SVG_NUM,
  rx: SVG_NUM,
  ry: SVG_NUM,
  width: SVG_NUM,
  height: SVG_NUM,
  offset: SVG_NUM,
  d: SVG_PATH,
  points: SVG_NUMS,
  transform: SVG_TRANSFORM,
  fill: SVG_PAINT,
  stroke: SVG_PAINT,
  'stop-color': SVG_PAINT,
  'stroke-width': SVG_NUM,
  'stroke-dasharray': SVG_NUMS,
  'stroke-linecap': /^(butt|round|square)$/,
  'stroke-linejoin': /^(miter|round|bevel)$/,
  opacity: SVG_NUM,
  'fill-opacity': SVG_NUM,
  'stroke-opacity': SVG_NUM,
  'font-size': SVG_NUM,
  'font-weight': /^(normal|bold|[1-9]00)$/,
  'text-anchor': /^(start|middle|end)$/,
  'dominant-baseline': /^(auto|middle|central|hanging|alphabetic)$/,
  id: /^[A-Za-z][A-Za-z0-9_-]{0,39}$/,
};

const SVG_XMLNS = 'http://www.w3.org/2000/svg';
const SVG_OPEN = /<([A-Za-z]+)((?:\s+[A-Za-z][A-Za-z0-9:-]*\s*=\s*"[^"<>]*")*)\s*(\/?)>/y;
const SVG_CLOSE = /<\/([A-Za-z]+)\s*>/y;
const SVG_ATTR = /([A-Za-z][A-Za-z0-9:-]*)\s*=\s*"([^"<>]*)"/g;
const SVG_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** Strict, fail-closed reader for the one SVG dialect infographics may use:
 * a single root `<svg viewBox>` of allowlisted shapes and text, double-quoted
 * attributes, no comments, doctypes, CDATA, scripts, styles or links. The
 * output is a plain tree, so the renderer builds elements from it and never
 * injects markup. */
export function parseSvg(source: string): { node: SvgNode } | { error: string } {
  const text = source.trim();
  if (text.length > SVG_MAX_CHARS) return { error: `máximo de ${SVG_MAX_CHARS} caracteres` };
  if (!text.startsWith('<svg') || !text.endsWith('>')) {
    return { error: 'deve começar em <svg e terminar em >' };
  }
  const stack: SvgNode[] = [];
  let root: SvgNode | undefined;
  let nodes = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] === '<') {
      SVG_CLOSE.lastIndex = i;
      const close = SVG_CLOSE.exec(text);
      if (close) {
        const open = stack.pop();
        if (!open || open.tag !== close[1]) return { error: `tag </${close[1]}> sem abertura` };
        i = SVG_CLOSE.lastIndex;
        continue;
      }
      SVG_OPEN.lastIndex = i;
      const tag = SVG_OPEN.exec(text);
      if (!tag)
        return { error: 'marcação inválida (comentário, entidade ou atributo fora do padrão)' };
      const name = tag[1];
      if (!SVG_TAGS.has(name)) return { error: `elemento não permitido: ${name}` };
      const isRoot = stack.length === 0;
      if (isRoot !== (name === 'svg')) {
        return { error: isRoot ? 'o elemento raiz deve ser svg' : 'svg só pode ser a raiz' };
      }
      if (root && isRoot) return { error: 'só um elemento raiz' };
      nodes++;
      if (nodes > SVG_MAX_NODES) return { error: `máximo de ${SVG_MAX_NODES} elementos` };
      if (stack.length >= SVG_MAX_DEPTH) return { error: `máximo de ${SVG_MAX_DEPTH} níveis` };
      const attrs: Record<string, string> = {};
      for (const match of tag[2].matchAll(SVG_ATTR)) {
        const key = match[1];
        const value = match[2];
        if (Object.prototype.hasOwnProperty.call(attrs, key))
          return { error: `atributo repetido: ${key}` };
        if (key === 'xmlns') {
          if (!isRoot || value !== SVG_XMLNS) return { error: 'xmlns inválido' };
          continue;
        }
        const rule = Object.prototype.hasOwnProperty.call(SVG_ATTRS, key)
          ? SVG_ATTRS[key]
          : undefined;
        if (!rule) return { error: `atributo não permitido: ${key}` };
        if (!rule.test(value)) return { error: `valor inválido em ${key}` };
        attrs[key] = value;
      }
      if (isRoot) {
        if (!attrs.viewBox) return { error: 'o svg precisa de viewBox' };
        if (Object.keys(attrs).length > 1) return { error: 'o svg raiz só aceita viewBox' };
      }
      const node: SvgNode = { tag: name, attrs, children: [] };
      if (stack.length > 0) stack[stack.length - 1].children.push(node);
      else root = node;
      i = SVG_OPEN.lastIndex;
      if (!tag[3]) stack.push(node);
      else if (isRoot) i = text.length;
      continue;
    }
    const next = text.indexOf('<', i);
    const chunk = text.slice(i, next === -1 ? text.length : next);
    i = next === -1 ? text.length : next;
    const parent = stack[stack.length - 1];
    if (!parent) return { error: 'conteúdo fora do svg' };
    if (!chunk.trim()) continue;
    if (!SVG_TEXT_TAGS.has(parent.tag)) return { error: 'texto só dentro de text ou tspan' };
    if (/&(?!(amp|lt|gt|quot|#39);)/.test(chunk))
      return { error: 'entidade não permitida no texto' };
    parent.children.push(chunk.replace(/&(amp|lt|gt|quot|#39);/g, (m) => SVG_ENTITIES[m]));
  }
  if (stack.length > 0 || !root) return { error: 'tags não fechadas' };
  return { node: root };
}

export type BlogSource = z.infer<typeof blogSourceSchema>;
export type BlogImage = z.infer<typeof blogImageSchema>;
export type Infografico = z.infer<typeof infograficoSchema>;

/** Per-kind schemas, so validation never reports zod's union-level issue
 * (whose shape differs between zod 3 and 4). */
const INFOGRAFICO_KINDS: Record<string, z.ZodTypeAny> = {
  barras: barrasSchema,
  numeros: numerosSchema,
  etapas: etapasSchema,
  svg: svgSchema,
};

/** Fenced code blocks as CommonMark (and so react-markdown) reads them: up
 * to 3 spaces of indent, 3+ backticks or tildes, then an info string. A
 * backtick fence's info string may not contain a backtick. The block closes
 * on a line of the same char, at least as long, indented 0-3, with nothing
 * else; without one it runs to the end of the body, and the renderer still
 * draws it as a code block. Every fence is tracked, not just infographics,
 * so an ```infografico example quoted inside another code block is content. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const INFOGRAFICO_INFO = /^[ \t]*infografico\b/;

export interface ExtractedInfografico {
  /** Zero-based position among the post's infographics. */
  index: number;
  /** Parsed JSON; undefined when `error` is set. */
  value: unknown;
  /** Set when the fence content is empty or not valid JSON. */
  error?: string;
}

export function extractInfograficos(body: string): ExtractedInfografico[] {
  const found: ExtractedInfografico[] = [];
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const open = FENCE_OPEN.exec(lines[i]);
    i++;
    if (!open) continue;
    const marker = open[1];
    const info = open[2];
    if (marker[0] === '`' && info.includes('`')) continue;
    const content: string[] = [];
    while (i < lines.length) {
      const close = FENCE_CLOSE.exec(lines[i]);
      if (close && close[1][0] === marker[0] && close[1].length >= marker.length) break;
      content.push(lines[i]);
      i++;
    }
    i++;
    if (!INFOGRAFICO_INFO.test(info)) continue;
    const index = found.length;
    const text = content.join('\n');
    if (!text.trim()) {
      found.push({ index, value: undefined, error: 'JSON inválido' });
      continue;
    }
    try {
      found.push({ index, value: JSON.parse(text) });
    } catch {
      found.push({ index, value: undefined, error: 'JSON inválido' });
    }
  }
  return found;
}

type Issue = {
  code: string;
  path: PropertyKey[];
  expected?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  keys?: string[];
  /** zod 4 */
  origin?: string;
  /** zod 3 */
  type?: string;
};

const TYPE_NAMES: Record<string, string> = {
  number: 'número',
  int: 'número inteiro',
  integer: 'número inteiro',
  string: 'texto',
  array: 'lista',
  object: 'objeto',
};

function issuePath(path: PropertyKey[]): string {
  return path.map((part) => (typeof part === 'number' ? `[${part}]` : `.${String(part)}`)).join('');
}

function issueMessage(issue: Issue): string {
  const kind = issue.origin ?? issue.type;
  switch (issue.code) {
    case 'invalid_type':
      return `deve ser ${TYPE_NAMES[String(issue.expected)] ?? String(issue.expected)}`;
    case 'too_small': {
      const min = Number(issue.minimum);
      if (kind === 'string') return `mínimo de ${min} caracteres`;
      if (kind === 'array') return `mínimo de ${min} itens`;
      return `deve ser maior ou igual a ${min}`;
    }
    case 'too_big': {
      const max = Number(issue.maximum);
      if (kind === 'string') return `máximo de ${max} caracteres`;
      if (kind === 'array') return `máximo de ${max} itens`;
      return `deve ser menor ou igual a ${max}`;
    }
    case 'unrecognized_keys':
      return `chave desconhecida: ${(issue.keys ?? []).join(', ')}`;
    default:
      return 'valor inválido';
  }
}

/** Every problem with the body's infographics, one pt-BR message each, e.g.
 * `infografico[1].fonte: índice 3 fora de sources (0..1)`. Empty means ok.
 * Indexes are zero-based, both the infographic's and the source's. */
export function validateInfograficos(body: string, sourcesCount: number): string[] {
  const messages: string[] = [];
  for (const { index, value, error } of extractInfograficos(body)) {
    const prefix = `infografico[${index}]`;
    if (error) {
      messages.push(`${prefix}: ${error}`);
      continue;
    }
    const tipo =
      value && typeof value === 'object' ? (value as Record<string, unknown>).tipo : undefined;
    const schema = typeof tipo === 'string' ? INFOGRAFICO_KINDS[tipo] : undefined;
    if (!schema) {
      messages.push(`${prefix}.tipo: deve ser barras, numeros, etapas ou svg`);
      continue;
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues as unknown as Issue[]) {
        messages.push(`${prefix}${issuePath(issue.path)}: ${issueMessage(issue)}`);
      }
      continue;
    }
    const data = parsed.data as Infografico;
    const cited = 'fonte' in data ? data.fonte : undefined;
    if (cited !== undefined && cited >= sourcesCount) {
      const range = sourcesCount > 0 ? `0..${sourcesCount - 1}` : 'nenhuma fonte';
      messages.push(`${prefix}.fonte: índice ${cited} fora de sources (${range})`);
    }
    if (data.tipo === 'svg') {
      const drawn = parseSvg(data.svg);
      if ('error' in drawn) messages.push(`${prefix}.svg: ${drawn.error}`);
    }
  }
  return messages;
}
