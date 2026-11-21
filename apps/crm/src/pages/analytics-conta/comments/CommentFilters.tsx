import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '@mesaas/i18n';
import { Button } from '@/components/ui/button';
import type { Categoria } from '../../../services/instagramComments';
import { CATEGORIAS, type TiposState } from './commentTipos';

/**
 * Above the comment list: the type chips when the reading has types ('ok'), a notice with
 * "Refazer leitura" when it has none ('legacy') or classifying failed ('failed'), and
 * nothing without a reading ('none').
 */
export function CommentFilters({
  state,
  counts,
  total,
  active,
  onChange,
  onRedo,
  redoing,
}: {
  state: TiposState;
  counts: Record<Categoria, number>;
  total: number;
  active: Categoria | null;
  onChange(t: Categoria | null): void;
  onRedo(): void;
  redoing: boolean;
}) {
  const { t } = useTranslation('analyticsComments');
  const locale = useIntlLocale();

  if (state === 'none') return null;

  if (state === 'legacy' || state === 'failed') {
    return (
      <div className="igc-filters__notice">
        <p className="igc-filters__notice-text">
          {state === 'legacy' ? (
            <>
              <b>{t('filter.legacyTitle')}</b> {t('filter.legacyText')}
            </>
          ) : (
            t('filter.failedText')
          )}
        </p>
        <Button variant="outline" className="igc-btn" disabled={redoing} onClick={onRedo}>
          {t('filter.redo')}
        </Button>
      </div>
    );
  }

  const chip = (tipo: Categoria | null, label: string, count: number) => (
    <button
      key={tipo ?? 'all'}
      type="button"
      className="igc-filters__chip"
      aria-pressed={active === tipo}
      onClick={() => onChange(tipo)}
    >
      {tipo && <span className={`igc-filters__dot igc-cat--${tipo}`} aria-hidden="true" />}
      {label} <span className="igc-filters__count">{count.toLocaleString(locale)}</span>
    </button>
  );

  return (
    <div role="group" aria-label={t('filter.ariaLabel')} className="igc-filters">
      {chip(null, t('filter.all'), total)}
      {CATEGORIAS.filter((c) => counts[c] > 0 || c === active).map((c) =>
        chip(c, t(`distribution.${c}`), counts[c]),
      )}
    </div>
  );
}
