import { CheckSquare, User2 } from 'lucide-react';
import { avatarColorClass } from '@/lib/avatarColor';
import { getInitials, type Membro, type TarefaWithRelations } from '../../../store';
import { dueBadge } from '../tarefasLogic';
import { TagPill } from './TagPicker';

interface TarefaCardProps {
  tarefa: TarefaWithRelations;
  membro: Membro | null;
  now: Date;
  onClick: () => void;
  /** Hides the assignee chip (redundant inside a member column). */
  hideAssignee?: boolean;
}

/** Presentational task card for the board views. Drag wrappers live in the views. */
export function TarefaCard({ tarefa, membro, now, onClick, hideAssignee }: TarefaCardProps) {
  const badge = dueBadge(tarefa, now);
  return (
    <div
      className="board-card"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={{ cursor: 'pointer' }}
    >
      {tarefa.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginBottom: '0.35rem' }}>
          {tarefa.tags.map((tag) => (
            <TagPill key={tag.id} tag={tag} small />
          ))}
        </div>
      )}
      <div
        style={{
          fontSize: '0.82rem',
          fontWeight: 600,
          color: 'var(--text-main)',
          lineHeight: 1.35,
          textDecoration: tarefa.status === 'concluida' ? 'line-through' : undefined,
          opacity: tarefa.status === 'concluida' ? 0.6 : 1,
        }}
      >
        {tarefa.titulo}
      </div>
      {tarefa.cliente_nome && (
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
          {tarefa.cliente_nome}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginTop: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        {badge && <span className={`board-card-deadline ${badge.className}`}>{badge.label}</span>}
        {tarefa.subtarefas_total > 0 && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              fontSize: '0.68rem',
              color:
                tarefa.subtarefas_concluidas === tarefa.subtarefas_total
                  ? 'var(--success)'
                  : 'var(--text-muted)',
            }}
          >
            <CheckSquare className="h-3 w-3" />
            {tarefa.subtarefas_concluidas}/{tarefa.subtarefas_total}
          </span>
        )}
        {!hideAssignee && (
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center' }}>
            {membro ? (
              <span
                className={`avatar ${avatarColorClass(membro.id ?? membro.nome)}`}
                style={{ width: 20, height: 20, fontSize: '0.55rem', fontWeight: 800 }}
                title={membro.nome}
              >
                {getInitials(membro.nome)}
              </span>
            ) : (
              <span
                title="Sem responsável"
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: 'var(--surface-hover)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                }}
              >
                <User2 className="h-3 w-3" />
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
