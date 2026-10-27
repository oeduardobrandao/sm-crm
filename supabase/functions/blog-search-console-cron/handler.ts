/**
 * blog-search-console-cron: sync diário do Search Console do blog (deploy com --no-verify-jwt,
 * autentica por x-cron-secret). Três etapas, nesta ordem:
 *   1. refresh: reconsulta os últimos 10 dias e troca a janela em blog_search_daily;
 *   2. backfill: até 4 janelas de 30 dias para trás, um cursor em blog_search_state;
 *   3. inspeção: URL Inspection de até 150 posts, gravada em blog_index_status.
 * Falha de token ou do refresh derruba a execução; falha de uma janela de backfill ou de uma
 * URL é logada e pulada. Nunca logamos nem devolvemos token, chave ou corpo de resposta do
 * Google: só a etapa e o status HTTP.
 *
 * Spec: docs/superpowers/specs/2026-10-27-blog-metrics-design.md (seção 4, "Cron")
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { liveBlogSlugs } from "../_shared/blog-live.ts";
import { chunk } from "../_shared/paginate.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import {
  aggregateRows,
  backfillChunks,
  backfillHorizon,
  type GscRow,
  INDEX_LINK_RE,
  pickInspectionTargets,
  refreshWindow,
} from "./logic.ts";

export interface BlogSearchConsoleDeps {
  db: SupabaseClient;
  cronSecret: string;
  /** null when GSC_SERVICE_ACCOUNT_JSON is unset: the cron then skips without touching anything. */
  getToken: (() => Promise<string>) | null;
  fetch: typeof fetch;
  now: () => Date;
  siteUrl: string;
  /** Defaults to reportCronFailure on `db`; injectable so tests never send mail. */
  reportFailure?: (message: string) => Promise<void>;
  /**
   * Soft wall-clock budget, measured with `now()` from the start of the handler. Edge isolates
   * are killed (150 s idle, 400 s wall), which skips the catch below and leaves the run row
   * unfinished, so the backfill and inspection loops stop on their own first. Default 100 s.
   */
  deadlineMs?: number;
}

const CRON_NAME = "blog-search-console-cron";
const GOOGLE_API = "https://searchconsole.googleapis.com";
const CANONICAL_BASE = "https://www.mesaas.com.br/blog";
const GOOGLE_TIMEOUT_MS = 15_000;
const DEFAULT_DEADLINE_MS = 100_000;
const SLUG_IN_CHUNK = 100; // keeps the `.in("slug", ...)` request URL short
const PAGE_SIZE = 25_000;
const MAX_PAGES = 20; // 500k rows: a runaway pager must not loop forever
const JSON_HEADERS = { "Content-Type": "application/json" };

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

