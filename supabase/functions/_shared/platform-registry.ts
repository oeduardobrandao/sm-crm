// Registro de plataformas: fonte única para CRM, Hub e edge functions.
// Spec: docs/superpowers/specs/2026-09-29-platform-agnostic-posts-design.md
//
// ZERO imports e nenhum global de Deno/DOM: este arquivo é lido pelo deno check
// e pelos tsc do CRM e do Hub (alias @mesaas/platforms). Estilo deno fmt.
//
// Os valores de ContentFormat são os de workflow_posts.tipo e NÃO mudam aqui;
// só os rótulos são neutros. Plataforma nova = entrada em PLATFORM_IDS +
// PLATFORM_DEFS + CHECK das colunas plataformas/post_targets.platform.

export const CONTENT_FORMATS = [
  "feed",
  "carrossel",
  "reels",
  "stories",
] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export const CONTENT_FORMAT_LABELS: Record<ContentFormat, string> = {
  feed: "Imagem",
  carrossel: "Carrossel",
  reels: "Vídeo vertical",
  stories: "Stories",
};

export const PLATFORM_IDS = ["instagram", "tiktok", "geral"] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export interface NativeFormatDef {
  /** Rótulo do formato nativo na plataforma ("Reels", "Vídeo TikTok"). */
  label: string;
  /** Limite de legenda em unidades UTF-16 (String.length); null = sem limite. */
  captionMax: number | null;
}

export interface PlatformDef {
  id: PlatformId;
  label: string;
  /** false = não publica sozinho (Geral: o conteúdo fica para download). */
  autoPublish: boolean;
  /** Flag de plano que libera a plataforma; null = sempre liberada. */
  planFeature: "feature_tiktok" | null;
  /** Limite do campo título; null = a plataforma não tem título. */
  titleMax: number | null;
  /** Formato de conteúdo → formato nativo. Formato ausente = não suportado. */
  nativeFormats: Partial<Record<ContentFormat, NativeFormatDef>>;
}

export const IG_CAPTION_MAX = 2200;

export const PLATFORM_DEFS: Record<PlatformId, PlatformDef> = {
  instagram: {
    id: "instagram",
    label: "Instagram",
    autoPublish: true,
    planFeature: null,
    titleMax: null,
    nativeFormats: {
      feed: { label: "Post", captionMax: IG_CAPTION_MAX },
      carrossel: { label: "Carrossel", captionMax: IG_CAPTION_MAX },
      reels: { label: "Reels", captionMax: IG_CAPTION_MAX },
      stories: { label: "Stories", captionMax: IG_CAPTION_MAX },
    },
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    autoPublish: true,
    planFeature: "feature_tiktok",
    titleMax: 90,
    // Espelha tiktok-publish-utils.ts: reels → vídeo; feed/carrossel → foto; sem stories.
    nativeFormats: {
      feed: { label: "Foto", captionMax: 4000 },
      carrossel: { label: "Carrossel de fotos", captionMax: 4000 },
      reels: { label: "Vídeo TikTok", captionMax: 2200 },
    },
  },
  geral: {
    id: "geral",
    label: "Geral",
    autoPublish: false,
    planFeature: null,
    titleMax: null,
    nativeFormats: {
      feed: { label: "Imagem", captionMax: null },
      carrossel: { label: "Carrossel", captionMax: null },
      reels: { label: "Vídeo vertical", captionMax: null },
      stories: { label: "Stories", captionMax: null },
    },
  },
};

/** Plataformas anunciadas na UI como "em breve" (não selecionáveis). */
export const COMING_SOON_PLATFORMS: readonly { id: string; label: string }[] = [
  { id: "youtube", label: "YouTube" },
];

export function supportsFormat(
  platform: PlatformId,
  tipo: ContentFormat,
): boolean {
  return PLATFORM_DEFS[platform].nativeFormats[tipo] !== undefined;
}

export function captionMaxFor(
  platform: PlatformId,
  tipo: ContentFormat,
): number | null {
  return PLATFORM_DEFS[platform].nativeFormats[tipo]?.captionMax ?? null;
}
