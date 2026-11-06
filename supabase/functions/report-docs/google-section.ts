// Seção Google Meu Negócio do data_snapshot (spec 2026-11-04-gmn-report-section). Reusa as
// leituras e as contas do _shared/gbp-analytics, então o relatório e a aba Google Meu Negócio dão
// o mesmo número para as mesmas datas: a janela é o período personalizado [dia 1, último dia] do
// mês do relatório, cortado no data_through das unidades, e o anterior é o mesmo número de dias
// logo antes (o "vs. N dias anteriores" da aba).
//
// Quem chama já provou que o cliente é do workspace (clientes.conta_id); toda leitura daqui leva
// o conta_id, porque dois workspaces podem ligar a mesma unidade (mesmo location_name).
import { lastDayOfMonth, saoPauloDate } from "../_shared/sao-paulo-date.ts";
import { fetchAllRows } from "../_shared/paginate.ts";
import {
  aggregateKeywords,
  computeGbpKpis,
  dailySeries,
  emptyGbpKpis,
  GBP_KPI_IDS,
  type GbpKpiEntry,
  type GbpKpiId,
  sumMetrics,
  surfaceBreakdown,
} from "../_shared/gbp-analytics/kpis.ts";
import {
  buildRatingDistribution,
  type GbpUnit,
  hasMetricsOnOrBefore,
  loadMetrics,
  loadRatings,
  loadUnits,
} from "../_shared/gbp-analytics/queries.ts";
import { addDays, resolveWindow, windowDataThrough } from "../_shared/gbp-analytics/window.ts";
import type { GbpReportKpiEntry, GoogleReportSnapshot } from "../_shared/report-docs/snapshot.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export const KEYWORD_ROWS = 10;
export const HIGHLIGHT_MAX_CHARS = 400;
/** Quantos meses fechados antes do mês do relatório servem de reserva para os termos de busca
 * (o Google publica os de um mês alguns dias depois que ele fecha). */
const KEYWORD_FALLBACK_MONTHS = 2;
const HIGHLIGHT_CANDIDATES = 50;
const ANONYMOUS_REVIEWER = "Cliente do Google";

/** O cliente tem alguma unidade contada (ativa ou revogada)? Sem ler histórico. */
export async function hasGoogleUnits(db: Db, contaId: string, clientId: number): Promise<boolean> {
  return (await loadUnits(db, contaId, clientId)).length > 0;
}

/** "Mariana Costa Lima" -> "Mariana L."; um nome só fica como está; vazio -> "Cliente do Google".
 * Escolha C do spec: o snapshot dura mais que o histórico do Google, então guarda o mínimo. */
export function abbreviateReviewer(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return ANONYMOUS_REVIEWER;
  if (parts.length === 1) return parts[0];
  const last = [...parts[parts.length - 1]][0].toLocaleUpperCase("pt-BR");
  return `${parts[0]} ${last}.`;
}

/** Instante UTC da meia-noite de São Paulo do dia `date` (UTC-3 fixo, sem horário de verão). */
const spMidnightIso = (date: string): string => `${date}T03:00:00.000Z`;

const toReportKpis = (kpis: Record<GbpKpiId, GbpKpiEntry>): Record<GbpKpiId, GbpReportKpiEntry> => {
  const out = {} as Record<GbpKpiId, GbpReportKpiEntry>;
  for (const id of GBP_KPI_IDS) {
    out[id] = { value: kpis[id].value, prev: kpis[id].prev, unit: id === "avg_rating" ? "rating" : "count" };
  }
  return out;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

const names = (units: GbpUnit[]) => units.map((u) => u.location_name);

/** Termos do mês do relatório; sem nenhum, os do último mês fechado antes dele (até 2). */
async function loadKeywords(
  db: Db,
  contaId: string,
  units: GbpUnit[],
  month: string,
): Promise<GoogleReportSnapshot["keywords"]> {
  const [y, m] = month.split("-").map(Number);
  const candidates = Array.from(
    { length: KEYWORD_FALLBACK_MONTHS + 1 },
    (_, i) => new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7),
  );
  for (const candidate of candidates) {
    const rows = await fetchAllRows<{ keyword: string; value: number | null; threshold: number | null }>(
      (from, to) =>
        db.from("gbp_search_keywords_monthly").select("location_name, keyword, value, threshold")
          .eq("conta_id", contaId)
          .in("location_name", names(units))
          .eq("month", `${candidate}-01`)
          .order("location_name", { ascending: true })
          .order("keyword", { ascending: true })
          .range(from, to),
    );
    if (rows.length > 0) return { month: candidate, rows: aggregateKeywords(rows).slice(0, KEYWORD_ROWS) };
  }
  return { month: null, rows: [] };
}

