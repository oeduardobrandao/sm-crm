// deno-lint-ignore-file no-explicit-any
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { signGetUrl } from "../_shared/r2.ts";
import { McpKeyContext, McpInputError } from "../_shared/mcp-token.ts";
import { MCP_PROP_MODO, MCP_PROP_ANOTACAO } from "./seed.ts";
import {
  allowlistClient,
  buildPostFeedback,
  buildPropertyDefinitions,
  buildTiptapDoc,
  CLIENT_PUBLIC_FIELDS,
  computeRates,
  deriveFormatMeta,
  extractTemplateOptionIds,
  FeedbackRow,
  firstLine,
  IG_RATE_WEIGHTS,
  instantiateTemplateEtapas,
  isPlanLimitExceeded,
  MIN_SAMPLE,
  normalizeTemplateEtapas,
  pageContentToMarkdown,
  performanceTier,
  projectTemplateEtapas,
  quartiles,
  Quartiles,
  type RateKey,
  StatusEventRow,
  topDistinctPostIds,
  validatePropertyValue,
} from "./content.ts";

const METRIC_KEYS = ["reach", "saved", "shares", "comments", "likes"] as const;
type MetricKey = (typeof METRIC_KEYS)[number];
export type Metrics = Record<MetricKey, number>;

export interface PostMetricRow {
  reach: number; saved: number; shares: number; comments: number; likes: number;
  impressions: number; unavailable: string[]; media_type: string;
}

export interface Deps {
  db: SupabaseClient;
  ctx: McpKeyContext;
  signUrl?: (key: string) => Promise<string>;
  now?: () => string;
  genId?: () => string;
}

const sign = (d: Deps) => d.signUrl ?? ((key: string) => signGetUrl(key, 3600));

// ---- clients -----------------------------------------------------------------

export async function listClients(d: Deps, args: { status?: string }): Promise<any[]> {
  let q = d.db.from("clientes").select(CLIENT_PUBLIC_FIELDS.join(",")).eq("conta_id", d.ctx.conta_id);
  if (args.status) q = q.eq("status", args.status);
  const { data } = await q.order("nome");
  return ((data ?? []) as any[]).map(allowlistClient);
}

export async function getClient(d: Deps, args: { client_id: number }): Promise<any | null> {
  const { data } = await d.db
    .from("clientes")
    .select(CLIENT_PUBLIC_FIELDS.join(","))
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", args.client_id)
    .maybeSingle();
  return data ? allowlistClient(data as any) : null;
}

/** Verify a client belongs to this workspace; returns its row (public fields) or null. */
async function verifyClient(d: Deps, clientId: number): Promise<any | null> {
  const { data } = await d.db
    .from("clientes")
    .select("id, especialidade, cor")
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", clientId)
    .maybeSingle();
  return data ?? null;
}

export async function getBrandProfile(d: Deps, args: { client_id: number }): Promise<any | null> {
  const client = await verifyClient(d, args.client_id);
  if (!client) return null;

  const { data: brand } = await d.db
    .from("hub_brand")
    .select("logo_url, primary_color, secondary_color, font_primary, font_secondary")
    .eq("cliente_id", args.client_id)
    .maybeSingle();

  const { data: briefings } = await d.db
    .from("briefings")
    .select("id, title, display_order")
    .eq("conta_id", d.ctx.conta_id)
    .eq("cliente_id", args.client_id)
    .order("display_order");
  const titleById = new Map<string, string>((briefings ?? []).map((b: any) => [b.id, b.title]));

  const { data: questions } = await d.db
    .from("hub_briefing_questions")
    .select("question, answer, display_order, briefing_id")
    .eq("conta_id", d.ctx.conta_id)
    .eq("cliente_id", args.client_id)
    .order("display_order");

  return {
    especialidade: client.especialidade ?? null,
    cor: client.cor ?? null,
    visual: brand ?? null,
    briefing: (questions ?? [])
      .filter((qn: any) => qn.answer && String(qn.answer).trim().length > 0)
      .map((qn: any) => ({
        section: qn.briefing_id ? titleById.get(qn.briefing_id) ?? null : null,
        question: qn.question,
        answer: qn.answer,
      })),
  };
}

// ---- post enrichment helpers -------------------------------------------------

/** modo + anotacao for a set of posts, read from the seeded custom properties. */
async function loadPostProps(
  d: Deps,
  postIds: number[],
): Promise<Map<number, { modo: string | null; anotacao: string | null }>> {
  const out = new Map<number, { modo: string | null; anotacao: string | null }>();
  if (postIds.length === 0) return out;
  const { data } = await d.db
    .from("post_property_values")
    .select("post_id, value, template_property_definitions!inner(name, conta_id)")
    .in("post_id", postIds)
    .eq("template_property_definitions.conta_id", d.ctx.conta_id)
    .in("template_property_definitions.name", [MCP_PROP_MODO, MCP_PROP_ANOTACAO]);
  for (const row of data ?? []) {
    const name = (row as any).template_property_definitions?.name as string;
    const v = coercePropValue((row as any).value);
    const entry = out.get((row as any).post_id) ?? { modo: null, anotacao: null };
    if (name === MCP_PROP_MODO) entry.modo = v;
    else if (name === MCP_PROP_ANOTACAO) entry.anotacao = v;
    out.set((row as any).post_id, entry);
  }
  return out;
}

