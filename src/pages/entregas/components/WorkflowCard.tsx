import type { BoardCard } from '../hooks/useEntregasData';

const avatarColors = ['#eab308', '#3ecf8e', '#f5a342', '#f542c8', '#42c8f5', '#8b5cf6', '#ef4444', '#14b8a6'];
function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}
function getInitials(name: string): string {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

interface WorkflowCardProps {
  card: BoardCard;
  onClick?: () => void;
  /** Set to true when rendering inside DragOverlay — disables pointer events */
  isDragOverlay?: boolean;
  /** Optional drag handle element rendered at the top-right */
  dragHandle?: React.ReactNode;
}

export function WorkflowCard({ card, onClick, isDragOverlay, dragHandle }: WorkflowCardProps) {
  const dl = card.deadline;
  const deadlineClass = dl.estourado
    ? 'deadline-overdue'
    : dl.urgente
    ? 'deadline-warning'
    : dl.diasRestantes <= 3
    ? 'deadline-caution'
    : 'deadline-ok';
  const deadlineText = dl.estourado
    ? `${Math.abs(dl.diasRestantes)}d atrasado`
    : dl.diasRestantes === 0 && dl.horasRestantes === 0
    ? 'Vence agora'
    : dl.diasRestantes === 0
    ? `${dl.horasRestantes}h restantes`
    : dl.horasRestantes > 0
    ? `${dl.diasRestantes}d ${dl.horasRestantes}h restantes`
    : `${dl.diasRestantes}d restantes`;
  const progressPct = card.totalEtapas > 0 ? Math.round((card.etapaIdx / card.totalEtapas) * 100) : 0;
  const iniciadoEm = card.etapa.iniciado_em
    ? new Date(card.etapa.iniciado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
    : null;

  return (
    <div
      className={`board-card ${deadlineClass}`}
      style={{ opacity: isDragOverlay ? 0.8 : 1, cursor: onClick ? 'pointer' : 'default', position: 'relative' }}
      onClick={onClick}
    >
      {dragHandle && (
        <div style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', cursor: 'grab', color: 'var(--text-muted)' }}>
          {dragHandle}
        </div>
      )}
      <div className="board-card-top">
        <span className="board-card-client" style={{ borderLeft: `3px solid ${card.cliente?.cor || '#888'}`, paddingLeft: '0.5rem' }}>
          {card.cliente?.nome || '—'}
        </span>
        {card.workflow.recorrente && <span title="Recorrente" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>↻</span>}
      </div>
      <div className="board-card-title">{card.workflow.titulo}</div>
      <div className="board-card-meta">
        <span className={`board-card-deadline ${deadlineClass}`}>{deadlineText}</span>
        <span className="board-card-prazo-type">{card.etapa.tipo_prazo === 'uteis' ? 'dias úteis' : 'dias corridos'}</span>
      </div>
      {card.membro ? (
        <div
          className="board-card-assignee"
          style={{ width: 28, height: 28, borderRadius: '50%', background: getAvatarColor(card.membro.nome), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700, color: '#fff', flexShrink: 0 }}
        >
          {getInitials(card.membro.nome)}
        </div>
      ) : (
        <div className="board-card-assignee" style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
          ?
        </div>
      )}
      <div className="board-card-footer">
        <div className="board-card-progress-bar">
          <div className="board-card-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <span className="board-card-steps">{card.etapaIdx + 1}/{card.totalEtapas}</span>
        {iniciadoEm && <span className="board-card-started">Início: {iniciadoEm}</span>}
      </div>
    </div>
  );
}
