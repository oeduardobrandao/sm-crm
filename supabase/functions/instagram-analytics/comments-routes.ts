// Rotas de comentários do Instagram e leitura por IA (spec
// docs/superpowers/specs/2026-11-03-instagram-comments-sentiment-design.md):
//   GET  /post-comments/:clientId/:postId
//   POST /comments-analysis/:clientId/:postId
//   GET|POST /comments-analysis-account/:clientId
// O feature gate (feature_instagram_comments_ai) roda antes, no index.ts.
// Log nunca leva texto de comentário nem username.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { classifyIgError } from "../_shared/instagram-messaging.ts";
import type { fetchMediaComments, IgComment } from "./comments-graph.ts";
import {
  AiBadOutputError,
  AiTimeoutError,
  buildAccountPrompt,
  buildPostPrompt,
  type callGemini,
  type CommentAnalysis,
  COMMENTS_MODEL,
  redactIdentities,
  validateAnalysis,
} from "./comments-ai.ts";

export interface CommentsRouteDeps {
  svc: SupabaseClient;
  contaId: string;
  userId: string;
  geminiKey: string | null;
  now: () => number;
  decryptToken: (enc: string) => Promise<string>;
  verifyClientOwnership: (clientId: string) => Promise<void>;
  rateLimit: (key: string, max: number, windowS: number) => Promise<boolean>;
  fetchComments: typeof fetchMediaComments;
  callGemini: typeof callGemini;
}

export interface StoredAnalysis {
  result: CommentAnalysis;
  comments_analyzed: number;
  comments_count_at_analysis: number;
  analyzed_at: string;
  period_start: string | null;
  period_end: string | null;
}

type RouteResult = { status: number; body: unknown };

const COMMENTS_SCOPE = "instagram_business_manage_comments";
const POST_MAX_COMMENTS = 200;
const ACCOUNT_DAYS = 30;
const ACCOUNT_MAX_POSTS = 15;
const ACCOUNT_PER_POST = 60;
const ACCOUNT_CAPTION_CHARS = 200;
const POST_MIN = 5;
const ACCOUNT_MIN = 10;
const REQUEST_BUDGET_MS = 50_000;
const FETCH_BUDGET_MS = 20_000;
const DAY_MS = 86_400_000;
const STORED_COLUMNS =
  "result, comments_analyzed, comments_count_at_analysis, analyzed_at, period_start, period_end";
const POST_ID_RE = /^[A-Za-z0-9_]{1,64}$/;

const err = (status: number, code: string): RouteResult => ({ status, body: { error: code } });

/** Sinaliza falha da Graph que não é token expirado; vira resposta genérica. */
class GraphFailure extends Error {}

interface Account {
  id: string;
  instagram_user_id: string;
  encrypted_access_token: string;
}

interface PostRow {
  instagram_post_id: string;
  caption: string | null;
  media_type: string | null;
  comments: number | null;
  posted_at?: string | null;
}

function parseRoute(
  method: string,
  path: string,
): { kind: "list" | "analyze" | "account"; clientId: string; postId?: string } | null {
  let m = path.match(/^\/post-comments\/(\d+)\/([^/]+)$/);
  if (m) return method === "GET" ? { kind: "list", clientId: m[1], postId: m[2] } : null;
  m = path.match(/^\/comments-analysis\/(\d+)\/([^/]+)$/);
  if (m) return method === "POST" ? { kind: "analyze", clientId: m[1], postId: m[2] } : null;
  m = path.match(/^\/comments-analysis-account\/(\d+)$/);
  if (m) return method === "GET" || method === "POST" ? { kind: "account", clientId: m[1] } : null;
  return null;
}

