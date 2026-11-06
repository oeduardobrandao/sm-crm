import type { ContentFormat } from '@mesaas/platforms';
import { TIPO_BADGE_COLORS, TIPO_LABELS } from '../postLabels';

/**
 * The format badge of a linha row: label from `TIPO_LABELS`, tint and dot from
 * `TIPO_BADGE_COLORS`. The label keeps the body text color: the yellow and cyan format colors
 * are too light to read as text on their own tint.
 */
export function FormatoPill({ tipo }: { tipo: ContentFormat }) {
  const { bg, text } = TIPO_BADGE_COLORS[tipo];
  return (
    <span className="linha-formato" style={{ background: bg }}>
      <span className="linha-formato__dot" style={{ background: text }} aria-hidden="true" />
      {TIPO_LABELS[tipo]}
    </span>
  );
}
