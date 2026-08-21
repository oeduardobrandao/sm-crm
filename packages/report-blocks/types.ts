// Reexporta os tipos da fonte da verdade (_shared, TS puro). Import relativo
// cru é o precedente da casa: ReportPreview.tsx:1.
export type {
  BlockSize,
  BlockType,
  ReportBlock,
  ReportLayout,
} from '../../supabase/functions/_shared/report-docs/layout';
export { BLOCK_TYPES, TEXT_BLOCK_TYPES } from '../../supabase/functions/_shared/report-docs/layout';
export type {
  ReportDocSnapshot,
  SnapshotBranding,
  SnapshotTopPost,
} from '../../supabase/functions/_shared/report-docs/snapshot';
export type { KpiEntry, ReportKpiId } from '../../supabase/functions/_shared/report-docs/kpis';
