import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { EmptyStateGuide } from '../../../components/help/EmptyStateGuide';

export interface TodayEvent {
  kind: 'income' | 'expense' | 'deadline' | 'birthday' | 'data';
  label: string;
  sublabel: string;
}

const ICON: Record<TodayEvent['kind'], { icon: string; color: string }> = {
  income: { icon: 'ph ph-arrow-up-right', color: 'var(--success)' },
  expense: { icon: 'ph ph-arrow-down-left', color: 'var(--danger)' },
  deadline: { icon: 'ph ph-flag', color: 'var(--warning)' },
  birthday: { icon: 'ph ph-cake', color: 'var(--pink, #ec4899)' },
  data: { icon: 'ph ph-star', color: 'var(--info, #6366f1)' },
};

export function TodayCard({ events }: { events: TodayEvent[] }) {
  const { t } = useTranslation('dashboard');
  return (
    <Link to="/calendario" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="card dashboard-hub-card animate-up">
        <div className="dashboard-hub-card-header">
          <h3>
            <i className="ph ph-calendar-check" style={{ marginRight: 8 }} />
            {t('cards.today')}
          </h3>
          <i className="ph ph-arrow-right" />
        </div>
        {events.length === 0 ? (
          <EmptyStateGuide
            icon="📅"
            title={t('empty.noEventsToday')}
            description=""
            actionLabel="Clientes"
            actionHref="/clientes"
          />
        ) : (
          <div className="dashboard-hub-list">
            {events.map((e, i) => (
              <div key={i} className="dashboard-hub-row">
                <span style={{ fontSize: '0.85rem' }}>
                  <i className={ICON[e.kind].icon} style={{ color: ICON[e.kind].color, marginRight: 4 }} />
                  {e.label}
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{e.sublabel}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