function coercePropValue(value: any): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && typeof value.value === "string") return value.value;
  return JSON.stringify(value);
}

/** Per-post media kinds/durations (NOT signed) — enough for format/slide derivation. */
async function loadMediaLite(
  d: Deps,
  postIds: number[],
): Promise<Map<number, { kind: string; duration_seconds: number | null }[]>> {
  const out = new Map<number, { kind: string; duration_seconds: number | null }[]>();
  if (postIds.length === 0) return out;
  const { data } = await d.db
    .from("post_file_links")
    .select("post_id, sort_order, files!inner(kind, duration_seconds)")
    .eq("conta_id", d.ctx.conta_id)
    .in("post_id", postIds)
    .order("sort_order");
  for (const row of data ?? []) {
    const arr = out.get((row as any).post_id) ?? [];
    arr.push({
      kind: (row as any).files.kind,
      duration_seconds: (row as any).files.duration_seconds ?? null,
    });
    out.set((row as any).post_id, arr);
  }
  return out;
}

/** Published metrics keyed by media id AND permalink, for the given posts. */
async function loadMetrics(
  d: Deps,
  posts: { instagram_media_id: string | null; instagram_permalink: string | null }[],
): Promise<{ byMediaId: Map<string, PostMetricRow>; byPermalink: Map<string, PostMetricRow> }> {
  const mediaIds = posts.map((p) => p.instagram_media_id).filter((x): x is string => !!x);
  const permalinks = posts.map((p) => p.instagram_permalink).filter((x): x is string => !!x);
  const byMediaId = new Map<string, PostMetricRow>();
  const byPermalink = new Map<string, PostMetricRow>();
  if (mediaIds.length === 0 && permalinks.length === 0) return { byMediaId, byPermalink };

  // Tenant scope: instagram_posts has no conta_id column, so scope through the
  // account chain (instagram_posts -> instagram_accounts -> clientes.conta_id)
  // via inner joins. Defense-in-depth: the media-id path is already airtight
  // (UNIQUE(instagram_post_id)), but the permalink path has no DB-level
  // uniqueness, so this closes any cross-tenant permalink collision.
  const cols =
    "instagram_post_id, permalink, reach, saved, shares, comments, likes, impressions, unavailable_metrics, media_type, " +
    "instagram_accounts!inner(clientes!inner(conta_id))";
  const collect = (rows: any[]) => {
    for (const r of rows ?? []) {
      const m: PostMetricRow = {
        reach: r.reach ?? 0, saved: r.saved ?? 0, shares: r.shares ?? 0,
        comments: r.comments ?? 0, likes: r.likes ?? 0, impressions: r.impressions ?? 0,
        unavailable: Array.isArray(r.unavailable_metrics) ? r.unavailable_metrics : [],
        media_type: r.media_type ?? "UNKNOWN",
      };
      if (r.instagram_post_id) byMediaId.set(r.instagram_post_id, m);
      if (r.permalink) byPermalink.set(r.permalink, m);
    }
  };
  if (mediaIds.length) {
    const { data } = await d.db
      .from("instagram_posts")
      .select(cols)
      .in("instagram_post_id", mediaIds)
      .eq("instagram_accounts.clientes.conta_id", d.ctx.conta_id);
    collect(data ?? []);
  }
  if (permalinks.length) {
    const { data } = await d.db
      .from("instagram_posts")
      .select(cols)
      .in("permalink", permalinks)
      .eq("instagram_accounts.clientes.conta_id", d.ctx.conta_id);
    collect(data ?? []);
  }
  return { byMediaId, byPermalink };
}

function metricsFor(
  post: { instagram_media_id: string | null; instagram_permalink: string | null },
  maps: { byMediaId: Map<string, PostMetricRow>; byPermalink: Map<string, PostMetricRow> },
): PostMetricRow | null {
  if (post.instagram_media_id && maps.byMediaId.has(post.instagram_media_id)) {
    return maps.byMediaId.get(post.instagram_media_id)!;
  }
  if (post.instagram_permalink && maps.byPermalink.has(post.instagram_permalink)) {
    return maps.byPermalink.get(post.instagram_permalink)!;
  }
  return null;
}

// ---- posts -------------------------------------------------------------------

const POST_COLS =
  "id, workflow_id, titulo, tipo, status, ig_caption, conteudo_plain, created_via, " +
  "instagram_media_id, instagram_permalink, scheduled_at, published_at, created_at";

async function clientWorkflowIds(d: Deps, clientId: number): Promise<number[]> {
  const { data } = await d.db
    .from("workflows")
    .select("id")
    .eq("conta_id", d.ctx.conta_id)
    .eq("cliente_id", clientId);
  return (data ?? []).map((w: any) => w.id);
}

