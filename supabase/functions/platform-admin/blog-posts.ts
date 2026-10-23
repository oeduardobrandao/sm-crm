// Revisão e publicação do blog pelo Admin (spec 2026-10-23-blog-automatico §6-§7). A autorização
// (platform_admins) já aconteceu em index.ts.
//
// Máquina de estados à prova de queda: toda transição é um update condicional no status e na
// revisão lidos (`… where status = $s and revision = $r`), então um request morto no meio ou
// repetido não regride nem aplica duas vezes. O deploy hook dispara DEPOIS de gravar o novo
// status: se a função morre entre os dois, a linha fica `publicando` e o chip "Publicação
// demorando" oferece "Tentar de novo". "Publicado" só vale quando a página no ar traz o
// marcador `mesaas-blog-rev` igual à revisão da linha; um 200 de um deploy antigo não conta.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { insertAuditLog } from "../_shared/audit.ts";
import { BLOG_DRAFT_FIELDS, validateBlogDraft } from "../_shared/blog-validate.ts";
import { type BlogCheckPost, type BlogChecks, runBlogChecks } from "../_shared/blog-checks.ts";
import { readBodyCapped, withDeadline } from "../_shared/safe-image-fetch.ts";
import { saoPauloDate } from "../_shared/sao-paulo-date.ts";
import { fireHook, isDeployHookConfigured } from "../_shared/vercel-deploy-hook.ts";

type Headers = Record<string, string>;
type Row = Record<string, any>;

/** Tudo que as ações precisam do mundo, injetável nos testes. */
export interface BlogAdminDeps {
  hookConfigured(): boolean;
  /** true só quando a Vercel aceitou o disparo. */
  fireHook(): Promise<boolean>;
  /** HTML da página pública do post, ou null (fora do ar, timeout, erro). */
  fetchLive(slug: string): Promise<string | null>;
  now(): Date;
  runChecks(db: any, post: BlogCheckPost): Promise<BlogChecks>;
}

const TABLE = "blog_posts";
const BLOG_BUCKET = "blog-images";
export const BLOG_LIVE_BASE = "https://www.mesaas.com.br/blog";
export const LIVE_CHECK_TIMEOUT_MS = 5_000;
const LIVE_PAGE_MAX_BYTES = 512 * 1024;
export const LIVE_CHECKS_PER_LIST = 10;
const LIST_LIMIT = 200;
const NOTE_MAX = 1_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Colunas da listagem e das respostas das ações: tudo menos o corpo (que vem no get). */
const LIST_COLUMNS = [
  "id", "slug", "status", "category", "title", "h1", "description", "cover_image", "sources",
  "feature_slug", "checks", "revision_note", "revised_after_note", "rejection_reason", "date",
  "updated", "revision", "live_revision", "publish_attempt_at", "created_at", "updated_at",
  "approved_at",
].join(", ");

const TABS: Record<string, string[]> = {
  aguardando: ["rascunho", "ajuste_solicitado", "publicando"],
  publicados: ["publicado", "despublicado"],
  rejeitados: ["rejeitado"],
};

const REVIEWABLE = ["rascunho", "ajuste_solicitado"];
const LIVE = ["publicado", "publicando"];
const EDITABLE_STATUSES = [...REVIEWABLE, ...LIVE];
/** Editar texto (spec §6): título, H1, descrição, lede e corpo. Slug nunca muda (URL pública). */
export const EDITABLE_FIELDS = ["title", "h1", "description", "lede", "body_md"] as const;

// ---------------------------------------------------------------------------
// Defaults de produção
// ---------------------------------------------------------------------------

/** Busca a página pública do post. Prazo único de 5 s (signal + relógio próprio), lê no máximo
 * 512 KB (o marcador fica no <head>), nunca lança. */
