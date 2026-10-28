// Reexporta os tipos da fonte da verdade (_shared, TS puro). Import relativo
// cru é o precedente da casa: ReportPreview.tsx:1.
export type {
  BlockSize,
  BlockType,
  ReportBlock,
  ReportLayout,
  ValidateLayoutResult,
  ReportThemeId,
  ReportFontId,
  ImageRatio,
  ImageFit,
} from '../../supabase/functions/_shared/report-docs/layout';
export {
  BLOCK_TYPES,
  TEXT_BLOCK_TYPES,
  TIKTOK_BLOCK_PREFIX,
  blockPlatform,
  validateLayout,
  normalizeCoverSize,
  REPORT_THEME_IDS,
  REPORT_FONT_IDS,
  IMAGE_RATIOS,
  IMAGE_FITS,
  IMAGE_FOCAL_STEPS,
  IMAGE_CAPTION_MAX,
  IMAGE_ALT_MAX,
  sanitizeLayoutForTemplate,
  MAX_BLOCKS,
  MAX_SECTIONS,
  SECTION_TITLE_MAX,
  SECTION_PLATFORMS,
  isValidSectionTitle,
} from '../../supabase/functions/_shared/report-docs/layout';
export type {
  ReportSection,
  SectionKind,
  SectionPlatform,
} from '../../supabase/functions/_shared/report-docs/sections';
export {
  contentBlockCount,
  fromSections,
  isSectioned,
  isSectionMarker,
  makeSectionMarker,
  sectionizeLayout,
  sectionKindOf,
  sectionOfBlock,
  sectionPlatforms,
  toSections,
} from '../../supabase/functions/_shared/report-docs/sections';
export type {
  ReportDocSnapshot,
  SnapshotBranding,
  SnapshotContentBreakdown,
  SnapshotFormatStats,
  SnapshotHubTheme,
  SnapshotTopPost,
  TikTokReportSnapshot,
  TikTokSnapshotTopPost,
} from '../../supabase/functions/_shared/report-docs/snapshot';
export type { KpiEntry, ReportKpiId } from '../../supabase/functions/_shared/report-docs/kpis';
export { KPI_LABELS_PT } from '../../supabase/functions/_shared/report-docs/kpis';
export type { TikTokKpiId } from '../../supabase/functions/_shared/tiktok-analytics/kpis';
export { TIKTOK_KPI_IDS } from '../../supabase/functions/_shared/tiktok-analytics/kpis';
