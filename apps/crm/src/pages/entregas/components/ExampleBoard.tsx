export function ExampleBoard({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="animate-up" style={{ position: 'relative' }}>
      <div className="board-container">
        {['Criação', 'Revisão interna', 'Aprovação do cliente', 'Ajustes'].map((col) => (
          <div key={col} className="board-column">
            <div
              className="board-column-header"
              {...(col === 'Aprovação do cliente' ? { 'data-tour': 'wf-col-aprovacao' } : {})}
            >
              <span className="board-column-title">{col}</span>
              <span className="board-column-count">{col === 'Criação' ? 1 : 0}</span>
            </div>
            <div className="board-column-body" style={{ minHeight: 60 }}>
              {col === 'Criação' ? (
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
                    Exemplo
                  </span>
                  <div className="board-card-title" style={{ fontWeight: 600 }}>
                    Posts de Agosto
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                    Cliente Exemplo
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <span
                      data-tour="wf-deadline"
                      className="badge-success"
                      style={{ fontSize: '0.62rem' }}
                    >
                      3d restantes
                    </span>
                    <span
                      data-tour="wf-posts"
                      className="badge-neutral"
                      style={{ fontSize: '0.62rem' }}
                    >
                      📄 4 posts
                    </span>
                    <span className="badge-neutral" style={{ fontSize: '0.62rem' }}>
                      👤 Maria
                    </span>
                  </div>
                </div>
              ) : (
                <div className="board-empty">Nenhuma entrega</div>
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
        Ocultar exemplo
      </button>
    </div>
  );
}
