// Deno mirror of the blog post rules in packages/ui/blog/model.ts and
// packages/ui/blog/features.ts (the edge functions can't import the CRM's
// zod 4 model). apps/crm/src/content/__tests__/blog-rules-parity.test.ts reads
// the constants below AS TEXT and compares them with the CRM's, so keep each
// literal JSON-like (double quotes, no spreads, no computed values).
// validateInfograficos must return the exact strings the CRM's does;
// supabase/functions/__tests__/blog-rules_test.ts pins the same cases as the
// vitest suite. Messages are built from issue fields shared by zod 3 and 4,
// never from zod's default texts, because the two majors word them apart.
import { z } from "npm:zod@3";

export const BLOG_CATEGORIES = [
  "comparativo",
  "guia",
  "noticia",
  "tendencia",
  "planejamento",
] as const;
export type BlogCategory = (typeof BLOG_CATEGORIES)[number];

export const BLOG_STATUSES = [
  "rascunho",
  "ajuste_solicitado",
  "publicando",
  "publicado",
  "rejeitado",
  "despublicado",
] as const;
export type BlogStatus = (typeof BLOG_STATUSES)[number];

export const BLOG_LIMITS = {
  title: [50, 60],
  h1: [10, 120],
  description: [120, 160],
} as const;

export const BLOG_FEATURE_SLUGS = [
  "aprovacao-de-post",
  "portal-do-cliente",
  "agente-de-conteudo-ia",
] as const;
export type FeatureSlug = (typeof BLOG_FEATURE_SLUGS)[number];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealCalendarDate(value: string): boolean {
  const [y, m, d] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 &&
    parsed.getUTCDate() === d;
}

export const isoDate = z
  .string()
  .regex(DATE, "must be YYYY-MM-DD")
  .refine(isRealCalendarDate, "must be a real calendar date");

const httpUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "must be an http(s) URL");

export const blogSourceSchema = z
  .object({
    title: z.string().min(1).max(200),
    publisher: z.string().min(1).max(120),
    url: httpUrl,
    published_at: isoDate.optional(),
  })
  .strict();

export const blogImageSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9-]{1,40}$/, "must be 1-40 chars of a-z, 0-9 or -"),
    url: z.string().min(1),
    alt: z.string().min(1).max(200),
    credit: z.string().min(1).max(200),
    license: z.string().min(1).max(120),
    source_url: httpUrl,
  })
  .strict();

const titulo = z.string().min(1).max(90);
const fonte = z.number().int().min(0);

const barrasSchema = z
  .object({
    tipo: z.literal("barras"),
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
    tipo: z.literal("numeros"),
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
    tipo: z.literal("etapas"),
    titulo,
    itens: z.array(z.object({ rotulo: z.string().min(1).max(60) }).strict()).min(3).max(6),
  })
  .strict();

export const infograficoSchema = z.discriminatedUnion("tipo", [
  barrasSchema,
  numerosSchema,
  etapasSchema,
]);

export type BlogSource = z.infer<typeof blogSourceSchema>;
export type BlogImage = z.infer<typeof blogImageSchema>;
export type Infografico = z.infer<typeof infograficoSchema>;

const INFOGRAFICO_KINDS: Record<string, z.ZodTypeAny> = {
  barras: barrasSchema,
  numeros: numerosSchema,
  etapas: etapasSchema,
};

const INFOGRAFICO_FENCE = /^```infografico[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm;

export interface ExtractedInfografico {
  index: number;
  value: unknown;
  error?: string;
}

export function extractInfograficos(body: string): ExtractedInfografico[] {
  const found: ExtractedInfografico[] = [];
  for (const match of body.matchAll(INFOGRAFICO_FENCE)) {
    const index = found.length;
    try {
      found.push({ index, value: JSON.parse(match[1]) });
    } catch {
      found.push({ index, value: undefined, error: "JSON inválido" });
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
  origin?: string;
  type?: string;
};

const TYPE_NAMES: Record<string, string> = {
  number: "número",
  int: "número inteiro",
  integer: "número inteiro",
  string: "texto",
  array: "lista",
  object: "objeto",
};

function issuePath(path: PropertyKey[]): string {
  return path.map((part) => (typeof part === "number" ? `[${part}]` : `.${String(part)}`)).join(
    "",
  );
}

function issueMessage(issue: Issue): string {
  const kind = issue.origin ?? issue.type;
  switch (issue.code) {
    case "invalid_type":
      return `deve ser ${TYPE_NAMES[String(issue.expected)] ?? String(issue.expected)}`;
    case "too_small": {
      const min = Number(issue.minimum);
      if (kind === "string") return `mínimo de ${min} caracteres`;
      if (kind === "array") return `mínimo de ${min} itens`;
      return `deve ser maior ou igual a ${min}`;
    }
    case "too_big": {
      const max = Number(issue.maximum);
      if (kind === "string") return `máximo de ${max} caracteres`;
      if (kind === "array") return `máximo de ${max} itens`;
      return `deve ser menor ou igual a ${max}`;
    }
    case "unrecognized_keys":
      return `chave desconhecida: ${(issue.keys ?? []).join(", ")}`;
    default:
      return "valor inválido";
  }
}

export function validateInfograficos(body: string, sourcesCount: number): string[] {
  const messages: string[] = [];
  for (const { index, value, error } of extractInfograficos(body)) {
    const prefix = `infografico[${index}]`;
    if (error) {
      messages.push(`${prefix}: ${error}`);
      continue;
    }
    const tipo = value && typeof value === "object"
      ? (value as Record<string, unknown>).tipo
      : undefined;
    const schema = typeof tipo === "string" ? INFOGRAFICO_KINDS[tipo] : undefined;
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
    if (data.tipo !== "etapas" && data.fonte >= sourcesCount) {
      const range = sourcesCount > 0 ? `0..${sourcesCount - 1}` : "nenhuma fonte";
      messages.push(`${prefix}.fonte: índice ${data.fonte} fora de sources (${range})`);
    }
  }
  return messages;
}
