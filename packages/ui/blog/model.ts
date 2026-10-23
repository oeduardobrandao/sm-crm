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
    url: z.string().min(1),
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

export const infograficoSchema = z.discriminatedUnion('tipo', [
  barrasSchema,
  numerosSchema,
  etapasSchema,
]);

export type BlogSource = z.infer<typeof blogSourceSchema>;
export type BlogImage = z.infer<typeof blogImageSchema>;
export type Infografico = z.infer<typeof infograficoSchema>;

/** Per-kind schemas, so validation never reports zod's union-level issue
 * (whose shape differs between zod 3 and 4). */
const INFOGRAFICO_KINDS: Record<string, z.ZodTypeAny> = {
  barras: barrasSchema,
  numeros: numerosSchema,
  etapas: etapasSchema,
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
      messages.push(`${prefix}.tipo: deve ser barras, numeros ou etapas`);
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
    if (data.tipo !== 'etapas' && data.fonte >= sourcesCount) {
      const range = sourcesCount > 0 ? `0..${sourcesCount - 1}` : 'nenhuma fonte';
      messages.push(`${prefix}.fonte: índice ${data.fonte} fora de sources (${range})`);
    }
  }
  return messages;
}
