import { useTranslation } from 'react-i18next';
import type { ClientHealthSummary } from '../../../services/clientHealth';
import type { HealthFilterKey, HealthSort } from '../../../lib/health/filter';

interface Props {
  summary: ClientHealthSummary;
  filter: HealthFilterKey;
  onFilter: (k: HealthFilterKey) => void;
  search: string;
  onSearch: (s: string) => void;
  sort: HealthSort;
  onSort: (s: HealthSort) => void;
}

const CHIPS: { key: HealthFilterKey; countKey: keyof ClientHealthSummary | null }[] = [
  { key: 'todos', countKey: 'total' },
  { key: 'atencao', countKey: 'atencao' },
  { key: 'saudaveis', countKey: 'saudaveis' },
  { key: 'estaveis', countKey: 'estaveis' },
  { key: 'conexao', countKey: 'conexao' },
];

const SORTS: HealthSort[] = ['atencao', 'engajamento', 'ultimo_post', 'seguidores', 'nome'];

export function HealthFilterBar({ summary, filter, onFilter, search, onSearch, sort, onSort }: Props) {
  const { t } = useTranslation('dashboard');
  return (
    <div
      className="card"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 10,
        padding: '11px 13px',
        borderRadius: 14,
      }}
    >
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {CHIPS.map(({ key, countKey }) => {
          const active = filter === key;
          const count = countKey ? summary[countKey] : 0;
          return (
            <button
              key={key}
              onClick={() => onFilter(key)}
              style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                padding: '5px 11px',
                borderRadius: 20,
                border: active ? '1px solid var(--primary-color)' : '1px solid transparent',
                background: active ? 'var(--primary-color)' : 'var(--surface-hover)',
                color: active ? '#1a1a1a' : 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              <span>{t(`health.chips.${key}`)}</span> <strong>{count}</strong>
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          className="form-input"
          placeholder={t('health.search')}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          style={{ fontSize: '0.72rem' }}
        />
        <select
          aria-label={t('health.sortLabel')}
          value={sort}
          onChange={(e) => onSort(e.target.value as HealthSort)}
          className="form-input"
          style={{ fontSize: '0.72rem' }}
        >
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`health.sort.${s}`)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