function isGscRow(r: unknown): r is GscRow {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return (
    Array.isArray(o.keys) &&
    o.keys.length === 2 &&
    typeof o.keys[0] === "string" &&
    typeof o.keys[1] === "string" &&
    Number.isFinite(o.clicks) &&
    Number.isFinite(o.impressions) &&
    Number.isFinite(o.position)
  );
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function createBlogSearchConsoleHandler(deps: BlogSearchConsoleDeps) {
  const { db } = deps;
  const reportFailure = deps.reportFailure ??
    ((message: string) => reportCronFailure(db, CRON_NAME, { stack: message }));

  const deadlineMs = deps.deadlineMs ?? DEFAULT_DEADLINE_MS;
  let startedAt = 0;
  const overDeadline = () => deps.now().getTime() - startedAt > deadlineMs;

  async function googlePost(token: string, step: string, url: string, body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await deps.fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
      });
    } catch {
      throw new Error(`${step} failed: network`);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`${step} failed: ${res.status}`);
    }
    try {
      return await res.json();
    } catch {
      throw new Error(`${step} failed: bad response`);
    }
  }

  async function querySearchAnalytics(token: string, from: string, to: string): Promise<GscRow[]> {
    const url = `${GOOGLE_API}/webmasters/v3/sites/${encodeURIComponent(deps.siteUrl)}/searchAnalytics/query`;
    const rows: GscRow[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await googlePost(token, "search analytics query", url, {
        startDate: from,
        endDate: to,
        dimensions: ["date", "page"],
        dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "contains", expression: "/blog/" }] }],
        rowLimit: PAGE_SIZE,
        startRow: page * PAGE_SIZE,
      });
      const batch = (data as { rows?: unknown } | null)?.rows;
      const list = Array.isArray(batch) ? batch : [];
      rows.push(...list.filter(isGscRow));
      if (list.length < PAGE_SIZE) return rows;
    }
    throw new Error("search analytics query failed: too many pages");
  }

  async function replaceWindow(token: string, from: string, to: string): Promise<number> {
    const rows = aggregateRows(await querySearchAnalytics(token, from, to));
    const { error } = await db.rpc("blog_search_replace", { p_from: from, p_to: to, p_rows: rows });
    if (error) throw new Error(`blog_search_replace failed: ${error.message ?? "unknown"}`);
    return rows.length;
  }

  /** Never throws: a backfill problem must not fail the run the refresh already made good. */
  async function backfill(token: string, fallbackCursor: string): Promise<{ done: number; stopped: boolean }> {
    let done = 0;
    let stopped = false;
    try {
      const { data, error } = await db.from("blog_search_state").select("backfill_before").eq("id", 1).maybeSingle();
      if (error) throw new Error(`read cursor failed: ${error.message ?? "unknown"}`);
      const cursor = (data as { backfill_before: string | null } | null)?.backfill_before ?? fallbackCursor;
      const chunks = backfillChunks(cursor, backfillHorizon(deps.now()));
      for (const [i, c] of chunks.entries()) {
        if (overDeadline()) {
          stopped = true;
          console.log(`${CRON_NAME}: deadline reached, backfill skipped ${chunks.length - i} chunk(s)`);
          break;
        }
        await replaceWindow(token, c.from, c.to);
        const { error: updError } = await db
          .from("blog_search_state")
          .update({ backfill_before: c.from })
          .eq("id", 1);
        // The window is already replaced and replacing is idempotent, so a cursor that did not
        // move only costs the next run a repeat of this chunk.
        if (updError) throw new Error(`save cursor failed: ${updError.message ?? "unknown"}`);
        done++;
      }
    } catch (e) {
      console.error(`${CRON_NAME}: backfill stopped:`, e instanceof Error ? e.message : "unknown");
    }
    return { done, stopped };
  }

  /** Never throws: a failed candidate load only skips inspection, the data above is already saved. */
  async function inspectAll(token: string): Promise<{ inspected: number; stopped: boolean }> {
    let targets: string[];
    try {
      // PostgREST caps a plain select at 1000 rows by default; fine for this blog's size.
      const live = await liveBlogSlugs(db);
      const checked: Record<string, string> = {};
      for (const slugs of chunk(live.map((p) => p.slug), SLUG_IN_CHUNK)) {
        const { data, error } = await db.from("blog_index_status").select("slug, checked_at").in("slug", slugs);
        if (error) throw new Error(`read index status failed: ${error.message ?? "unknown"}`);
        for (const r of (data ?? []) as Array<{ slug: string; checked_at: string }>) checked[r.slug] = r.checked_at;
      }
      targets = pickInspectionTargets(live, checked, deps.now());
    } catch (e) {
      console.error(`${CRON_NAME}: inspection candidates unavailable, skipping inspection:`, e instanceof Error ? e.message : "unknown");
      return { inspected: 0, stopped: false };
    }

    let inspected = 0;
    let stopped = false;
    for (const [i, slug] of targets.entries()) {
      if (overDeadline()) {
        stopped = true;
        console.log(`${CRON_NAME}: deadline reached, inspection skipped ${targets.length - i} URL(s)`);
        break;
      }
      try {
        const body = await googlePost(token, "url inspection", `${GOOGLE_API}/v1/urlInspection/index:inspect`, {
          inspectionUrl: `${CANONICAL_BASE}/${slug}`,
          siteUrl: deps.siteUrl,
        });
        const result = (body as { inspectionResult?: Record<string, unknown> } | null)?.inspectionResult;
        if (!result || typeof result !== "object") throw new Error("url inspection failed: bad response");
        const idx = (result.indexStatusResult ?? {}) as Record<string, unknown>;
        const link = str(result.inspectionResultLink);
        const crawl = str(idx.lastCrawlTime);
        const { error: upsertError } = await db.from("blog_index_status").upsert({
          slug,
          verdict: str(idx.verdict),
          coverage_state: str(idx.coverageState),
          last_crawl_time: crawl && !Number.isNaN(Date.parse(crawl)) ? crawl : null,
          google_canonical: str(idx.googleCanonical),
          inspection_link: link && INDEX_LINK_RE.test(link) ? link : null,
          checked_at: deps.now().toISOString(),
        }, { onConflict: "slug" });
        if (upsertError) throw new Error(`save index status failed: ${upsertError.message ?? "unknown"}`);
        inspected++;
      } catch (e) {
        console.error(`${CRON_NAME}: inspection skipped for ${slug}:`, e instanceof Error ? e.message : "unknown");
      }
    }
    return { inspected, stopped };
  }

  return async function handler(req: Request): Promise<Response> {
    if (!timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return json({ error: "Unauthorized" }, 401);
    }
    if (!deps.getToken) {
      console.log(`${CRON_NAME}: GSC_SERVICE_ACCOUNT_JSON is not set, skipping`);
      return json({ skipped: "not_configured" }, 200);
    }

    startedAt = deps.now().getTime();
    let runId: number | null = null;
    try {
      const { data, error } = await db.from("blog_search_runs").insert({}).select("id").single();
      if (error || !data) throw new Error(`start run failed: ${error?.message ?? "no row"}`);
      runId = (data as { id: number }).id;

      const token = await deps.getToken();
      const window = refreshWindow(deps.now());
      const refreshed = await replaceWindow(token, window.from, window.to);
      const backfilled = await backfill(token, window.from);
      const inspection = await inspectAll(token);

      const { error: finishError } = await db
        .from("blog_search_runs")
        .update({ ok: true, finished_at: deps.now().toISOString() })
        .eq("id", runId);
      if (finishError) console.error(`${CRON_NAME}: could not close run ${runId}`);
      return json({
        success: true,
        refreshed,
        backfilled: backfilled.done,
        backfill_stopped: backfilled.stopped,
        inspected: inspection.inspected,
        inspection_stopped: inspection.stopped,
      }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      console.error(`${CRON_NAME} failed:`, message);
      if (runId !== null) {
        const { error: closeError } = await db
          .from("blog_search_runs")
          .update({ ok: false, finished_at: deps.now().toISOString(), error: message })
          .eq("id", runId);
        if (closeError) console.error(`${CRON_NAME}: could not close run ${runId}`);
      }
      await reportFailure(message);
      return json({ error: "Internal server error" }, 500);
    }
  };
}
