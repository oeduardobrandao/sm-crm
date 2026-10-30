import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import type { GbpUnitRow } from '../../../services/gbpAnalytics';
import { formatRating } from './gbpTabFormat';

/** "Comparar unidades": the period's sums per unit, plus each unit's current rating. */
export function GbpUnitsTable({
  units,
  windowDays,
  phone,
}: {
  units: GbpUnitRow[];
  windowDays: number;
  phone?: boolean;
}) {
  const { t } = useTranslation('analyticsGoogle');
  const title = t('units.title');
  const sub = t('units.sub', { count: windowDays });
  const name = (u: GbpUnitRow) => u.title || t('filters.untitledUnit');
  const rating = (u: GbpUnitRow) =>
    u.avgRating === null
      ? t('units.noRating')
      : t('units.rating', {
          rating: formatRating(u.avgRating),
          reviews: (u.totalReviewCount ?? 0).toLocaleString('pt-BR'),
        });
  const n = (v: number) => v.toLocaleString('pt-BR');

  if (phone) {
    return (
      <GroupedList header={title} footer={sub}>
        {units.map((u) => (
          <Cell
            key={u.id}
            label={name(u)}
            subtitle={[
              `${t('units.colViews')} ${n(u.profileViews)}`,
              `${t('units.colCalls')} ${n(u.calls)}`,
              `${t('units.colDirections')} ${n(u.directions)}`,
              `${t('units.colWebsite')} ${n(u.websiteClicks)}`,
              `${t('units.colMessages')} ${n(u.messages)}`,
            ].join(' · ')}
            value={rating(u)}
          />
        ))}
      </GroupedList>
    );
  }

  return (
    <div className="card animate-up" style={{ minWidth: 0 }}>
      <div className="dashboard-hub-card-header">
        <div>
          <h3>{title}</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
            {sub}
          </p>
        </div>
      </div>
      <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
        <table className="data-table" style={{ width: '100%', minWidth: 640 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>{t('units.colUnit')}</th>
              <th style={{ textAlign: 'right' }}>{t('units.colViews')}</th>
              <th style={{ textAlign: 'right' }}>{t('units.colCalls')}</th>
              <th style={{ textAlign: 'right' }}>{t('units.colDirections')}</th>
              <th style={{ textAlign: 'right' }}>{t('units.colWebsite')}</th>
              <th style={{ textAlign: 'right' }}>{t('units.colMessages')}</th>
              <th style={{ textAlign: 'right' }}>{t('units.colRating')}</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id}>
                <td>
                  <span style={{ fontWeight: 600 }}>{name(u)}</span>
                  {u.status === 'revoked' && (
                    <Badge variant="warning" size="sm" style={{ marginLeft: 8 }}>
                      {t('units.revoked')}
                    </Badge>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>{n(u.profileViews)}</td>
                <td style={{ textAlign: 'right' }}>{n(u.calls)}</td>
                <td style={{ textAlign: 'right' }}>{n(u.directions)}</td>
                <td style={{ textAlign: 'right' }}>{n(u.websiteClicks)}</td>
                <td style={{ textAlign: 'right' }}>{n(u.messages)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{rating(u)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