export async function listPosts(
  d: Deps,
  args: {
    client_id?: number;
    formato?: string;
    modo?: string;
    published_since?: string;
    sort_by_metric?: MetricKey;
    limit?: number;
  },
): Promise<any[]> {
  const limit = Math.min(Math.max(1, args.limit ?? 50), 200);
  let q = d.db.from("workflow_posts").select(POST_COLS).eq("conta_id", d.ctx.conta_id);

  if (args.client_id !== undefined) {
    const wfIds = await clientWorkflowIds(d, args.client_id);
    if (wfIds.length === 0) return [];
    q = q.in("workflow_id", wfIds);
  }
  if (args.formato) q = q.eq("tipo", args.formato);
  if (args.published_since) q = q.gte("published_at", args.published_since);
  q = q.order("published_at", { ascending: false, nullsFirst: false }).limit(limit);

  const { data: posts } = await q;
  const rows = (posts ?? []) as any[];
  if (rows.length === 0) return [];

  const ids = rows.map((p) => p.id);
  const [props, media, metricMaps] = await Promise.all([
    loadPostProps(d, ids),
    loadMediaLite(d, ids),
    loadMetrics(d, rows),
  ]);

  let result = rows.map((p) => {
    const pm = props.get(p.id) ?? { modo: null, anotacao: null };
    const fmt = deriveFormatMeta(p.tipo, media.get(p.id) ?? []);
    const mrow = metricsFor(p, metricMaps);
    const rates = mrow
      ? computeRates(mrow, mrow.unavailable)
      : { share_rate: null, like_rate: null, save_rate: null, comment_rate: null };
    return {
      id: p.id,
      workflow_id: p.workflow_id,
      titulo: p.titulo,
      tipo: p.tipo,
      status: p.status,
      ig_caption: p.ig_caption ?? null,
      slide_1_text: firstLine(p.conteudo_plain),
      modo: pm.modo,
      anotacao: pm.anotacao,
      num_slides: fmt.num_slides,
      duration_seconds: fmt.duration_seconds,
      published: p.published_at !== null,
      published_at: p.published_at,
      instagram_permalink: p.instagram_permalink ?? null,
      created_via: p.created_via,
      metrics: mrow,
      views: mrow?.impressions ?? null,
      ...rates,
      ig_score: null,
    };
  });

  if (args.modo) result = result.filter((r) => r.modo === args.modo);
  if (args.sort_by_metric) {
    const k = args.sort_by_metric;
    result.sort((a, b) => (b.metrics?.[k] ?? -1) - (a.metrics?.[k] ?? -1));
  }
  return result;
}

export async function getPost(d: Deps, args: { post_id: number }): Promise<any | null> {
  const { data: post } = await d.db
    .from("workflow_posts")
    .select(POST_COLS)
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", args.post_id)
    .maybeSingle();
  if (!post) return null;
  const p = post as any;

  const [props, metricMaps] = await Promise.all([
    loadPostProps(d, [p.id]),
    loadMetrics(d, [p]),
  ]);

  // Signed media (1h) for the single post.
  const { data: links } = await d.db
    .from("post_file_links")
    .select("is_cover, sort_order, files!inner(r2_key, thumbnail_r2_key, kind, mime_type, width, height, duration_seconds)")
    .eq("conta_id", d.ctx.conta_id)
    .eq("post_id", p.id)
    .order("sort_order");
  const signUrl = sign(d);
  const media = await Promise.all(
    (links ?? []).map(async (l: any) => ({
      kind: l.files.kind,
      mime_type: l.files.mime_type,
      width: l.files.width,
      height: l.files.height,
      duration_seconds: l.files.duration_seconds ?? null,
      is_cover: l.is_cover,
      url: await signUrl(l.files.r2_key),
      thumbnail_url: l.files.thumbnail_r2_key ? await signUrl(l.files.thumbnail_r2_key) : null,
    })),
  );

  const pm = props.get(p.id) ?? { modo: null, anotacao: null };
  const fmt = deriveFormatMeta(p.tipo, media.map((m) => ({ kind: m.kind, duration_seconds: m.duration_seconds })));
  const mrow = metricsFor(p, metricMaps);
  const rates = mrow
    ? computeRates(mrow, mrow.unavailable)
    : { share_rate: null, like_rate: null, save_rate: null, comment_rate: null };

  return {
    id: p.id,
    workflow_id: p.workflow_id,
    titulo: p.titulo,
    tipo: p.tipo,
    status: p.status,
    ig_caption: p.ig_caption ?? null,
    conteudo_plain: p.conteudo_plain ?? null,
    slide_1_text: firstLine(p.conteudo_plain),
    modo: pm.modo,
    anotacao: pm.anotacao,
    num_slides: fmt.num_slides,
    duration_seconds: fmt.duration_seconds,
    media,
    published: p.published_at !== null,
    published_at: p.published_at,
    scheduled_at: p.scheduled_at,
    instagram_permalink: p.instagram_permalink ?? null,
    created_via: p.created_via,
    metrics: mrow,
    views: mrow?.impressions ?? null,
    ...rates,
    ig_score: null,
  };
}

