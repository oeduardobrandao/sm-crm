// Validação de artigos da base de conhecimento (kb_articles). Compartilhado por platform-admin
// (editor do Admin) e mcp-admin (agente). Linha MESCLADA em update.
import { validateTiptapDoc } from "./tiptap-schema.ts";

export const KB_ARTICLE_COLUMNS = [
  "title", "slug", "excerpt", "content", "content_plain",
  "cover_image_url", "category", "tags", "status", "display_order",
] as const;

/** Colidem com as rotas do Admin /admin/kb-articles/new e /:id/edit. Espelho em
 * apps/admin/src/pages/KbArticleEditorPage.tsx (RESERVED_SLUGS). */
export const RESERVED_SLUGS = ["novo", "editar"];

/** Slugs de categoria. ESPELHO de apps/admin/src/lib/kb-categories.ts (Deno e Vite não
 * compartilham import); admin-kb_test.ts falha se as listas divergirem. */
export const KB_CATEGORIES = [
  "primeiros-passos", "claude-e-ia", "clientes", "equipe", "tarefas", "entregas-e-fluxos",
  "hub-do-cliente", "mensagens", "instagram-e-analytics", "relatorios", "post-express",
  "automacoes", "financeiro", "cobranca", "arquivos",
];

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const R2_KEY_RE = /^contas\/[0-9a-f-]{36}\/files\/[^/]+$/;
const TEXT_COLUMNS = ["excerpt", "cover_image_url"] as const;

const KB_ARTICLE_COLUMN_SET: ReadonlySet<string> = new Set(KB_ARTICLE_COLUMNS);

// Itera as chaves do body (não da allowlist) para preservar a ordem de inserção do
// caller no objeto resultante -- normalizeKb() faz merge posicional em cima disso.
export function pickKbColumns(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of Object.keys(body)) {
    if (KB_ARTICLE_COLUMN_SET.has(col) && body[col] !== undefined) out[col] = body[col];
  }
  return out;
}

export function normalizeKb(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const col of ["title", "slug", "category"] as const) {
    if (typeof out[col] === "string") out[col] = (out[col] as string).trim();
  }
  for (const col of TEXT_COLUMNS) {
    if (typeof out[col] === "string") {
      const t = (out[col] as string).trim();
      out[col] = t.length > 0 ? t : null;
    }
  }
  return out;
}

/** true quando `cover` é uma chave R2 nova (não https, diferente da já persistida) --
 * o caller precisa então resolver o conta_id do admin chamador para validar posse. */
export function coverNeedsOwnership(cover: unknown, persisted: string | null | undefined): boolean {
  return typeof cover === "string" && !cover.startsWith("https://") && cover !== persisted;
}

export function validateKbArticle(
  row: Record<string, unknown>,
  opts: { allowedContaId?: string; persistedCover?: string | null } = {},
): string | null {
  const title = typeof row.title === "string" ? row.title.trim() : "";
  if (title.length === 0 || title.length > 200) return "title required (max 200)";
  const slug = typeof row.slug === "string" ? row.slug.trim() : "";
  if (!SLUG_RE.test(slug)) return "slug must be lowercase words separated by hyphens";
  if (RESERVED_SLUGS.includes(slug)) return `slug "${slug}" is reserved`;
  if (!KB_CATEGORIES.includes(row.category as string)) return "invalid category";
  const status = row.status ?? "draft";
  if (status !== "draft" && status !== "published") return "invalid status";

  if (row.tags !== undefined && row.tags !== null) {
    if (!Array.isArray(row.tags) || !row.tags.every((t) => typeof t === "string" && t.length > 0 && t.length <= 40)) {
      return "tags must be strings (max 40 chars)";
    }
  }
  if (row.display_order !== undefined && row.display_order !== null) {
    if (!Number.isInteger(row.display_order) || (row.display_order as number) < 0) return "display_order must be an integer >= 0";
  }
  const excerpt = row.excerpt ?? null;
  if (excerpt !== null && (typeof excerpt !== "string" || excerpt.length > 300)) return "excerpt max 300";
  const cover = row.cover_image_url ?? null;
  if (cover !== null) {
    if (typeof cover !== "string") return "cover_image_url must be https or an R2 key";
    if (!cover.startsWith("https://")) {
      if (!R2_KEY_RE.test(cover)) return "cover_image_url must be https or an R2 key";
      // Chave R2 só passa se já for a capa persistida deste artigo (pode ter sido enviada por
      // outro admin) ou se estiver sob o workspace do admin chamador -- senão qualquer kb:write
      // publicaria um arquivo privado de outro workspace (sign-r2-urls assina capas publicadas).
      const alreadyPersisted = opts.persistedCover !== undefined && opts.persistedCover === cover;
      const ownKey = opts.allowedContaId !== undefined && cover.startsWith(`contas/${opts.allowedContaId}/files/`);
      if (!alreadyPersisted && !ownKey) return "cover_image_url R2 key belongs to another workspace";
    }
  }

  const hasContent = row.content !== undefined;
  const hasPlain = row.content_plain !== undefined;
  if (hasContent !== hasPlain) return "content and content_plain go together";
  if (hasContent) {
    // content é jsonb NULLABLE e o editor do Admin salva null até o primeiro toque no corpo:
    // null = "sem corpo ainda", válido. Só um valor presente precisa ter forma de doc.
    const c = row.content as { type?: unknown } | null;
    if (c !== null && (typeof c !== "object" || Array.isArray(c) || c.type !== "doc")) return "content must be a TipTap doc";
    if (c !== null) {
      try {
        validateTiptapDoc(c);
      } catch (e) {
        return e instanceof Error ? e.message : "content has unsupported nodes";
      }
    }
    if (typeof row.content_plain !== "string") return "content_plain must be a string";
  }
  return null;
}

/** Postgres unique_violation (slug duplicado). */
export function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === "23505";
}
