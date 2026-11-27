import i18n from 'i18next';
import type { WidgetCategory } from '@mesaas/report-blocks/catalog';
import type { ReportPlatform } from '@mesaas/report-blocks/platform';
import type { SectionKind } from '@mesaas/report-blocks/types';

// The shared report-blocks package (catalog, PLATFORM_NAMES) also feeds the PDF/print document and
// only speaks Portuguese, so the editor chrome localizes at the call site with key-based maps and
// leaves the package alone. Call these at render time, never at module load.

/** Translate a `reportEditor` key at call time (for helpers outside React components). */
export function tr(key: string, opts?: Record<string, unknown>): string {
  return i18n.t(`reportEditor:${key}`, opts);
}

const CATEGORY_KEYS: Record<WidgetCategory, string> = {
  Números: 'numbers',
  Gráficos: 'charts',
  Audiência: 'audience',
  Conteúdo: 'content',
  Texto: 'text',
  Mídia: 'media',
  Estrutura: 'structure',
};

export function widgetCategoryLabel(category: WidgetCategory): string {
  return tr(`category.${CATEGORY_KEYS[category]}`);
}

/** Catalog label of a block type, localized; an unknown type falls back to the type itself. */
export function widgetLabel(type: string): string {
  return i18n.t(`reportEditor:widget.${type}`, { defaultValue: type });
}

export function platformName(platform: ReportPlatform): string {
  return tr(`platform.${platform}`);
}

/** Default name of a section kind: the platform's, or "General". */
export function sectionKindName(kind: SectionKind): string {
  return tr(`platform.${kind}`);
}
