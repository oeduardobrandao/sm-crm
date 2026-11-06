import { useTranslation } from 'react-i18next';
import type { GbpSurfaceRow } from '../../../services/gbpAnalytics';
import { GbpCard, QueryBody, type GbpQuery } from './GbpCard';
import { formatGbpCount, pctOf } from './gbpTabFormat';

type Surface = GbpSurfaceRow['surface'];

/** Board 4 order and colours: mobile first (blue, green), desktop in lighter shades. */
const SURFACES: { surface: Surface; color: string }[] = [
  { surface: 'mobile_search', color: '#2563eb' },
  { surface: 'mobile_maps', color: '#16a34a' },
  { surface: 'desktop_search', color: '#93c5fd' },
  { surface: 'desktop_maps', color: '#86efac' },
];

/** "Onde viram o perfil": the four impression surfaces of the period. */
export function GbpSurfacesCard({
  query,
  phone,
}: {
  query: GbpQuery<GbpSurfaceRow[]>;
  phone?: boolean;
}) {
  const { t } = useTranslation('analyticsGoogle');
  const rows = query.data ?? [];
  const value = (s: Surface) => rows.find((r) => r.surface === s)?.value ?? 0;
  const total = SURFACES.reduce((sum, s) => sum + value(s.surface), 0);
  const mobile = value('mobile_search') + value('mobile_maps');
  const maps = value('mobile_maps') + value('desktop_maps');

  return (
    <GbpCard
      phone={phone}
      title={t('surfaces.title')}
      sub={
        query.data && total > 0
          ? t('surfaces.sub', { count: total, views: formatGbpCount(total) })
          : undefined
      }
    >
      <QueryBody query={query}>
        {() =>
          total === 0 ? (
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>{t('surfaces.empty')}</p>
          ) : (
            <>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
                {SURFACES.map(({ surface, color }) => {
                  const v = value(surface);
                  const pct = pctOf(v, total);
                  return (
                    <li key={surface}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 8,
                          fontSize: '0.85rem',
                        }}
                      >
                        <span>{t(`surfaces.${surface}`)}</span>
                        <strong>{v.toLocaleString('pt-BR')}</strong>
                      </div>
                      <div
                        aria-hidden="true"
                        style={{
                          height: 6,
                          borderRadius: 999,
                          background: 'var(--surface-2)',
                          marginTop: 4,
                          overflow: 'hidden',
                        }}
                      >
                        <div style={{ width: `${pct}%`, height: '100%', background: color }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '0.9rem 0 0' }}>
                {t('surfaces.footnote', { mobile: pctOf(mobile, total), maps: pctOf(maps, total) })}
              </p>
            </>
          )
        }
      </QueryBody>
    </GbpCard>
  );
}