// ---- performance baseline ----------------------------------------------------

export async function getPerformanceBaseline(
  d: Deps,
  args: { client_id: number },
): Promise<any | null> {
  const client = await verifyClient(d, args.client_id);
  if (!client) return null;

  const { data: accounts } = await d.db
    .from("instagram_accounts")
    .select("id")
    .eq("client_id", args.client_id);
  const accountIds = (accounts ?? []).map((a: any) => a.id);
  if (accountIds.length === 0) return { sample_size: 0, overall: {}, by_format: {} };

  const { data: posts } = await d.db
    .from("instagram_posts")
    .select("media_type, reach, saved, shares, comments, likes")
    .in("instagram_account_id", accountIds);
  const rows = (posts ?? []) as any[];

  const baselineFor = (subset: any[]): Record<string, Quartiles | null> => {
    const out: Record<string, Quartiles | null> = {};
    for (const k of METRIC_KEYS) out[k] = quartiles(subset.map((r) => r[k] ?? 0));
    return out;
  };

  const byFormat: Record<string, Record<string, Quartiles | null>> = {};
  for (const fmt of new Set(rows.map((r) => r.media_type).filter(Boolean))) {
    byFormat[fmt] = baselineFor(rows.filter((r) => r.media_type === fmt));
  }

  return { sample_size: rows.length, overall: baselineFor(rows), by_format: byFormat };
}

// ---- rate distributions ------------------------------------------------------

export type DistBuckets = Record<RateKey, number[]> & { reach: number[] };

function emptyBuckets(): DistBuckets {
  return { share_rate: [], like_rate: [], save_rate: [], comment_rate: [], reach: [] };
}

/** Load a client's per-format and overall rate (+raw reach) distributions. */
export async function loadClientRateDistributions(
  d: Deps,
  clientId: number,
): Promise<{ sampleSize: number; overall: DistBuckets; byFormat: Record<string, DistBuckets> }> {
  // Workspace-ownership guard: callers pass an agent-supplied client_id, so a
  // non-owned/unknown client must yield empty buckets (no cross-tenant leak).
  const client = await verifyClient(d, clientId);
  if (!client) return { sampleSize: 0, overall: emptyBuckets(), byFormat: {} };

  const { data: accounts } = await d.db
    .from("instagram_accounts").select("id").eq("client_id", clientId);
  const accountIds = (accounts ?? []).map((a: any) => a.id);
  const overall = emptyBuckets();
  const byFormat: Record<string, DistBuckets> = {};
  if (accountIds.length === 0) return { sampleSize: 0, overall, byFormat };

  const { data: posts } = await d.db
    .from("instagram_posts")
    .select("media_type, reach, impressions, saved, shares, likes, comments, unavailable_metrics")
    .in("instagram_account_id", accountIds);
  const rows = (posts ?? []) as any[];

  for (const p of rows) {
    const unavailable = Array.isArray(p.unavailable_metrics) ? p.unavailable_metrics : [];
    const rates = computeRates(
      { shares: p.shares ?? 0, likes: p.likes ?? 0, saved: p.saved ?? 0, comments: p.comments ?? 0, impressions: p.impressions ?? 0 },
      unavailable,
    );
    const fmt = p.media_type ?? "UNKNOWN";
    byFormat[fmt] ??= emptyBuckets();
    for (const key of Object.keys(IG_RATE_WEIGHTS) as RateKey[]) {
      const v = rates[key];
      if (v !== null) { overall[key].push(v); byFormat[fmt][key].push(v); }
    }
    if (!unavailable.includes("reach") && typeof p.reach === "number") {
      overall.reach.push(p.reach); byFormat[fmt].reach.push(p.reach);
    }
  }
  return { sampleSize: rows.length, overall, byFormat };
}

/** Pick, per rate, the format sample if it has >= MIN_SAMPLE, else the overall sample. */
export function selectRateSamples(
  format: string,
  dists: { overall: DistBuckets; byFormat: Record<string, DistBuckets> },
): Record<RateKey, number[]> {
  const fmt = dists.byFormat[format];
  const out = {} as Record<RateKey, number[]>;
  for (const key of Object.keys(IG_RATE_WEIGHTS) as RateKey[]) {
    const f = fmt?.[key] ?? [];
    out[key] = f.length >= MIN_SAMPLE ? f : (dists.overall[key] ?? []);
  }
  return out;
}

/** Tier a post's `saved` metric against its client's baseline (for that format). */
export function tierForPost(
  saved: number | null,
  baseline: Quartiles | null,
): ReturnType<typeof performanceTier> {
  return performanceTier(saved, baseline);
}

// ---- workflows & ideas -------------------------------------------------------

