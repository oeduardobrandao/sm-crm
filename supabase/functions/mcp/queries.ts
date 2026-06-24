// deno-lint-ignore-file no-explicit-any
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { signGetUrl } from "../_shared/r2.ts";
import { McpKeyContext } from "../_shared/mcp-token.ts";
import { MCP_PROP_MODO, MCP_PROP_ANOTACAO } from "./seed.ts";
import {
  allowlistClient,
  buildPostFeedback,
  CLIENT_PUBLIC_FIELDS,
  deriveFormatMeta,
  FeedbackRow,
  firstLine,
  pageContentToMarkdown,
  performanceTier,
  quartiles,
  Quartiles,
  StatusEventRow,
  topDistinctPostIds,
} from "./content.ts";

const METRIC_KEYS = ["reach", "saved", "shares", "comments", "likes"] as const;
type MetricKey = (typeof METRIC_KEYS)[number];
export type Metrics = Record<MetricKey, number>;

export interface Deps {
  db: SupabaseClient;
  ctx: McpKeyContext;
  signUrl?: (key: string) => Promise<string>;
  now?: () => string;
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
): Promise<{ byMediaId: Map<string, Metrics>; byPermalink: Map<string, Metrics> }> {
  const mediaIds = posts.map((p) => p.instagram_media_id).filter((x): x is string => !!x);
  const permalinks = posts.map((p) => p.instagram_permalink).filter((x): x is string => !!x);
  const byMediaId = new Map<string, Metrics>();
  const byPermalink = new Map<string, Metrics>();
  if (mediaIds.length === 0 && permalinks.length === 0) return { byMediaId, byPermalink };

  const cols = "instagram_post_id, permalink, reach, saved, shares, comments, likes";
  const collect = (rows: any[]) => {
    for (const r of rows ?? []) {
      const m: Metrics = {
        reach: r.reach ?? 0, saved: r.saved ?? 0, shares: r.shares ?? 0,
        comments: r.comments ?? 0, likes: r.likes ?? 0,
      };
      if (r.instagram_post_id) byMediaId.set(r.instagram_post_id, m);
      if (r.permalink) byPermalink.set(r.permalink, m);
    }
  };
  if (mediaIds.length) {
    const { data } = await d.db.from("instagram_posts").select(cols).in("instagram_post_id", mediaIds);
    collect(data ?? []);
  }
  if (permalinks.length) {
    const { data } = await d.db.from("instagram_posts").select(cols).in("permalink", permalinks);
    collect(data ?? []);
  }
  return { byMediaId, byPermalink };
}

function metricsFor(
  post: { instagram_media_id: string | null; instagram_permalink: string | null },
  maps: { byMediaId: Map<string, Metrics>; byPermalink: Map<string, Metrics> },
): Metrics | null {
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
  "id, workflow_id, titulo, tipo, status, ig_caption, conteudo_plain, " +
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
    const metrics = metricsFor(p, metricMaps);
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
      metrics,
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
    metrics: metricsFor(p, metricMaps),
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
    .select("id, cliente_id, titulo, status, etapa_atual, created_at")
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
