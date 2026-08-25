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
} from '../../supabase/functions/_shared/report-docs/layout';
export {
  BLOCK_TYPES,
  TEXT_BLOCK_TYPES,
  validateLayout,
  normalizeCoverSize,
  REPORT_THEME_IDS,
  REPORT_FONT_IDS,
} from '../../supabase/functions/_shared/report-docs/layout';
export type {
  ReportDocSnapshot,
  SnapshotBranding,
  SnapshotContentBreakdown,
  SnapshotFormatStats,
  SnapshotHubTheme,
  SnapshotTopPost,
} from '../../supabase/functions/_shared/report-docs/snapshot';
export type { KpiEntry, ReportKpiId } from '../../supabase/functions/_shared/report-docs/kpis';
export { KPI_LABELS_PT } from '../../supabase/functions/_shared/report-docs/kpis';