export async function listWorkflows(
  d: Deps,
  args: { client_id?: number; status?: string },
): Promise<any[]> {
  let q = d.db
    .from("workflows")
    .select("id, cliente_id, titulo, status, etapa_atual, created_via, created_at")
    .eq("conta_id", d.ctx.conta_id);
  if (args.client_id !== undefined) q = q.eq("cliente_id", args.client_id);
  if (args.status) q = q.eq("status", args.status);
  const { data } = await q.order("created_at", { ascending: false });
  return data ?? [];
}

export async function listIdeas(
  d: Deps,
  args: { client_id?: number; status?: string },
): Promise<any[]> {
  let q = d.db
    .from("ideias")
    .select("id, cliente_id, titulo, descricao, status, links, created_at")
    .eq("workspace_id", d.ctx.conta_id);
  if (args.client_id !== undefined) q = q.eq("cliente_id", args.client_id);
  if (args.status) q = q.eq("status", args.status);
  const { data } = await q.order("created_at", { ascending: false });
  return data ?? [];
}

// ---- pages -------------------------------------------------------------------

export async function listPages(
  d: Deps,
  args: { client_id?: number },
): Promise<any[]> {
  let q = d.db
    .from("hub_pages")
    .select("id, cliente_id, title, content, display_order, created_at")
    .eq("conta_id", d.ctx.conta_id);
  if (args.client_id !== undefined) q = q.eq("cliente_id", args.client_id);
  const { data, error } = await q
    .order("cliente_id")
    .order("display_order")
    .order("created_at");
  if (error) throw error;
  return ((data ?? []) as any[]).map((row) => ({
    ...row,
    content: pageContentToMarkdown(row.content),
  }));
}

// ---- workflow templates ------------------------------------------------------

