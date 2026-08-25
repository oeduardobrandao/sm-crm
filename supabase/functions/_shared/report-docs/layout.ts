// Schema do layout do relatório de blocos. TS PURO: importado pela edge
// function (Deno) E pelo pacote React (Vite/tsc) — nada de Deno.*, nada de deps.
// Spec: docs/superpowers/specs/2026-08-20-report-builder-blocks-design.md §4

export const LAYOUT_VERSION = 1;

export const BLOCK_SIZES = ["third", "half", "full"] as const;
export type BlockSize = (typeof BLOCK_SIZES)[number];

export const BLOCK_TYPES = [
  // Estrutura
  "cover", "section_header", "divider",
  // Texto & IA (todos renderizam `text` TipTap JSON)
  "text", "ai_summary", "ai_recommendations", "ai_goals",
  // Números
  "kpi_followers_gained", "kpi_followers_total", "kpi_reach", "kpi_views",
  "kpi_engagement_rate", "kpi_saves", "kpi_posts_count",
  "kpi_profile_views", "kpi_website_clicks",
  // Gráficos
  "chart_followers", "chart_formats", "chart_best_times",
  // Audiência
  "audience_gender", "audience_age", "audience_cities", "audience_countries",
  // Conteúdo
  "top_posts", "post_list", "tags_table",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const REPORT_THEME_IDS = ["clean", "editorial", "bold", "hub"] as const;
export type ReportThemeId = (typeof REPORT_THEME_IDS)[number];
export const REPORT_FONT_IDS = ["system", "fraunces", "grotesk", "playfair"] as const;
export type ReportFontId = (typeof REPORT_FONT_IDS)[number];

export const TEXT_BLOCK_TYPES: readonly BlockType[] = [
  "text", "ai_summary", "ai_recommendations", "ai_goals",
];

export const MAX_BLOCKS = 200;
export const TOP_POSTS_MIN = 1;
export const TOP_POSTS_MAX = 12;

export interface ReportBlock {
  id: string;
  type: BlockType;
  size: BlockSize;
  config?: Record<string, unknown>;
  /** JSON TipTap; permitido só em TEXT_BLOCK_TYPES. */
  text?: unknown;
}

export interface ReportLayout {
  version: number;
  /** Override opcional da cor de destaque (#rrggbb); ausente = brand_color do
   * workspace congelado no snapshot. Seletor no editor chega no PR 2; o schema
   * e o renderer já nascem prontos (decisão B do visual companion). */
  accent?: string;
  /** Tema visual. AUSENTE = modo herdado (só accent aplicado; fundo e
   * superfícies herdam da página — Hub whitelabel incluso). */
  theme?: ReportThemeId;
  /** Dupla de fontes. AUSENTE = herdar da página; "system" é escolha
   * explícita da pilha do sistema. */
  fonts?: ReportFontId;
  blocks: ReportBlock[];
}

export type ValidateLayoutResult =
  | { ok: true; layout: ReportLayout }
  | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validação estrita para ESCRITA (editor e edge function). Renderers são
 * tolerantes por conta própria (bloco desconhecido é ignorado na leitura). */
export function validateLayout(raw: unknown): ValidateLayoutResult {
  if (!isRecord(raw)) return { ok: false, error: "layout must be an object" };
  if (raw.version !== LAYOUT_VERSION) {
    return { ok: false, error: `unsupported layout version` };
  }
  if (!Array.isArray(raw.blocks)) return { ok: false, error: "blocks must be an array" };
  if (raw.blocks.length > MAX_BLOCKS) return { ok: false, error: "too many blocks" };
  if (
    raw.accent !== undefined &&
    (typeof raw.accent !== "string" || !/^#[0-9a-fA-F]{6}$/.test(raw.accent))
  ) {
    return { ok: false, error: "invalid accent" };
  }
  if (
    raw.theme !== undefined &&
    !(REPORT_THEME_IDS as readonly unknown[]).includes(raw.theme)
  ) {
    return { ok: false, error: "invalid theme" };
  }
  if (
    raw.fonts !== undefined &&
    !(REPORT_FONT_IDS as readonly unknown[]).includes(raw.fonts)
  ) {
    return { ok: false, error: "invalid fonts" };
  }

  const seen = new Set<string>();
  for (const b of raw.blocks) {
    if (!isRecord(b)) return { ok: false, error: "block must be an object" };
    if (typeof b.id !== "string" || b.id.length === 0) {
      return { ok: false, error: "block id must be a non-empty string" };
    }
    if (seen.has(b.id)) return { ok: false, error: "duplicate block id" };
    seen.add(b.id);
    if (!(BLOCK_TYPES as readonly string[]).includes(b.type as string)) {
      return { ok: false, error: `unknown block type` };
    }
    if (!(BLOCK_SIZES as readonly string[]).includes(b.size as string)) {
      return { ok: false, error: "invalid block size" };
    }
    if (b.config !== undefined && !isRecord(b.config)) {
      return { ok: false, error: "config must be an object" };
    }
    if (
      b.text !== undefined &&
      !TEXT_BLOCK_TYPES.includes(b.type as BlockType)
    ) {
      return { ok: false, error: "text is only allowed on text blocks" };
    }
    if (b.type === "top_posts" || b.type === "post_list") {
      const count = (b.config as Record<string, unknown> | undefined)?.count;
      if (count !== undefined) {
        if (
          typeof count !== "number" || !Number.isInteger(count) ||
          count < TOP_POSTS_MIN || count > TOP_POSTS_MAX
        ) {
          return { ok: false, error: "count out of bounds" };
        }
      }
    }
    if (b.type === "cover") {
      if (b.size !== "full") {
        return { ok: false, error: "cover must be full width" };
      }
      const coverCfg = b.config as Record<string, unknown> | undefined;
      if (coverCfg?.color !== undefined) {
        if (
          typeof coverCfg.color !== "string" ||
          !/^#[0-9a-fA-F]{6}$/.test(coverCfg.color)
        ) {
          return { ok: false, error: "invalid cover color" };
        }
      }
      if (coverCfg?.logoSize !== undefined) {
        const logoSize = coverCfg.logoSize;
        // Bounds espelhados em apps/crm/src/pages/relatorio-editor/layoutOps.ts
        // (COVER_LOGO_MIN/MAX) -- mudar um dos dois lados sem o outro quebra a
        // consistência entre o que o stepper produz e o que o backend aceita.
        if (
          typeof logoSize !== "number" || !Number.isInteger(logoSize) ||
          logoSize < 20 || logoSize > 68
        ) {
          return { ok: false, error: "cover logoSize out of bounds" };
        }
      }
    }
  }
  return { ok: true, layout: raw as unknown as ReportLayout };
}

/** Corrige qualquer bloco cover com size != full para full -- defesa contra um
 * layout persistido (documento OU template) que tenha ficado com um valor
 * antigo/inválido de antes desta validação existir (achado de review externo
 * 2026-08-25): sem isso, tanto o autosave do editor do CRM quanto a geração de
 * relatório a partir de um template legado ficam travados, porque
 * validateLayout rejeita o layout inteiro e não há retry para esse caso.
 * Mesma referência se nada precisar mudar. */
export function normalizeCoverSize(layout: ReportLayout): ReportLayout {
  let changed = false;
  const blocks = layout.blocks.map((b) => {
    if (b.type === "cover" && b.size !== "full") {
      changed = true;
      return { ...b, size: "full" as const };
    }
    return b;
  });
  return changed ? { ...layout, blocks } : layout;
}
