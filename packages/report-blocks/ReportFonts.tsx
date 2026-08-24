// Injeta o stylesheet do Google Fonts da dupla escolhida. React 19 iça
// <link> para o <head>; sem fonts (herdado) ou dupla sem href (system), nada
// renderiza. precedence é exigido pelo React 19 para dedup/ordenação.
import type { ReportLayout, ReportDocSnapshot } from './types';
import { resolveReportTheme } from './theme';

export function ReportFonts({
  layout,
  snapshot,
}: {
  layout: ReportLayout;
  snapshot: ReportDocSnapshot;
}) {
  const { fontHref } = resolveReportTheme(layout, snapshot);
  if (!fontHref) return null;
  return <link rel="stylesheet" href={fontHref} precedence="default" />;
}