export async function listWorkflowTemplates(d: Deps, _args: Record<string, never>): Promise<any[]> {
  const { data: templates, error } = await d.db
    .from("workflow_templates")
    .select("id, nome, modo_prazo, etapas")
    .eq("conta_id", d.ctx.conta_id)
    .order("nome", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  const rows = (templates ?? []) as any[];
  if (rows.length === 0) return [];

  const templateIds = rows.map((t) => t.id);
  const { data: defs, error: defErr } = await d.db
    .from("template_property_definitions")
    .select("id, template_id, name, type, config, portal_visible, display_order")
    .eq("conta_id", d.ctx.conta_id)
    .in("template_id", templateIds)
    .order("display_order", { ascending: true })
    .order("id", { ascending: true });
  if (defErr) throw defErr;

  const propsByTemplate = new Map<number, any[]>();
  for (const def of (defs ?? []) as any[]) {
    const list = propsByTemplate.get(def.template_id) ?? [];
    list.push({
      id: def.id,
      name: def.name,
      type: def.type,
      config: def.config && typeof def.config === "object" && !Array.isArray(def.config) ? def.config : {},
      portal_visible: def.portal_visible,
      display_order: def.display_order,
    });
    propsByTemplate.set(def.template_id, list);
  }

  return rows.map((t) => ({
    id: t.id,
    nome: t.nome,
    modo_prazo: t.modo_prazo ?? null,
    etapas: projectTemplateEtapas(t.etapas),
    properties: propsByTemplate.get(t.id) ?? [],
  }));
}

// ---- post feedback -----------------------------------------------------------

const FEEDBACK_SCAN_CAP = 2000;

export async function listPostFeedback(
  d: Deps,
  args: { post_id?: number; client_id?: number; action?: string; since?: string; limit?: number },
): Promise<any[]> {
  const limit = Math.min(Math.max(1, args.limit ?? 25), 100);

  let wfIds: number[] | null = null;
  if (args.client_id !== undefined) {
    wfIds = await clientWorkflowIds(d, args.client_id);
    if (wfIds.length === 0) return [];
  }

  // Shared tenant + content filters, applied to BOTH post_approvals reads.
  const applyFilters = (q: any) => {
    q = q.eq("workflow_posts.conta_id", d.ctx.conta_id); // never read post_approvals by bare post_id
    if (args.post_id !== undefined) q = q.eq("post_id", args.post_id);
    if (wfIds) q = q.in("workflow_posts.workflow_id", wfIds);
    if (args.action) q = q.eq("action", args.action);
    if (args.since) q = q.gte("created_at", args.since);
    return q;
  };

  // Phase 1 — pick post ids (capped scan).
  const { data: scanData, error: scanErr } = await applyFilters(
    d.db.from("post_approvals").select("post_id, created_at, workflow_posts!inner(conta_id)"),
  ).order("created_at", { ascending: false }).limit(FEEDBACK_SCAN_CAP);
  if (scanErr) throw scanErr;
  const scanRows = (scanData ?? []) as any[];
  if (scanRows.length === FEEDBACK_SCAN_CAP) {
    console.warn(`[mcp] list_post_feedback hit SCAN_CAP=${FEEDBACK_SCAN_CAP} for conta ${d.ctx.conta_id}`);
  }
  const chosenIds = topDistinctPostIds(scanRows, limit);
  if (chosenIds.length === 0) return [];

  // Phase 2a (feedback) + 2b (timeline), in parallel.
  const feedbackP = applyFilters(
    d.db.from("post_approvals").select(
      "post_id, action, comentario, is_workspace_user, created_at, " +
      "workflow_posts!inner(workflow_id, titulo, status, conta_id)",
    ),
  ).in("post_id", chosenIds);
  const eventsP = d.db.from("post_status_events")
    .select("post_id, from_status, to_status, source, actor_name, created_at")
    .eq("conta_id", d.ctx.conta_id)
    .in("post_id", chosenIds)
    .order("created_at", { ascending: true });
  const [{ data: fbData, error: fbErr }, { data: evData, error: evErr }] = await Promise.all([feedbackP, eventsP]);
  if (fbErr) throw fbErr;
  if (evErr) throw evErr;

  // Resolve cliente_id via workflow_id -> cliente_id.
  const fbRaw = (fbData ?? []) as any[];
  const wfPresent = [...new Set(fbRaw.map((r) => r.workflow_posts.workflow_id))];
  const clienteByWf = new Map<number, number>();
  if (wfPresent.length > 0) {
    const { data: wfData, error: wfErr } = await d.db
      .from("workflows").select("id, cliente_id")
      .eq("conta_id", d.ctx.conta_id).in("id", wfPresent);
    if (wfErr) throw wfErr;
    for (const w of (wfData ?? []) as any[]) clienteByWf.set(w.id, w.cliente_id);
  }

  const feedbackRows: FeedbackRow[] = [];
  for (const r of fbRaw) {
    const wfId = r.workflow_posts.workflow_id;
    const cliente_id = clienteByWf.get(wfId);
    if (cliente_id === undefined) {
      console.warn(`[mcp] list_post_feedback: workflow ${wfId} missing cliente_id (conta ${d.ctx.conta_id}); dropping row`);
      continue;
    }
    feedbackRows.push({
      post_id: r.post_id,
      titulo: r.workflow_posts.titulo,
      status: r.workflow_posts.status,
      cliente_id,
      action: r.action,
      comentario: r.comentario ?? null,
      is_workspace_user: r.is_workspace_user,
      created_at: r.created_at,
    });
  }

  const statusEvents: StatusEventRow[] = ((evData ?? []) as any[]).map((e) => ({
    post_id: e.post_id,
    from_status: e.from_status ?? null,
    to_status: e.to_status,
    source: e.source,
    actor_name: e.actor_name ?? null,
    created_at: e.created_at,
  }));

  return buildPostFeedback(feedbackRows, statusEvents);
}

// ---- writes ------------------------------------------------------------------

async function verifyActiveWorkflow(d: Deps, workflowId: number): Promise<any | null> {
  const { data } = await d.db
    .from("workflows")
    .select("id")
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", workflowId)
    .eq("status", "ativo")
    .maybeSingle();
  return data ?? null;
}

function defaultEtapa(now: string) {
  return {
    ordem: 0, nome: "Conteúdo", prazo_dias: 0, tipo_prazo: "corridos", tipo: "padrao",
    status: "ativo", iniciado_em: now, responsavel_id: null, concluido_em: null, data_limite: null,
  };
}

export async function createWorkflow(
  d: Deps,
  args: { client_id: number; titulo: string; template_id?: number },
): Promise<any> {
  const client = await verifyClient(d, args.client_id);
  if (!client) throw new McpInputError("Cliente não encontrado neste workspace.");

  // Optional template (tenant-scoped); DB error re-thrown before the not-found check.
  let template: any = null;
  if (args.template_id !== undefined) {
    const { data, error } = await d.db
      .from("workflow_templates")
      .select("id, etapas")
      .eq("conta_id", d.ctx.conta_id)
      .eq("id", args.template_id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new McpInputError("Modelo (template) não encontrado neste workspace.");
    template = data;
  }

  const { data: wf, error: wfErr } = await d.db
    .from("workflows")
    .insert({
      conta_id: d.ctx.conta_id,
      user_id: d.ctx.created_by,
      cliente_id: args.client_id,
      titulo: args.titulo,
      status: "ativo",
      etapa_atual: 0,
      recorrente: false,
      modo_prazo: "padrao",
      created_via: "agent",
      template_id: args.template_id ?? null,
    })
    .select("id, cliente_id, titulo, status, etapa_atual, template_id, created_via, created_at")
    .single();
  if (wfErr) throw wfErr;

  const now = d.now?.() ?? new Date().toISOString();
  const base = template ? instantiateTemplateEtapas(template.etapas, now) : [];
  const source = base.length > 0 ? base : [defaultEtapa(now)];
  const rows = source.map((e) => ({ ...e, workflow_id: wf.id }));
  const { error: etErr } = await d.db.from("workflow_etapas").insert(rows);
  if (etErr) {
    // Compensating cleanup: a zero-etapa fluxo renders broken on the board.
    await d.db.from("workflows").delete().eq("conta_id", d.ctx.conta_id).eq("id", wf.id);
    throw etErr;
  }
  return wf;
}

export async function createPost(
  d: Deps,
  args: { workflow_id: number; titulo: string; tipo?: string; body?: string; ig_caption?: string },
): Promise<any> {
  const wf = await verifyActiveWorkflow(d, args.workflow_id);
  if (!wf) throw new McpInputError("Fluxo não encontrado, ou inativo, neste workspace.");

  const { data: last } = await d.db
    .from("workflow_posts")
    .select("ordem")
    .eq("conta_id", d.ctx.conta_id)
    .eq("workflow_id", args.workflow_id)
    .order("ordem", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ordem = ((last?.ordem as number | undefined) ?? -1) + 1;

  const { data: post, error } = await d.db
    .from("workflow_posts")
    .insert({
      workflow_id: args.workflow_id,
      conta_id: d.ctx.conta_id,
      titulo: args.titulo,
      tipo: args.tipo ?? "feed",
      conteudo: buildTiptapDoc(args.body),
      conteudo_plain: args.body ?? "",
      ig_caption: args.ig_caption ?? null,
      ordem,
      status: "rascunho",
      created_via: "agent",
    })
    .select("id, workflow_id, titulo, tipo, status, ig_caption, created_via, created_at")
    .single();
  if (error) throw error;
  return post;
}

const EDITABLE_STATUSES: string[] = ["rascunho", "revisao_interna", "correcao_cliente"];
const AGENT_SETTABLE_STATUSES: string[] = ["rascunho", "revisao_interna"];

export async function updatePost(
  d: Deps,
  args: { post_id: number; titulo?: string; tipo?: string; body?: string; ig_caption?: string; status?: string },
): Promise<any> {
  // At least one updatable field.
  const FIELDS = ["titulo", "tipo", "body", "ig_caption", "status"];
  if (!FIELDS.some((f) => Object.hasOwn(args, f))) {
    throw new McpInputError("Informe ao menos um campo para atualizar.");
  }

  // Defensive destination-status validation (the zod enum is the first line; this guards
  // any caller that bypasses it, e.g. tests).
  if (Object.hasOwn(args, "status") && !AGENT_SETTABLE_STATUSES.includes(args.status as string)) {
    throw new McpInputError("Status inválido para edição pelo agente.");
  }

  // Prefetch for granular errors (distinguish not-found from not-editable).
  const { data: existing } = await d.db
    .from("workflow_posts")
    .select("id, status")
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", args.post_id)
    .maybeSingle();
  if (!existing) {
    throw new McpInputError("Post não encontrado neste workspace.");
  }
  const currentStatus = (existing as any).status as string;
  if (!EDITABLE_STATUSES.includes(currentStatus)) {
    throw new McpInputError(`Post em estado '${currentStatus}' não pode ser editado pelo agente.`);
  }

  // Build payload with presence checks so "" clears (never ignored).
  const payload: Record<string, unknown> = {};
  if (Object.hasOwn(args, "titulo")) payload.titulo = args.titulo;
  if (Object.hasOwn(args, "tipo")) payload.tipo = args.tipo;
  if (Object.hasOwn(args, "body")) {
    payload.conteudo = buildTiptapDoc(args.body); // "" -> valid empty doc
    payload.conteudo_plain = args.body ?? "";
  }
  if (Object.hasOwn(args, "ig_caption")) payload.ig_caption = args.ig_caption;
  if (Object.hasOwn(args, "status")) payload.status = args.status;

  // correcao_cliente is live in the client portal — an edit with no explicit status
  // must pull the post out of the client's view.
  if (currentStatus === "correcao_cliente" && !Object.hasOwn(args, "status")) {
    payload.status = "revisao_interna";
  }

  // Atomic guarded update: re-check tenant + editability so a status race between
  // the prefetch and the write cannot slip a now-client-facing post through.
  const { data, error } = await d.db
    .from("workflow_posts")
    .update(payload)
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", args.post_id)
    .in("status", EDITABLE_STATUSES)
    .select("id, workflow_id, titulo, tipo, status, ig_caption, created_via, updated_at")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new McpInputError("Post não pôde ser atualizado (estado alterado). Tente novamente.");
  }
  return data;
}

const OPTION_TYPES = ["select", "status", "multiselect"];

export async function setPostProperty(
  d: Deps,
  args: { post_id: number; property_id: number; value: unknown },
): Promise<{ post_id: number; property_id: number; value: unknown; status: string }> {
  // 1. Fetch post + its template (tenant-scoped, + embedded workflow tenant check).
  const { data: post, error: postErr } = await d.db
    .from("workflow_posts")
    .select("id, status, workflow_id, workflows!inner(template_id, conta_id)")
    .eq("conta_id", d.ctx.conta_id)
    .eq("workflows.conta_id", d.ctx.conta_id)
    .eq("id", args.post_id)
    .maybeSingle();
  if (postErr) throw postErr;
  if (!post) throw new McpInputError("Post não encontrado neste workspace.");
  const p = post as any;
  if (!EDITABLE_STATUSES.includes(p.status)) {
    throw new McpInputError(`Post em estado '${p.status}' não pode ser editado pelo agente.`);
  }
  const templateId = p.workflows?.template_id ?? null;
  if (templateId === null) {
    throw new McpInputError("O fluxo deste post não usa um modelo, então não há propriedades para definir.");
  }

  // 2. Fetch the definition + verify it belongs to the post's template.
  const { data: def, error: defErr } = await d.db
    .from("template_property_definitions")
    .select("id, template_id, name, type, config")
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", args.property_id)
    .maybeSingle();
  if (defErr) throw defErr;
  if (!def) throw new McpInputError("Propriedade não encontrada neste workspace.");
  const dfn = def as any;
  if (dfn.template_id !== templateId) {
    throw new McpInputError("Esta propriedade não pertence ao modelo do fluxo deste post.");
  }

  // 3. Build allowed option ids (only for option types).
  const allowed = new Set(extractTemplateOptionIds(dfn.config));
  if (OPTION_TYPES.includes(dfn.type)) {
    const { data: wso, error: wsoErr } = await d.db
      .from("workflow_select_options")
      .select("option_id")
      .eq("conta_id", d.ctx.conta_id)
      .eq("workflow_id", p.workflow_id)
      .eq("property_definition_id", args.property_id);
    if (wsoErr) throw wsoErr;
    for (const o of (wso ?? []) as any[]) allowed.add(o.option_id);
  }

  // 4. Validate the value against the definition type.
  const verr = validatePropertyValue(dfn.type, args.value, allowed);
  if (verr) throw new McpInputError(verr);

  // 5. Write — status-first for correcao_cliente (pull out of client view), then upsert.
  let status = p.status as string;
  if (status === "correcao_cliente") {
    const { data: moved, error: moveErr } = await d.db
      .from("workflow_posts")
      .update({ status: "revisao_interna" })
      .eq("conta_id", d.ctx.conta_id)
      .eq("id", args.post_id)
      .eq("status", "correcao_cliente")
      .select("id")
      .maybeSingle();
    if (moveErr) throw moveErr;
    if (!moved) throw new McpInputError("O status do post mudou; tente novamente.");
    status = "revisao_interna";
  }

  const { error: upErr } = await d.db
    .from("post_property_values")
    .upsert(
      {
        post_id: args.post_id,
        property_definition_id: args.property_id,
        value: args.value,
        updated_at: d.now?.() ?? new Date().toISOString(),
      },
      { onConflict: "post_id,property_definition_id" },
    );
  if (upErr) throw upErr;

  return { post_id: args.post_id, property_id: args.property_id, value: args.value, status };
}

export async function createWorkflowTemplate(
  d: Deps,
  args: {
    nome: string;
    modo_prazo?: string;
    etapas: Array<{ nome: string; prazo_dias?: number; tipo_prazo?: string; tipo?: string }>;
    properties?: Array<{ name: string; type: string; portal_visible?: boolean; options?: string[] }>;
  },
): Promise<any> {
  const etapas = normalizeTemplateEtapas(args.etapas);

  let defs: { name: string; type: string; config: Record<string, unknown>; portal_visible: boolean; display_order: number }[] = [];
  if (args.properties && args.properties.length > 0) {
    const genId = d.genId ?? (() => crypto.randomUUID());
    const built = buildPropertyDefinitions(args.properties, genId);
    if ("error" in built) throw new McpInputError(built.error);
    defs = built.defs;
  }

  const { data: tpl, error: tErr } = await d.db
    .from("workflow_templates")
    .insert({
      conta_id: d.ctx.conta_id,
      user_id: d.ctx.created_by,
      nome: args.nome,
      etapas,
      modo_prazo: args.modo_prazo ?? "padrao",
    })
    .select("id, nome, modo_prazo")
    .single();
  if (tErr) {
    if (isPlanLimitExceeded(tErr, "max_workflow_templates")) {
      throw new McpInputError("Limite de modelos (templates) do plano foi atingido.");
    }
    throw tErr;
  }

  let properties: any[] = [];
  if (defs.length > 0) {
    const rows = defs.map((p) => ({ ...p, template_id: tpl.id, conta_id: d.ctx.conta_id }));
    const { data: inserted, error: pErr } = await d.db
      .from("template_property_definitions")
      .insert(rows)
      .select("id, name, type, config, portal_visible, display_order");
    if (pErr) {
      // Best-effort compensating cleanup — must NOT mask the original insert error.
      try {
        await d.db.from("workflow_templates").delete().eq("id", tpl.id).eq("conta_id", d.ctx.conta_id);
      } catch (_) { /* swallow: the original pErr is the response */ }
      if (isPlanLimitExceeded(pErr, "max_custom_properties_per_template")) {
        throw new McpInputError("Limite de propriedades personalizadas do plano foi atingido.");
      }
      throw pErr;
    }
    properties = ((inserted ?? []) as any[]).sort((a, b) => a.display_order - b.display_order);
  }

  return { id: tpl.id, nome: tpl.nome, modo_prazo: tpl.modo_prazo ?? null, etapas, properties };
}