export async function fetchLivePage(
  slug: string,
  fetchFn: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<string | null> {
  const signal = AbortSignal.timeout(LIVE_CHECK_TIMEOUT_MS);
  try {
    return await withDeadline(
      (async () => {
        const res = await fetchFn(`${BLOG_LIVE_BASE}/${encodeURIComponent(slug)}`, {
          method: "GET",
          redirect: "manual",
          signal,
          headers: { Accept: "text/html" },
        });
        if (!res.ok || !res.body) {
          await res.body?.cancel().catch(() => undefined);
          return null;
        }
        const read = await readBodyCapped(res.body, LIVE_PAGE_MAX_BYTES, true);
        return read ? new TextDecoder().decode(read.bytes) : null;
      })(),
      LIVE_CHECK_TIMEOUT_MS,
    );
  } catch (e) {
    console.error("[platform-admin] blog live check failed:", e instanceof Error ? e.name : "unknown");
    return null;
  }
}

export function defaultBlogAdminDeps(): BlogAdminDeps {
  return {
    hookConfigured: () => isDeployHookConfigured(),
    fireHook: () => fireHook(),
    fetchLive: (slug) => fetchLivePage(slug),
    now: () => new Date(),
    runChecks: (db, post) =>
      runBlogChecks({
        db,
        now: () => new Date().toISOString(),
        resolveDns: (hostname, recordType) => Deno.resolveDns(hostname, recordType),
        fetchUrl: (url, init) => fetch(url, init),
      }, post),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(body: unknown, status: number, headers: Headers): Response {
  return new Response(JSON.stringify(body), { status, headers });
}
const badRequest = (h: Headers) => json({ error: "invalid_request" }, 400, h);
const notFound = (h: Headers) => json({ error: "not_found" }, 404, h);
const conflict = (h: Headers) => json({ error: "conflict" }, 409, h);
const unavailable = (h: Headers) => json({ error: "publish_unavailable" }, 503, h);
const hookFailed = (h: Headers, extra: Row = {}) => json({ error: "deploy_hook_failed", ...extra }, 502, h);
/** Editar e pedir ajuste exigem a revisão que o admin leu: sem ela o save ou a nota cairiam às
 * cegas sobre um rascunho que a rotina reescreveu. */
const missingRevision = (h: Headers) =>
  json({ error: "invalid_fields", details: ["expected_revision: obrigatório."] }, 400, h);

function parseId(body: Row): string | null {
  return typeof body.id === "string" && UUID_RE.test(body.id) ? body.id : null;
}

/** undefined = não informado; null = inválido. */
function parseRevision(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  return Number.isInteger(v) && (v as number) >= 1 ? v as number : null;
}

/** Extrai `<meta name="mesaas-blog-rev" content="N">` do HTML, em qualquer ordem de atributos,
 * com aspas duplas, simples ou sem aspas. null quando ausente ou não inteiro. */
export function parseBlogRevMarker(html: string): number | null {
  const attr = (tag: string, name: string): string | null => {
    const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>/]+))`, "i").exec(tag);
    return m ? (m[1] ?? m[2] ?? m[3]) : null;
  };
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (attr(tag, "name")?.trim().toLowerCase() !== "mesaas-blog-rev") continue;
    const content = attr(tag, "content")?.trim() ?? "";
    return /^\d{1,9}$/.test(content) ? Number(content) : null;
  }
  return null;
}

async function loadRow(svc: SupabaseClient, id: string, columns = "*"): Promise<Row | null> {
  const { data, error } = await svc.from(TABLE).select(columns).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Row | null) ?? null;
}

/** Update condicional: só grava se a linha ainda está no status e na revisão esperados.
 * Devolve a linha gravada, ou null quando outra ação chegou antes. */
async function guardedUpdate(
  svc: SupabaseClient,
  id: string,
  guard: { status: string; revision: number },
  patch: Row,
): Promise<Row | null> {
  const { data, error } = await svc.from(TABLE).update(patch)
    .eq("id", id).eq("status", guard.status).eq("revision", guard.revision)
    .select(LIST_COLUMNS).maybeSingle();
  if (error) throw error;
  return (data as Row | null) ?? null;
}

async function safeFire(deps: BlogAdminDeps): Promise<boolean> {
  try {
    return (await deps.fireHook()) === true;
  } catch (e) {
    console.error("[platform-admin] blog deploy hook threw:", e instanceof Error ? e.name : "unknown");
    return false;
  }
}

/** Desfaz uma transição depois de o hook falhar. Guardado no status novo e na mesma revisão:
 * se alguém já mexeu no post, não sobrescreve. Falhar aqui só loga (a resposta já é 502). */
async function revert(svc: SupabaseClient, id: string, guard: { status: string; revision: number }, patch: Row) {
  try {
    await guardedUpdate(svc, id, guard, patch);
  } catch (e) {
    console.error("[platform-admin] blog revert after hook failure failed:", e);
  }
}

function audit(svc: SupabaseClient, adminUserId: string, verb: string, id: string, metadata: Row) {
  return insertAuditLog(svc, {
    action: `blog.${verb}`,
    actor_user_id: adminUserId,
    resource_type: "blog_post",
    resource_id: id,
    metadata,
  });
}

function imageUrlPrefix(svc: SupabaseClient): string {
  const probe = svc.storage.from(BLOG_BUCKET).getPublicUrl("x").data.publicUrl as string;
  return probe.slice(0, -1);
}

/** Revalida a linha inteira antes de mandá-la ao build: um rascunho salvo antes de uma mudança
 * do validador não pode ser aprovado (nem republicado) e travar o blog:sync de todo deploy.
 * Devolve a resposta 400 invalid_fields, ou null quando a linha é válida. */
function invalidRow(svc: SupabaseClient, row: Row, headers: Headers): Response | null {
  const draft: Row = {};
  for (const f of BLOG_DRAFT_FIELDS) draft[f] = row[f];
  const v = validateBlogDraft(draft, { partial: false, imageUrlPrefix: imageUrlPrefix(svc) });
  return v.ok ? null : json({ error: "invalid_fields", details: v.errors }, 400, headers);
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** Confirma no ar uma linha `publicando`: vira `publicado` só se o marcador bate com a revisão. */
async function confirmLive(svc: SupabaseClient, row: Row, deps: BlogAdminDeps): Promise<boolean> {
  const html = await deps.fetchLive(row.slug as string);
  if (!html) return false;
  if (parseBlogRevMarker(html) !== row.revision) return false;
  const flipped = await guardedUpdate(svc, row.id, { status: "publicando", revision: row.revision }, {
    status: "publicado",
    live_revision: row.revision,
  });
  return flipped !== null;
}

export async function handleListBlogPosts(
  svc: SupabaseClient,
  body: Row,
  _adminUserId: string,
  headers: Headers,
  deps: BlogAdminDeps,
) {
  const statuses = typeof body.tab === "string" ? TABS[body.tab] : undefined;
  if (!statuses || !Object.hasOwn(TABS, body.tab)) return badRequest(headers);

  const [list, last] = await Promise.all([
    svc.from(TABLE).select(LIST_COLUMNS).in("status", statuses)
      .order("created_at", { ascending: false }).limit(LIST_LIMIT),
    svc.from(TABLE).select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (list.error) throw list.error;
  if (last.error) throw last.error;
  const rows = (list.data ?? []) as Row[];

  // Confirmação no ar em paralelo, no máximo 10 por chamada; falha numa linha não afeta as outras
  // nem a resposta (a próxima listagem tenta de novo).
  const pending = rows.filter((r) => r.status === "publicando").slice(0, LIVE_CHECKS_PER_LIST);
  const settled = await Promise.allSettled(pending.map((r) => confirmLive(svc, r, deps)));
  settled.forEach((s, i) => {
    if (s.status === "fulfilled" && s.value) {
      pending[i].status = "publicado";
      pending[i].live_revision = pending[i].revision;
    } else if (s.status === "rejected") {
      console.error("[platform-admin] blog confirm live failed:", s.reason);
    }
  });

  return json({
    posts: rows.filter((r) => statuses.includes(r.status)),
    last_draft_at: (last.data as Row | null)?.created_at ?? null,
  }, 200, headers);
}

export async function handleGetBlogPost(svc: SupabaseClient, body: Row, headers: Headers) {
  const id = parseId(body);
  if (!id) return badRequest(headers);
  const row = await loadRow(svc, id);
  return row ? json({ post: row }, 200, headers) : notFound(headers);
}

// ---------------------------------------------------------------------------
// Editar texto
// ---------------------------------------------------------------------------

export async function handleUpdateBlogPost(
  svc: SupabaseClient,
  body: Row,
  adminUserId: string,
  headers: Headers,
  deps: BlogAdminDeps,
) {
  const id = parseId(body);
  const expected = parseRevision(body.expected_revision);
  const fields = body.fields;
  if (!id || expected === null || !fields || typeof fields !== "object" || Array.isArray(fields)) {
    return badRequest(headers);
  }
  if (expected === undefined) return missingRevision(headers);
  const keys = Object.keys(fields);
  if (keys.length === 0 || keys.some((k) => !(EDITABLE_FIELDS as readonly string[]).includes(k))) {
    return badRequest(headers);
  }

  const row = await loadRow(svc, id);
  if (!row) return notFound(headers);
  if (!EDITABLE_STATUSES.includes(row.status)) return conflict(headers);
  if (expected !== row.revision) return conflict(headers);
  const goesLive = LIVE.includes(row.status);
  if (goesLive && !deps.hookConfigured()) return unavailable(headers);

  // Valida o post inteiro como ficará (img: e fontes dos infográficos dependem do todo).
  const merged: Row = {};
  for (const f of BLOG_DRAFT_FIELDS) merged[f] = row[f];
  for (const k of keys) merged[k] = (fields as Row)[k];
  const v = validateBlogDraft(merged, { partial: false, imageUrlPrefix: imageUrlPrefix(svc) });
  if (!v.ok) return json({ error: "invalid_fields", details: v.errors }, 400, headers);

  const checks = await deps.runChecks(svc, { ...v.value, id });
  const now = deps.now();
  const patch: Row = { checks, revision: row.revision + 1 };
  for (const k of keys) patch[k] = v.value[k as keyof typeof v.value];
  if (goesLive) {
    // A página no ar mantém a revisão antiga até o marcador bater (live_revision não muda).
    patch.status = "publicando";
    // "Atualizado em" só para quem já esteve no ar: um post aprovado cujo primeiro build ainda
    // não confirmou estrearia com dateModified posterior ao datePublished.
    if (row.live_revision != null) patch.updated = saoPauloDate(now);
    patch.publish_attempt_at = now.toISOString();
  }

  const saved = await guardedUpdate(svc, id, { status: row.status, revision: row.revision }, patch);
  if (!saved) return conflict(headers);
  await audit(svc, adminUserId, "edit", id, { from: row.status, revision: patch.revision, fields: keys });

  // Hook falhou: o texto fica salvo (é válido) e a linha segue publicando; "Tentar de novo"
  // (retry-blog-publish) redispara. Voltar o status mentiria sobre o que está no ar.
  if (goesLive && !(await safeFire(deps))) return hookFailed(headers, { saved: true, post: saved });
  return json({ post: saved }, 200, headers);
}

// ---------------------------------------------------------------------------
// Aprovar, pedir ajuste, rejeitar
// ---------------------------------------------------------------------------

export async function handleApproveBlogPost(
  svc: SupabaseClient,
  body: Row,
  adminUserId: string,
  headers: Headers,
  deps: BlogAdminDeps,
) {
  const id = parseId(body);
  const expected = parseRevision(body.expected_revision);
  if (!id || typeof expected !== "number") return badRequest(headers);
  if (!deps.hookConfigured()) return unavailable(headers);

  const row = await loadRow(svc, id);
  if (!row) return notFound(headers);
  if (!REVIEWABLE.includes(row.status) || row.revision !== expected) return conflict(headers);
  const invalid = invalidRow(svc, row, headers);
  if (invalid) return invalid;

  const now = deps.now();
  const saved = await guardedUpdate(svc, id, { status: row.status, revision: expected }, {
    status: "publicando",
    date: row.date ?? saoPauloDate(now),
    approved_at: now.toISOString(),
    approved_by: adminUserId,
    publish_attempt_at: now.toISOString(),
  });
  if (!saved) return conflict(headers);

  if (!(await safeFire(deps))) {
    await revert(svc, id, { status: "publicando", revision: expected }, {
      status: row.status,
      date: row.date ?? null,
      approved_at: row.approved_at ?? null,
      approved_by: row.approved_by ?? null,
      publish_attempt_at: row.publish_attempt_at ?? null,
    });
    return hookFailed(headers);
  }
  await audit(svc, adminUserId, "approve", id, { from: row.status, revision: expected });
  return json({ post: saved }, 200, headers);
}

export async function handleRequestBlogChanges(
  svc: SupabaseClient,
  body: Row,
  adminUserId: string,
  headers: Headers,
  _deps: BlogAdminDeps,
) {
  const id = parseId(body);
  const expected = parseRevision(body.expected_revision);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!id || expected === null || note.length < 1 || note.length > NOTE_MAX) return badRequest(headers);
  if (expected === undefined) return missingRevision(headers);

  const row = await loadRow(svc, id, "id, status, revision");
  if (!row) return notFound(headers);
  if (!REVIEWABLE.includes(row.status) || expected !== row.revision) return conflict(headers);

  const saved = await guardedUpdate(svc, id, { status: row.status, revision: row.revision }, {
    status: "ajuste_solicitado",
    revision_note: note,
    // Nota nova: o chip "Reescrito após sua nota" volta só depois da próxima reescrita.
    revised_after_note: false,
  });
  if (!saved) return conflict(headers);
  await audit(svc, adminUserId, "request_changes", id, { from: row.status, revision: row.revision });
  return json({ post: saved }, 200, headers);
}

export async function handleRejectBlogPost(
  svc: SupabaseClient,
  body: Row,
  adminUserId: string,
  headers: Headers,
  _deps: BlogAdminDeps,
) {
  const id = parseId(body);
  if (!id) return badRequest(headers);
  if (body.reason !== undefined && body.reason !== null && typeof body.reason !== "string") return badRequest(headers);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length > NOTE_MAX) return badRequest(headers);

  const row = await loadRow(svc, id, "id, status, revision");
  if (!row) return notFound(headers);
  if (!REVIEWABLE.includes(row.status)) return conflict(headers);

  const saved = await guardedUpdate(svc, id, { status: row.status, revision: row.revision }, {
    status: "rejeitado",
    rejection_reason: reason || null,
  });
  if (!saved) return conflict(headers);
  await audit(svc, adminUserId, "reject", id, { from: row.status, revision: row.revision });
  return json({ post: saved }, 200, headers);
}

// ---------------------------------------------------------------------------
// Despublicar, republicar, tentar de novo
// ---------------------------------------------------------------------------

export async function handleUnpublishBlogPost(
  svc: SupabaseClient,
  body: Row,
  adminUserId: string,
  headers: Headers,
  deps: BlogAdminDeps,
) {
  const id = parseId(body);
  if (!id) return badRequest(headers);
  if (!deps.hookConfigured()) return unavailable(headers);

  const row = await loadRow(svc, id, "id, status, revision");
  if (!row) return notFound(headers);
  if (!LIVE.includes(row.status)) return conflict(headers);

  const guard = { status: row.status, revision: row.revision };
  const saved = await guardedUpdate(svc, id, guard, { status: "despublicado" });
  if (!saved) return conflict(headers);
  // Sem build novo a página segue no ar: volta ao status anterior para o Admin poder repetir.
  if (!(await safeFire(deps))) {
    await revert(svc, id, { status: "despublicado", revision: row.revision }, { status: row.status });
    return hookFailed(headers);
  }
  await audit(svc, adminUserId, "unpublish", id, { from: row.status, revision: row.revision });
  return json({ post: saved }, 200, headers);
}

export async function handleRepublishBlogPost(
  svc: SupabaseClient,
  body: Row,
  adminUserId: string,
  headers: Headers,
  deps: BlogAdminDeps,
) {
  const id = parseId(body);
  if (!id) return badRequest(headers);
  if (!deps.hookConfigured()) return unavailable(headers);

  const row = await loadRow(svc, id);
  if (!row) return notFound(headers);
  if (row.status !== "despublicado") return conflict(headers);
  const invalid = invalidRow(svc, row, headers);
  if (invalid) return invalid;

  const saved = await guardedUpdate(svc, id, { status: "despublicado", revision: row.revision }, {
    status: "publicando",
    publish_attempt_at: deps.now().toISOString(),
  });
  if (!saved) return conflict(headers);
  if (!(await safeFire(deps))) {
    await revert(svc, id, { status: "publicando", revision: row.revision }, {
      status: "despublicado",
      publish_attempt_at: row.publish_attempt_at ?? null,
    });
    return hookFailed(headers);
  }
  await audit(svc, adminUserId, "republish", id, { revision: row.revision });
  return json({ post: saved }, 200, headers);
}

export async function handleRetryBlogPublish(
  svc: SupabaseClient,
  body: Row,
  adminUserId: string,
  headers: Headers,
  deps: BlogAdminDeps,
) {
  const id = parseId(body);
  if (!id) return badRequest(headers);
  if (!deps.hookConfigured()) return unavailable(headers);

  const row = await loadRow(svc, id);
  if (!row) return notFound(headers);
  // publicando: o build que põe a revisão no ar. despublicado: o build que tira a página do ar
  // (se o primeiro falhou, ela segue no ar com o Admin dizendo "despublicado").
  if (row.status !== "publicando" && row.status !== "despublicado") return conflict(headers);
  if (row.status === "publicando") {
    const invalid = invalidRow(svc, row, headers);
    if (invalid) return invalid;
  }

  // Redisparar para a mesma revisão é idempotente; o status não muda em nenhum caso.
  const saved = await guardedUpdate(svc, id, { status: row.status, revision: row.revision }, {
    publish_attempt_at: deps.now().toISOString(),
  });
  if (!saved) return conflict(headers);
  if (!(await safeFire(deps))) return hookFailed(headers);
  await audit(svc, adminUserId, "retry", id, { from: row.status, revision: row.revision });
  return json({ post: saved }, 200, headers);
}