function decodePostId(raw: string): string | null {
  try {
    const id = decodeURIComponent(raw);
    return POST_ID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

function tokenExpired(): never {
  // Mesmo formato que o graphFetch do index.ts: o catch de lá marca a conta como expirada.
  throw { code: "TOKEN_EXPIRED", message: "Instagram token expired" };
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function toStored(row: Record<string, unknown>): StoredAnalysis {
  return {
    result: row.result as CommentAnalysis,
    comments_analyzed: Number(row.comments_analyzed) || 0,
    comments_count_at_analysis: Number(row.comments_count_at_analysis) || 0,
    analyzed_at: String(row.analyzed_at),
    period_start: typeof row.period_start === "string" ? row.period_start : null,
    period_end: typeof row.period_end === "string" ? row.period_end : null,
  };
}

async function loadAccount(deps: CommentsRouteDeps, clientId: string): Promise<Account | RouteResult> {
  const { data, error } = await deps.svc
    .from("instagram_accounts")
    .select("id, instagram_user_id, encrypted_access_token, authorization_status, permissions")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error(`account query failed: ${error.message}`);
  if (
    !data || data.authorization_status !== "active" || !data.encrypted_access_token ||
    !data.instagram_user_id
  ) {
    return err(404, "account_not_found");
  }
  const perms: unknown = data.permissions;
  if (!Array.isArray(perms) || !perms.includes(COMMENTS_SCOPE)) {
    return err(409, "missing_comments_scope");
  }
  return {
    id: String(data.id),
    instagram_user_id: String(data.instagram_user_id),
    encrypted_access_token: String(data.encrypted_access_token),
  };
}

async function loadPost(deps: CommentsRouteDeps, account: Account, postId: string): Promise<PostRow | null> {
  const { data, error } = await deps.svc
    .from("instagram_posts")
    .select("instagram_post_id, caption, media_type, comments")
    .eq("instagram_account_id", account.id)
    .eq("instagram_post_id", postId)
    .maybeSingle();
  if (error) throw new Error(`post query failed: ${error.message}`);
  return (data as PostRow | null) ?? null;
}

async function loadPeriodPosts(deps: CommentsRouteDeps, account: Account): Promise<PostRow[]> {
  const since = new Date(deps.now() - ACCOUNT_DAYS * DAY_MS).toISOString();
  const { data, error } = await deps.svc
    .from("instagram_posts")
    .select("instagram_post_id, caption, media_type, comments, posted_at")
    .eq("instagram_account_id", account.id)
    .gte("posted_at", since)
    .order("comments", { ascending: false });
  if (error) throw new Error(`period posts query failed: ${error.message}`);
  return Array.isArray(data) ? (data as PostRow[]) : [];
}

function sumComments(posts: PostRow[]): number {
  return posts.reduce((s, p) => s + (Number(p.comments) || 0), 0);
}

async function loadStored(
  deps: CommentsRouteDeps,
  account: Account,
  scope: "post" | "account",
  postId: string | null,
): Promise<StoredAnalysis | null> {
  let q = deps.svc
    .from("instagram_comment_analyses")
    .select(STORED_COLUMNS)
    .eq("instagram_account_id", account.id)
    .eq("ig_user_id", account.instagram_user_id)
    .eq("scope", scope);
  q = postId === null ? q.is("instagram_post_id", null) : q.eq("instagram_post_id", postId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`analysis query failed: ${error.message}`);
  return data ? toStored(data as Record<string, unknown>) : null;
}

async function fetchOrFail(
  deps: CommentsRouteDeps,
  route: string,
  args: { mediaId: string; token: string; max: number; deadlineAt: number },
): Promise<{ comments: IgComment[]; truncated: boolean }> {
  try {
    return await deps.fetchComments({ now: deps.now }, args);
  } catch (e) {
    const kind = classifyIgError(e);
    if (kind === "token_expired") tokenExpired();
    console.error(`[comments-routes] ${route} graph failed:`, kind);
    throw new GraphFailure(kind);
  }
}

function textsOf(comments: IgComment[]): string[] {
  return comments.map((c) => c.text.trim()).filter(Boolean);
}

/**
 * Pede a análise à IA, valida, dá id às ideias e redige identidades.
 * Devolve a análise final ou o erro HTTP correspondente.
 */
async function analyze(
  deps: CommentsRouteDeps,
  route: string,
  prompt: string,
  deadlineAt: number,
  usernames: string[],
  allowPostIds?: Set<string>,
): Promise<CommentAnalysis | RouteResult> {
  let raw: unknown;
  try {
    raw = await deps.callGemini({ now: deps.now }, {
      apiKey: deps.geminiKey ?? "",
      prompt,
      deadlineAt,
    });
  } catch (e) {
    if (e instanceof AiTimeoutError) {
      console.error(`[comments-routes] ${route} ai timeout`);
      return err(504, "ai_timeout");
    }
    if (e instanceof AiBadOutputError) {
      console.error(`[comments-routes] ${route} ai bad output:`, e.message);
      return err(502, "ai_bad_output");
    }
    console.error(`[comments-routes] ${route} ai unavailable:`, e instanceof Error ? e.message : "unknown");
    return err(503, "ai_unavailable");
  }

  const valid = validateAnalysis(raw, allowPostIds ? { allowPostIds } : {});
  if (!valid) {
    console.error(`[comments-routes] ${route} ai bad output: validation`);
    return err(502, "ai_bad_output");
  }
  const withIds: CommentAnalysis = {
    ...valid,
    ideias: valid.ideias.map((i) => ({ id: crypto.randomUUID(), ...i })),
  };
  const red = redactIdentities(withIds, usernames);
  const resumo = red.resumo.trim();
  const ideias = red.ideias.filter((i) => i.titulo.trim() && i.descricao.trim() && i.motivo.trim());
  if (!resumo || ideias.length < 3) {
    console.error(`[comments-routes] ${route} ai bad output: empty after redaction`);
    return err(502, "ai_bad_output");
  }
  return { ...red, resumo, ideias };
}

async function save(
  deps: CommentsRouteDeps,
  account: Account,
  row: {
    scope: "post" | "account";
    instagram_post_id: string | null;
    comments_analyzed: number;
    comments_count_at_analysis: number;
    period_start: string | null;
    period_end: string | null;
    result: CommentAnalysis;
  },
): Promise<StoredAnalysis> {
  const analyzed_at = new Date(deps.now()).toISOString();
  const { error } = await deps.svc.from("instagram_comment_analyses").upsert({
    conta_id: deps.contaId,
    instagram_account_id: account.id,
    ig_user_id: account.instagram_user_id,
    scope: row.scope,
    instagram_post_id: row.instagram_post_id,
    comments_analyzed: row.comments_analyzed,
    comments_count_at_analysis: row.comments_count_at_analysis,
    period_start: row.period_start,
    period_end: row.period_end,
    result: row.result,
    model: COMMENTS_MODEL,
    analyzed_by: deps.userId,
    analyzed_at,
  }, { onConflict: "instagram_account_id,scope,instagram_post_id" });
  if (error) throw new Error(`analysis upsert failed: ${error.message}`);
  return {
    result: row.result,
    comments_analyzed: row.comments_analyzed,
    comments_count_at_analysis: row.comments_count_at_analysis,
    analyzed_at,
    period_start: row.period_start,
    period_end: row.period_end,
  };
}

async function listRoute(
  deps: CommentsRouteDeps,
  account: Account,
  post: PostRow,
  start: number,
): Promise<RouteResult> {
  if (!(await deps.rateLimit(`ig-comments-read:${deps.contaId}`, 120, 3600))) {
    return err(429, "rate_limited");
  }
  const token = await deps.decryptToken(account.encrypted_access_token);
  const { comments, truncated } = await fetchOrFail(deps, "post-comments", {
    mediaId: post.instagram_post_id,
    token,
    max: POST_MAX_COMMENTS,
    deadlineAt: start + REQUEST_BUDGET_MS,
  });
  const cached = await loadStored(deps, account, "post", post.instagram_post_id);
  return {
    status: 200,
    body: {
      comments,
      total_fetched: comments.length,
      truncated,
      comments_count: Math.max(Number(post.comments) || 0, comments.length),
      cached_analysis: cached,
    },
  };
}

async function analyzePostRoute(
  deps: CommentsRouteDeps,
  account: Account,
  post: PostRow,
  start: number,
): Promise<RouteResult> {
  if (!deps.geminiKey) return err(503, "ai_unavailable");
  if (!(await deps.rateLimit(`ig-comments-ai:${deps.contaId}`, 20, 3600))) {
    return err(429, "rate_limited");
  }
  const token = await deps.decryptToken(account.encrypted_access_token);
  const { comments } = await fetchOrFail(deps, "comments-analysis", {
    mediaId: post.instagram_post_id,
    token,
    max: POST_MAX_COMMENTS,
    deadlineAt: start + FETCH_BUDGET_MS,
  });
  const texts = textsOf(comments);
  if (texts.length < POST_MIN) return err(422, "too_few_comments");

  const prompt = buildPostPrompt({
    caption: post.caption ?? "",
    mediaType: post.media_type ?? "",
    texts,
  });
  const result = await analyze(
    deps,
    "comments-analysis",
    prompt,
    start + REQUEST_BUDGET_MS,
    comments.map((c) => c.username),
  );
  if ("status" in result) return result;

  const analysis = await save(deps, account, {
    scope: "post",
    instagram_post_id: post.instagram_post_id,
    comments_analyzed: texts.length,
    comments_count_at_analysis: Math.max(Number(post.comments) || 0, comments.length),
    period_start: null,
    period_end: null,
    result,
  });
  return { status: 200, body: { analysis } };
}

async function accountRoute(
  deps: CommentsRouteDeps,
  method: string,
  account: Account,
  start: number,
): Promise<RouteResult> {
  if (method === "GET") {
    const posts = await loadPeriodPosts(deps, account);
    const analysis = await loadStored(deps, account, "account", null);
    return { status: 200, body: { analysis, current_comments: sumComments(posts) } };
  }

  if (!deps.geminiKey) return err(503, "ai_unavailable");
  if (!(await deps.rateLimit(`ig-comments-ai:${deps.contaId}`, 20, 3600))) {
    return err(429, "rate_limited");
  }
  const posts = await loadPeriodPosts(deps, account);
  const currentComments = sumComments(posts);
  const chosen = posts
    .filter((p) => (Number(p.comments) || 0) > 0)
    .sort((a, b) => (Number(b.comments) || 0) - (Number(a.comments) || 0))
    .slice(0, ACCOUNT_MAX_POSTS);
  if (!chosen.length) return err(422, "too_few_comments");

  const token = await deps.decryptToken(account.encrypted_access_token);
  const deadlineAt = start + FETCH_BUDGET_MS;
  const settled = await Promise.allSettled(
    chosen.map((p) =>
      deps.fetchComments({ now: deps.now }, {
        mediaId: p.instagram_post_id,
        token,
        max: ACCOUNT_PER_POST,
        deadlineAt,
      })
    ),
  );

  const blocks: { id: string; caption: string; texts: string[] }[] = [];
  const usernames: string[] = [];
  let failed = 0;
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === "rejected") {
      const kind = classifyIgError(s.reason);
      if (kind === "token_expired") tokenExpired();
      failed++;
      continue;
    }
    const texts = textsOf(s.value.comments);
    for (const c of s.value.comments) usernames.push(c.username);
    if (texts.length) {
      blocks.push({
        id: chosen[i].instagram_post_id,
        caption: (chosen[i].caption ?? "").slice(0, ACCOUNT_CAPTION_CHARS),
        texts,
      });
    }
  }
  if (failed) {
    console.error(`[comments-routes] comments-analysis-account graph failed for ${failed}/${chosen.length} posts`);
  }
  if (failed === chosen.length) throw new GraphFailure("all_posts_failed");

  const total = blocks.reduce((s, b) => s + b.texts.length, 0);
  if (total < ACCOUNT_MIN) return err(422, "too_few_comments");

  const result = await analyze(
    deps,
    "comments-analysis-account",
    buildAccountPrompt({ posts: blocks }),
    start + REQUEST_BUDGET_MS,
    usernames,
    new Set(blocks.map((b) => b.id)),
  );
  if ("status" in result) return result;

  const now = deps.now();
  const analysis = await save(deps, account, {
    scope: "account",
    instagram_post_id: null,
    comments_analyzed: total,
    comments_count_at_analysis: currentComments,
    period_start: isoDate(now - ACCOUNT_DAYS * DAY_MS),
    period_end: isoDate(now),
    result,
  });
  return { status: 200, body: { analysis, current_comments: currentComments } };
}

/** null = a rota não é desta família (o index.ts segue roteando). */
export async function handleCommentsRoute(
  method: string,
  path: string,
  deps: CommentsRouteDeps,
): Promise<RouteResult | null> {
  const route = parseRoute(method, path);
  if (!route) return null;
  const start = deps.now();
  const name = route.kind === "list"
    ? "post-comments"
    : route.kind === "analyze"
    ? "comments-analysis"
    : "comments-analysis-account";

  let postId: string | null = null;
  if (route.postId !== undefined) {
    postId = decodePostId(route.postId);
    if (!postId) return err(404, "post_not_found");
  }

  // Fora do try: "Unauthorized" segue para o catch do index.ts (401).
  await deps.verifyClientOwnership(route.clientId);

  try {
    const account = await loadAccount(deps, route.clientId);
    if ("status" in account) return account;

    if (route.kind === "account") return await accountRoute(deps, method, account, start);

    const post = await loadPost(deps, account, postId!);
    if (!post) return err(404, "post_not_found");
    return route.kind === "list"
      ? await listRoute(deps, account, post, start)
      : await analyzePostRoute(deps, account, post, start);
  } catch (e) {
    if (e instanceof GraphFailure) return err(502, "instagram_unavailable");
    // Token expirado (formato do index.ts) sobe para o catch de lá.
    if (e && typeof e === "object" && (e as { code?: string }).code === "TOKEN_EXPIRED") throw e;
    console.error(`[comments-routes] ${name} failed:`, e instanceof Error ? e.message : "unknown");
    return err(500, "internal_error");
  }
}
