import { useTranslation } from 'react-i18next';
import type { GbpKeywords } from '../../../services/gbpAnalytics';
import { GbpCard, QueryBody, Segments, type GbpQuery } from './GbpCard';
import { formatMonth } from './gbpTabFormat';

/** More months than this become a select (18 months of backfill do not fit as segments). */
const MAX_MONTH_SEGMENTS = 4;

/** "O que buscaram no Google": one closed month of search terms; the current month never shows. */
export function GbpKeywordsCard({
  query,
  onMonth,
  phone,
}: {
  query: GbpQuery<GbpKeywords>;
  onMonth: (month: string) => void;
  phone?: boolean;
}) {
  const { t, i18n } = useTranslation('analyticsGoogle');
  const data = query.data;
  const months = [...(data?.months ?? [])].sort();
  const month = data?.month ?? null;

  let control = null;
  if (month && months.length > 1) {
    control =
      months.length > MAX_MONTH_SEGMENTS ? (
        <select
          aria-label={t('keywords.monthAria')}
          value={month}
          onChange={(e) => onMonth(e.target.value)}
          className="h-9 rounded-full border px-3 text-sm bg-transparent"
          style={{ borderColor: 'var(--border-color)' }}
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {formatMonth(m, i18n.language, 'long')}
            </option>
          ))}
        </select>
      ) : (
        <Segments
          phone={phone}
          ariaLabel={t('keywords.monthAria')}
          value={month}
          onChange={onMonth}
          options={months.map((m) => ({ value: m, label: formatMonth(m, i18n.language, 'short') }))}
        />
      );
  }

  return (
    <GbpCard
      phone={phone}
      title={t('keywords.title')}
      sub={
        month
          ? t('keywords.sub', { month: formatMonth(month, i18n.language, 'long') })
          : t('keywords.subNoMonth')
      }
      trailing={control}
    >
      <QueryBody query={query}>
        {(kw) =>
          kw.keywords.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>{t('keywords.empty')}</p>
          ) : (
            <>
              <table className={phone ? undefined : 'data-table'} style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>{t('keywords.colKeyword')}</th>
                    <th style={{ textAlign: 'right' }}>{t('keywords.colPeople')}</th>
                  </tr>
                </thead>
                <tbody>
                  {kw.keywords.map((row) => (
                    <tr key={row.keyword}>
                      <td style={{ overflowWrap: 'anywhere' }}>{row.keyword}</td>
                      {row.value !== null ? (
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {row.value.toLocaleString('pt-BR')}
                        </td>
                      ) : (
                        <td
                          style={{
                            textAlign: 'right',
                            color: 'var(--text-muted)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {row.threshold !== null
                            ? t('keywords.threshold', { n: row.threshold })
                            : t('states.noData')}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '0.9rem 0 0' }}>
                {t('keywords.footnote')}
              </p>
            </>
          )
        }
      </QueryBody>
    </GbpCard>
  );
}
