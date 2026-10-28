// Layout padrão do sistema: reproduz a ordem do relatório A4 atual (spec §7).
// Quem não editar nada recebe um relatório equivalente ao de hoje.
// Plataformas (spec 2026-10-28 §B3): uma seção por plataforma escolhida, o Instagram na ordem
// de sempre e o TikTok depois dele, antes de "Próximos passos".
import type { BlockSize, BlockType, ReportBlock, ReportLayout } from "./layout.ts";
import { LAYOUT_VERSION } from "./layout.ts";

export type DefaultLayoutPlatform = "instagram" | "tiktok";

export interface DefaultLayoutOpts {
  hasAi: boolean;
  hasAudience: boolean;
  hasBestTimes: boolean;
  hasTags: boolean;
  /** Plataformas do relatório. Ausente = só Instagram (o modelo "Padrão do sistema" do CRM). */
  platforms?: readonly DefaultLayoutPlatform[];
  /** snapshot.tiktok.best_times não vazio. Ausente = false. */
  hasTikTokBestTimes?: boolean;
  makeId?: () => string;
}

export function buildDefaultLayout(opts: DefaultLayoutOpts): ReportLayout {
  const makeId = opts.makeId ?? (() => crypto.randomUUID());
  const blocks: ReportBlock[] = [];
  const add: AddBlock = (type, size, config) => {
    blocks.push(config ? { id: makeId(), type, size, config } : { id: makeId(), type, size });
  };

  const platforms = opts.platforms ?? ["instagram"];

  add("cover", "full");
  add("ai_summary", "full");

  if (platforms.includes("instagram")) addInstagramSection(add, opts);
  if (platforms.includes("tiktok")) {
    add("section_header", "full", { title: "TikTok" });
    add("tiktok_kpi_followers_gained", "third");
    add("tiktok_kpi_followers_total", "third");
    add("tiktok_kpi_engagement_rate", "third");
    add("tiktok_kpi_views", "third");
    add("tiktok_kpi_likes", "third");
    add("tiktok_kpi_posts_count", "third");
    add("tiktok_chart_followers", "full");
    add("tiktok_top_posts", "full", { count: 6 });
    if (opts.hasTikTokBestTimes) add("tiktok_chart_best_times", "full");
  }

  if (opts.hasAi) {
    add("section_header", "full", { title: "Próximos passos" });
    add("ai_recommendations", "full");
    add("ai_goals", "full");
  }

  return { version: LAYOUT_VERSION, blocks };
}

type AddBlock = (type: BlockType, size: BlockSize, config?: Record<string, unknown>) => void;

function addInstagramSection(add: AddBlock, opts: DefaultLayoutOpts): void {
  add("section_header", "full", { title: "Métricas principais" });
  add("kpi_followers_gained", "third");
  add("kpi_followers_total", "third");
  add("kpi_engagement_rate", "third");
  add("kpi_reach", "third");
  add("kpi_saves", "third");
  add("kpi_posts_count", "third");

  add("section_header", "full", { title: "Crescimento e formatos" });
  add("chart_followers", "full");
  add("chart_formats", "full");
  // Três terços equilibrados: views entrou (2026-08) e as duas metades viraram
  // terços para a linha fechar.
  add("kpi_views", "third");
  add("kpi_profile_views", "third");
  add("kpi_website_clicks", "third");

  add("section_header", "full", { title: "Publicações" });
  add("top_posts", "full", { count: 6 });
  if (opts.hasTags) add("tags_table", "full");

  if (opts.hasAudience) {
    add("section_header", "full", { title: "Audiência" });
    add("audience_gender", "half");
    add("audience_age", "half");
    add("audience_cities", "half");
    add("audience_countries", "half");
  }
  if (opts.hasBestTimes) add("chart_best_times", "full");
}
