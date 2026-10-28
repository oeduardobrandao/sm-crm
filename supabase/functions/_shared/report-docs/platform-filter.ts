// Filtro de plataforma de um modelo do workspace (spec 2026-10-28 §B1): na geração, os blocos
// das plataformas que o usuário desmarcou saem do layout. Blocos neutros (capa, títulos,
// texto, IA, imagem, divisor) ficam sempre, e nada mais do modelo muda.
import { blockPlatform, type ReportLayout } from "./layout.ts";

export function dropUnselectedPlatformBlocks(
  layout: ReportLayout,
  platforms: readonly ("instagram" | "tiktok")[],
): ReportLayout {
  return {
    ...layout,
    blocks: layout.blocks.filter((b) => {
      const platform = blockPlatform(b.type);
      return platform === null || platforms.includes(platform);
    }),
  };
}
