import type { WorkflowTemplate } from '../../../../store';
import { STANDARD_PRESETS, presetDurationDays, type WorkflowPreset } from '../presets';

export function StepTemplate({
  templates,
  onSelectPreset,
  onSelectTemplate,
  onSelectZero,
}: {
  templates: WorkflowTemplate[];
  onSelectPreset: (p: WorkflowPreset) => void;
  onSelectTemplate: (t: WorkflowTemplate) => void;
  onSelectZero: () => void;
}) {
  return (
    <div>
      <p
        style={{
          fontSize: '0.8rem',
          color: 'var(--text-muted)',
          background: 'var(--surface-2, #f8fafc)',
          borderRadius: 8,
          padding: '0.5rem 0.75rem',
          marginBottom: '1rem',
        }}
      >
        💡 Um <b>fluxo</b> é um ciclo de trabalho para um cliente (ex.: posts de agosto). Um{' '}
        <b>template</b> é a receita reutilizável de etapas.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '0.75rem',
        }}
      >
        {STANDARD_PRESETS.map((p) => {
          const approvals = p.etapas.filter((e) => e.tipo === 'aprovacao_cliente').length;
          const Icon = p.icon;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelectPreset(p)}
              style={{
                textAlign: 'left',
                border: '1px solid var(--border-color)',
                borderRadius: 12,
                padding: '0.9rem',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Icon className="h-5 w-5" />
                {p.recorrente && (
                  <span className="badge-warning" style={{ fontSize: '0.6rem' }}>
                    Recorrente
                  </span>
                )}
              </div>
              <h4 style={{ margin: '0.4rem 0 0.2rem' }}>{p.nome}</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, margin: '0.4rem 0' }}>
                {p.etapas.map((e) => (
                  <span
                    key={e.nome}
                    style={{
                      fontSize: '0.62rem',
                      borderRadius: 4,
                      padding: '1px 6px',
                      background:
                        e.tipo === 'aprovacao_cliente' ? '#eff6ff' : 'var(--surface-2, #f1f5f9)',
                      color: e.tipo === 'aprovacao_cliente' ? '#1d4ed8' : 'var(--text-muted)',
                      fontWeight: e.tipo === 'aprovacao_cliente' ? 600 : 400,
                    }}
                  >
                    {e.nome}
                  </span>
                ))}
              </div>
              <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', margin: 0 }}>
                {p.etapas.length} etapas · ~{presetDurationDays(p)} dias
                {approvals > 0 && (
                  <span style={{ marginLeft: 6, color: '#1d4ed8', fontWeight: 600 }}>
                    {approvals > 1 ? `${approvals} aprovações externas` : 'Aprovação externa'}
                  </span>
                )}
              </p>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: '1rem' }}>
        <h5
          style={{
            fontSize: '0.72rem',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 6,
          }}
        >
          Seus templates
        </h5>
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelectTemplate(t)}
            style={{
              display: 'flex',
              width: '100%',
              justifyContent: 'space-between',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              padding: '0.5rem 0.75rem',
              marginBottom: 6,
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            <span>
              📋 <span>{t.nome}</span>
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {t.etapas.length} etapas
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={onSelectZero}
          style={{
            width: '100%',
            border: '1px dashed var(--border-color)',
            borderRadius: 12,
            padding: '0.9rem',
            textAlign: 'center',
            color: 'var(--text-muted)',
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          ＋ <span>Começar do zero</span>
        </button>
      </div>
    </div>
  );
}
