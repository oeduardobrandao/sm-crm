// Plataformas num modelo do workspace (spec 2026-10-28 §B1, rulings do review da Task B3). Na
// geração: os blocos das plataformas desmarcadas saem, um título que o filtro deixou sem nada
// sai junto, e cada plataforma escolhida (com dados) que o modelo não cobre ganha a seção
// padrão dela. Os modelos são semeados só com Instagram, então sem isso um relatório só TikTok
// a partir do modelo padrão sairia vazio. O que o modelo já cobre nunca é reescrito.
import {
  NEXT_STEPS_TITLE, platformSectionBlocks, type PlatformSectionOpts,
} from "./default-layout.ts";
import { blockPlatform, MAX_BLOCKS, type ReportBlock, type ReportLayout } from "./layout.ts";

export type LayoutPlatform = "instagram" | "tiktok";

// Estrutura que sozinha não faz uma seção: um título seguido só disto ficou órfão.
const STRUCTURE_ONLY: readonly string[] = ["section_header", "divider"];

export function dropUnselectedPlatformBlocks(
  layout: ReportLayout,
  platforms: readonly LayoutPlatform[],
): ReportLayout {
  const keep = (b: ReportBlock) => {
    const platform = blockPlatform(b.type);
    return platform === null || platforms.includes(platform);
  };
  const out: ReportBlock[] = [];
  const blocks = layout.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!keep(b)) continue;
    if (b.type === "section_header") {
      // Trecho do título: até o próximo título ou o fim. Sai só quando o filtro tirou algo dele
      // e não sobrou conteúdo; um título vazio que o usuário salvou assim fica.
      let end = i + 1;
      while (end < blocks.length && blocks[end].type !== "section_header") end++;
      const span = blocks.slice(i + 1, end);
      const lostSome = span.some((x) => !keep(x));
      const hasContent = span.some((x) => keep(x) && !STRUCTURE_ONLY.includes(x.type));
      if (lostSome && !hasContent) continue;
    }
    out.push(b);
  }
  return out.length === blocks.length ? { ...layout } : { ...layout, blocks: out };
}

/** Seção padrão de cada plataforma escolhida que tem dados no snapshot e nenhum bloco no
 * layout, antes do título "Próximos passos" (ou no fim). Não passa do teto de blocos. */
export function addMissingPlatformSections(
  layout: ReportLayout,
  platforms: readonly LayoutPlatform[],
  hasData: Record<LayoutPlatform, boolean>,
  opts: PlatformSectionOpts,
  makeId?: () => string,
): ReportLayout {
  const present = new Set(layout.blocks.map((b) => blockPlatform(b.type)));
  // Ordem fixa (Instagram antes do TikTok), como no layout padrão.
  const missing = (["instagram", "tiktok"] as const).filter(
    (p) => platforms.includes(p) && hasData[p] && !present.has(p),
  );
  if (missing.length === 0) return layout;
  const added = missing.flatMap((p) => platformSectionBlocks(p, opts, makeId));
  if (layout.blocks.length + added.length > MAX_BLOCKS) return layout;
  const next = layout.blocks.findIndex(
    (b) => b.type === "section_header" && b.config?.title === NEXT_STEPS_TITLE,
  );
  const at = next === -1 ? layout.blocks.length : next;
  return { ...layout, blocks: [...layout.blocks.slice(0, at), ...added, ...layout.blocks.slice(at)] };
}

/** Plataformas da narrativa: as que o layout final tem, dentro da seleção. Layout sem nenhum
 * bloco de plataforma cai na seleção. */
export function narrativePlatforms(
  layout: ReportLayout,
  selected: readonly LayoutPlatform[],
): LayoutPlatform[] {
  const inLayout = new Set(layout.blocks.map((b) => blockPlatform(b.type)));
  const both = selected.filter((p) => inLayout.has(p));
  return both.length > 0 ? both : [...selected];
}
