// Layout padrão do sistema: reproduz a ordem do relatório A4 atual (spec §7).
// Quem não editar nada recebe um relatório equivalente ao de hoje.
import type { BlockSize, BlockType, ReportBlock, ReportLayout } from "./layout.ts";
import { LAYOUT_VERSION } from "./layout.ts";

export interface DefaultLayoutOpts {
  hasAi: boolean;
  hasAudience: boolean;
  hasBestTimes: boolean;
  hasTags: boolean;
  makeId?: () => string;
}

export function buildDefaultLayout(opts: DefaultLayoutOpts): ReportLayout {
  const makeId = opts.makeId ?? (() => crypto.randomUUID());
  const blocks: ReportBlock[] = [];
  const add = (type: BlockType, size: BlockSize, config?: Record<string, unknown>) =>
    blocks.push(config ? { id: makeId(), type, size, config } : { id: makeId(), type, size });

  add("cover", "full");
  add("ai_summary", "full");

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
  add("kpi_profile_views", "half");
  add("kpi_website_clicks", "half");

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

  if (opts.hasAi) {
    add("section_header", "full", { title: "Próximos passos" });
    add("ai_recommendations", "full");
    add("ai_goals", "full");
  }

  return { version: LAYOUT_VERSION, blocks };
}
