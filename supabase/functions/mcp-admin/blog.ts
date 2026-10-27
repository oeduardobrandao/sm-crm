// Tools de blog do mcp-admin (spec 2026-10-23-blog-automatico §2): a rotina diária lê os
// posts, cria rascunhos e reescreve os que receberam nota. Nenhuma função aqui aprova,
// publica ou apaga: isso é só do Admin (platform-admin).
import { McpInputError } from "../_shared/mcp-token.ts";
import { BLOG_FEATURE_SLUGS } from "../_shared/blog-rules.ts";
import { BLOG_FILE_POSTS } from "../_shared/blog-file-posts.ts";
import { BLOG_DRAFT_FIELDS, validateBlogDraft, type BlogDraftValues } from "../_shared/blog-validate.ts";
import { runBlogChecks } from "./blog-checks.ts";
import { blogImageUrlPrefix } from "./images.ts";
import type { Deps } from "./deps.ts";

const TABLE = "blog_posts";
const LIST_COLUMNS = "id, slug, title, category, status, feature_slug, revision_note, rejection_reason, created_at";
const LIST_LIMIT = 200;
const EDITABLE = ["rascunho", "ajuste_solicitado"];

function invalid(errors: string[]): never {
  throw new McpInputError(`Rascunho inválido:\n${errors.join("\n")}`);
}

function validate(d: Deps, input: Record<string, unknown>): BlogDraftValues {
  const r = validateBlogDraft(input, { partial: false, imageUrlPrefix: blogImageUrlPrefix(d) });
  if (!r.ok) invalid(r.errors);
  return r.value;
}

async function assertSlugFree(d: Deps, slug: string, selfId: string | null) {
  if (BLOG_FILE_POSTS.some((p) => p.slug === slug)) {
    invalid([`slug: já existe um post em arquivo com "${slug}"; escolha outro.`]);
  }
  const { data, error } = await d.db.from(TABLE).select("id").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (data && data.id !== selfId) invalid([`slug: já existe um post com "${slug}"; escolha outro.`]);
}

function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === "23505";
}

export async function listBlogPosts(d: Deps, args: { status?: string; since_days?: number }) {
  let q = d.db.from(TABLE).select(LIST_COLUMNS);
  if (args.status) q = q.eq("status", args.status);
  if (args.since_days) {
    const since = new Date(Date.parse(d.now()) - args.since_days * 86_400_000).toISOString();
    q = q.gte("created_at", since);
  }
  const { data, error } = await q.order("created_at", { ascending: false }).limit(LIST_LIMIT);
  if (error) throw error;
  return { posts: data ?? [], file_posts: BLOG_FILE_POSTS.map(({ slug, title }) => ({ slug, title })), feature_slugs: [...BLOG_FEATURE_SLUGS] };
}

async function loadPost(d: Deps, postId: string) {
  const { data, error } = await d.db.from(TABLE).select("*").eq("id", postId).maybeSingle();
  if (error) throw error;
  if (!data) throw new McpInputError("Post não encontrado.");
  return data as Record<string, unknown>;
}

export async function getBlogPost(d: Deps, args: { post_id: string }) {
  return await loadPost(d, args.post_id);
}

export async function createBlogDraft(d: Deps, args: Record<string, unknown>) {
  const value = validate(d, args);
  await assertSlugFree(d, value.slug as string, null);
  const checks = await runBlogChecks(d, { ...value, id: null });
  const { data, error } = await d.db.from(TABLE).insert({
    ...value,
    cover_image: value.cover_image ?? null,
    images: value.images ?? [],
    feature_slug: value.feature_slug ?? null,
    status: "rascunho",
    author: "equipe",
    revision: 1,
    checks,
  }).select("id").single();
  if (isUniqueViolation(error)) invalid([`slug: já existe um post com "${value.slug as string}"; escolha outro.`]);
  if (error || !data) throw error ?? new Error("blog_posts insert returned nothing");
  return { id: data.id as string, checks };
}

export async function updateBlogDraft(d: Deps, args: Record<string, unknown> & { post_id: string }) {
  const post = await loadPost(d, args.post_id);
  if (!EDITABLE.includes(post.status as string)) {
    throw new McpInputError("Só rascunhos podem ser editados pela rotina.");
  }
  const patchKeys = BLOG_DRAFT_FIELDS.filter((f) => args[f] !== undefined);
  if (patchKeys.length === 0) throw new McpInputError("Nada para atualizar: envie ao menos um campo do rascunho.");

  // Valida o post como ficará (imagens removidas podem deixar img: órfão no corpo, sources
  // menores podem tirar a fonte de um infográfico).
  const merged: Record<string, unknown> = {};
  for (const f of BLOG_DRAFT_FIELDS) merged[f] = args[f] !== undefined ? args[f] : post[f];
  const value = validate(d, merged);
  if (value.slug !== post.slug) await assertSlugFree(d, value.slug as string, post.id as string);

  const checks = await runBlogChecks(d, { ...value, id: post.id as string });
  const revision = Number(post.revision ?? 1) + 1;
  const fromNote = post.status === "ajuste_solicitado";
  const patch: Record<string, unknown> = { checks, revision };
  for (const f of patchKeys) patch[f] = value[f];
  if (fromNote) {
    patch.status = "rascunho";
    patch.revised_after_note = true;
    patch.revision_note = null;
  }

  // Guarda otimista: se o Admin mudou status ou revisão no meio, nada é gravado.
  const { data, error } = await d.db.from(TABLE).update(patch)
    .eq("id", post.id).eq("status", post.status).eq("revision", post.revision)
    .select("id").maybeSingle();
  if (isUniqueViolation(error)) invalid([`slug: já existe um post com "${value.slug as string}"; escolha outro.`]);
  if (error) throw error;
  if (!data) {
    throw new McpInputError("O post mudou enquanto a rotina editava. Leia de novo com get_blog_post e tente outra vez.");
  }
  return { id: post.id as string, status: fromNote ? "rascunho" : post.status as string, revision, checks };
}
