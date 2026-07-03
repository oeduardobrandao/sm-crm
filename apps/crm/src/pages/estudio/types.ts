// Re-exports the shared design-doc schema (docs/estudio-design.md §6.1) so the rest of the
// editor imports from a local, feature-scoped path rather than reaching across the
// `@mesaas/design-doc` cross-runtime alias directly everywhere.
export type {
  AspectRatio,
  DesignDoc,
  DesignFormat,
  DesignIssue,
  DesignWarning,
  FontWeight,
  NormalizedFill,
  NormalizedFillGradient,
  NormalizedFillImage,
  NormalizedFillSolid,
  NormalizedImageLayer,
  NormalizedLayer,
  NormalizedPage,
  NormalizedRun,
  NormalizedShapeLayer,
  NormalizedSolidOrGradient,
  NormalizedTextLayer,
} from '@mesaas/design-doc';
export { FORMAT_TO_TIPO, FORMATS, ASPECT_RATIOS, generateDesignId } from '@mesaas/design-doc';
