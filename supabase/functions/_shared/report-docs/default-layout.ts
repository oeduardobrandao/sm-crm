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

/** Opções que moldam a seção de uma plataforma (sem capa, resumo nem "Próximos passos"). */
export type PlatformSectionOpts = Pick<
  DefaultLayoutOpts,
  "hasAudience" | "hasBestTimes" | "hasTags" | "hasTikTokBestTimes"
>;

export const NEXT_STEPS_TITLE = "Próximos passos";

function blockAdder(blocks: ReportBlock[], makeId: () => string): AddBlock {
  return (type, size, config) => {
    blocks.push(config ? { id: makeId(), type, size, config } : { id: makeId(), type, size });
  };
}

/** Blocos da seção padrão de uma plataforma, com o título dela: os mesmos que o layout padrão
 * põe. O generate os acrescenta a um modelo do workspace que não cobre a plataforma. */
export function platformSectionBlocks(
  platform: DefaultLayoutPlatform,
  opts: PlatformSectionOpts,
  makeId: () => string = () => crypto.randomUUID(),
): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const add = blockAdder(blocks, makeId);
  if (platform === "instagram") addInstagramSection(add, opts);
  else addTikTokSection(add, opts);
  return blocks;
}

export function buildDefaultLayout(opts: DefaultLayoutOpts): ReportLayout {
  const makeId = opts.makeId ?? (() => crypto.randomUUID());
  const blocks: ReportBlock[] = [];
  const add = blockAdder(blocks, makeId);

  const platforms = opts.platforms ?? ["instagram"];

  add("cover", "full");
  add("ai_summary", "full");

  if (platforms.includes("instagram")) addInstagramSection(add, opts);
  if (platforms.includes("tiktok")) addTikTokSection(add, opts);

  if (opts.hasAi) {
    add("section_header", "full", { title: NEXT_STEPS_TITLE });
    add("ai_recommendations", "full");
    add("ai_goals", "full");
  }

  return { version: LAYOUT_VERSION, blocks };
}

type AddBlock = (type: BlockType, size: BlockSize, config?: Record<string, unknown>) => void;

function addTikTokSection(add: AddBlock, opts: PlatformSectionOpts): void {
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

function addInstagramSection(add: AddBlock, opts: PlatformSectionOpts): void {
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