/** Escolha B do spec: só avaliações criadas dentro da janela; a de 5 estrelas mais recente com
 * texto, senão a de 4. */
async function loadHighlight(
  db: Db,
  contaId: string,
  units: GbpUnit[],
  start: string,
  end: string,
): Promise<GoogleReportSnapshot["highlight"]> {
  const { data, error } = await db.from("gbp_reviews")
    .select("location_name, reviewer_name, star_rating, comment, create_time")
    .eq("conta_id", contaId)
    .in("location_name", names(units))
    .in("star_rating", [4, 5])
    .not("comment", "is", null)
    .gte("create_time", spMidnightIso(start))
    .lt("create_time", spMidnightIso(addDays(end, 1)))
    .order("create_time", { ascending: false })
    .order("review_id", { ascending: true })
    .limit(HIGHLIGHT_CANDIDATES);
  if (error) throw error;
  const rows = (data ?? []) as {
    location_name: string;
    reviewer_name: string | null;
    star_rating: number;
    comment: string | null;
    create_time: string;
  }[];
  const withText = rows.filter((r) => (r.comment ?? "").trim().length > 0);
  const pick = withText.find((r) => r.star_rating === 5) ?? withText.find((r) => r.star_rating === 4);
  if (!pick) return null;
  const text = pick.comment!.trim();
  const chars = [...text];
  const comment = chars.length > HIGHLIGHT_MAX_CHARS
    ? `${chars.slice(0, HIGHLIGHT_MAX_CHARS).join("").trimEnd()}…`
    : text;
  return {
    reviewer: abbreviateReviewer(pick.reviewer_name),
    rating: pick.star_rating as 4 | 5,
    comment,
    unit_title: units.find((u) => u.location_name === pick.location_name)?.title ?? null,
    // Dia de calendário em São Paulo: quem renderiza formata sem conversão de fuso.
    date: saoPauloDate(new Date(pick.create_time)),
  };
}

export async function loadGoogleReportSection(
  db: Db,
  contaId: string,
  clientId: number,
  month: string,
  now: Date,
): Promise<GoogleReportSnapshot | null> {
  const units = await loadUnits(db, contaId, clientId);
  if (units.length === 0) return null;

  const dataThrough = windowDataThrough(units);
  const { window, hasData } = resolveWindow(
    { kind: "range", start: `${month}-01`, end: lastDayOfMonth(month) },
    dataThrough,
    now,
  );
  const unitList = units.map((u) => ({ id: u.id, title: u.title, status: u.status }));
  const unitRow = (u: GbpUnit, t: ReturnType<typeof sumMetrics> | null) => ({
    id: u.id,
    title: u.title,
    status: u.status,
    views: t?.profileViews ?? 0,
    calls: t?.calls ?? 0,
    directions: t?.directions ?? 0,
    website_clicks: t?.websiteClicks ?? 0,
    rating: num(u.average_rating),
    reviews: u.total_review_count ?? null,
  });

  if (!hasData) {
    return {
      units: unitList,
      data_through: dataThrough,
      window: null,
      kpis: toReportKpis(emptyGbpKpis()),
      surfaces: [],
      daily: [],
      keywords: { month: null, rows: [] },
      rating_distribution: null,
      highlight: null,
      unit_rows: units.map((u) => unitRow(u, null)),
    };
  }

  // Mesma ordem do buildOverview: métricas e notas juntas, depois a cobertura do anterior.
  const [metrics, ratings] = await Promise.all([
    loadMetrics(db, contaId, units, window.prevStart, window.end),
    loadRatings(db, contaId, units, window),
  ]);
  const prevCovered = await hasMetricsOnOrBefore(db, contaId, units, window.prevStart);
  const kpis = computeGbpKpis({ metrics, ratings, locationNames: names(units), window, prevCovered });

  const [distribution, keywords, highlight] = await Promise.all([
    buildRatingDistribution(db, contaId, units),
    loadKeywords(db, contaId, units, month),
    loadHighlight(db, contaId, units, window.start, window.end),
  ]);

  return {
    units: unitList,
    data_through: dataThrough,
    window,
    kpis: toReportKpis(kpis),
    surfaces: surfaceBreakdown(sumMetrics(metrics, window.start, window.end)),
    daily: dailySeries(metrics, window.start, window.end).map((p) => ({
      date: p.date,
      calls: p.calls,
      directions: p.directions,
      websiteClicks: p.websiteClicks,
      messages: p.messages,
    })),
    keywords,
    rating_distribution: distribution,
    highlight,
    unit_rows: units.map((u) =>
      unitRow(u, sumMetrics(metrics.filter((r) => r.location_name === u.location_name), window.start, window.end))
    ),
  };
}
