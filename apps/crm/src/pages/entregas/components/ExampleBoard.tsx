import { useTranslation } from 'react-i18next';
const COLUMNS = ['criacao', 'revisao', 'aprovacao', 'ajustes'] as const;

export function ExampleBoard({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation('entregas');
  return (
    <div className="animate-up" style={{ position: 'relative' }}>
      <div className="board-container">
        {COLUMNS.map((col) => (
          <div key={col} className="board-column">
            <div
              className="board-column-header"
              {...(col === 'aprovacao' ? { 'data-tour': 'wf-col-aprovacao' } : {})}
            >
              <span className="board-column-title">{t(`exampleBoard.columns.${col}`)}</span>
              <span className="board-column-count">{col === 'criacao' ? 1 : 0}</span>
            </div>
            <div className="board-column-body" style={{ minHeight: 60 }}>
              {col === 'criacao' ? (
                <div
                  className="board-card deadline-ok"
                  data-tour="wf-card"
                  style={{
                    position: 'relative',
                    padding: '0.9rem',
                    borderLeft: '3px solid #3ecf8e',
                    borderRadius: 10,
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: -8,
                      right: 8,
                      background: '#eab308',
                      color: '#12151a',
                      fontSize: '0.58rem',
                      fontWeight: 800,
                      borderRadius: 4,
                      padding: '1px 7px',
                      textTransform: 'uppercase',
                    }}
                  >
                    {t('exampleBoard.badge')}
                  </span>
                  <div className="board-card-title" style={{ fontWeight: 600 }}>
                    {t('exampleBoard.cardTitle')}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                    {t('exampleBoard.cardClient')}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <span
                      data-tour="wf-deadline"
                      className="badge badge-success"
                      style={{ fontSize: '0.62rem' }}
                    >
                      {t('exampleBoard.deadline')}
                    </span>
                    <span
                      data-tour="wf-posts"
                      className="badge badge-neutral"
                      style={{ fontSize: '0.62rem' }}
                    >
                      {t('exampleBoard.posts')}
                    </span>
                    <span className="badge badge-neutral" style={{ fontSize: '0.62rem' }}>
                      {t('exampleBoard.assignee')}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="board-empty">{t('exampleBoard.empty')}</div>
              )}
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          marginTop: 8,
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textDecoration: 'underline',
        }}
      >
        {t('exampleBoard.hide')}
      </button>
    </div>
  );
}
