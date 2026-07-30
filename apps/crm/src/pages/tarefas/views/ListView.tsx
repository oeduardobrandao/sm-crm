import { useState } from 'react';
import { toast } from 'sonner';
import { CheckSquare, ChevronDown, ChevronRight } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { avatarColorClass } from '@/lib/avatarColor';
import { getInitials, updateTarefa, type Membro, type TarefaWithRelations } from '../../../store';
import { DUE_BUCKETS, dueBadge, groupByDueBucket } from '../tarefasLogic';
import { TagPill } from '../components/TagPicker';

interface ListViewProps {
  tarefas: TarefaWithRelations[];
  membros: Membro[];
  onTarefaClick: (tarefa: TarefaWithRelations) => void;
  onRefresh: () => void;
}

function TarefaRow({
  tarefa,
  membro,
  now,
  onClick,
  onToggleComplete,
}: {
  tarefa: TarefaWithRelations;
  membro: Membro | null;
  now: Date;
  onClick: () => void;
  onToggleComplete: (concluida: boolean) => void;
}) {
  const badge = dueBadge(tarefa, now);
  const done = tarefa.status === 'concluida';
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick();
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.6rem 0.9rem',
        borderBottom: '1px solid var(--border-color)',
        cursor: 'pointer',
      }}
      className="tarefa-list-row"
    >
      <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex' }}>
        <Checkbox
          checked={done}
          aria-label={done ? 'Reabrir tarefa' : 'Concluir tarefa'}
          onCheckedChange={(checked) => onToggleComplete(checked === true)}
        />
      </span>
      <span
        style={{
          fontSize: '0.85rem',
          fontWeight: 500,
          color: done ? 'var(--text-muted)' : 'var(--text-main)',
          textDecoration: done ? 'line-through' : undefined,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {tarefa.titulo}
      </span>
      <span style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
        {tarefa.tags.slice(0, 3).map((tag) => (
          <TagPill key={tag.id} tag={tag} small />
        ))}
      </span>
      {tarefa.cliente_nome && (
        <span
          style={{
            fontSize: '0.7rem',
            color: 'var(--text-muted)',
            flexShrink: 0,
            maxWidth: 140,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {tarefa.cliente_nome}
        </span>
      )}
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
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
        {badge && <span className={`board-card-deadline ${badge.className}`}>{badge.label}</span>}
        {membro ? (
          <span
            className={`avatar ${avatarColorClass(membro.id ?? membro.nome)}`}
            style={{ width: 22, height: 22, fontSize: '0.55rem', fontWeight: 800 }}
            title={membro.nome}
          >
            {getInitials(membro.nome)}
          </span>
        ) : (
          <span style={{ width: 22 }} />
        )}
      </span>
    </div>
  );
}

/** List grouped by due date buckets, with a collapsed "Concluídas" section. */
export function ListView({ tarefas, membros, onTarefaClick, onRefresh }: ListViewProps) {
  const [showConcluidas, setShowConcluidas] = useState(false);
  const now = new Date();
  const buckets = groupByDueBucket(tarefas, now);
  const membroById = new Map(membros.filter((m) => m.id != null).map((m) => [m.id!, m]));

  const concluidas = tarefas
    .filter((t) => t.status === 'concluida')
    .sort((a, b) => (b.concluida_em ?? '').localeCompare(a.concluida_em ?? ''))
    .slice(0, 50);

  const handleToggleComplete = async (tarefa: TarefaWithRelations, concluida: boolean) => {
    try {
      await updateTarefa(tarefa.id!, { status: concluida ? 'concluida' : 'pendente' });
      toast.success(concluida ? 'Tarefa concluída!' : 'Tarefa reaberta!');
      onRefresh();
    } catch {
      toast.error('Erro ao atualizar tarefa');
    }
  };

  const membroOf = (t: TarefaWithRelations) =>
    t.responsavel_id != null ? (membroById.get(t.responsavel_id) ?? null) : null;

  const totalOpen = DUE_BUCKETS.reduce((sum, b) => sum + buckets[b.id].length, 0);

  return (
    <div className="animate-up" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {totalOpen === 0 && (
        <div
          className="card"
          style={{
            textAlign: 'center',
            padding: '3rem 2rem',
            color: 'var(--text-muted)',
            borderRadius: '12px',
          }}
        >
          <p style={{ fontSize: '0.85rem' }}>
            Nenhuma tarefa aberta. Crie uma nova ou ajuste os filtros.
          </p>
        </div>
      )}
      {DUE_BUCKETS.map((bucket) => {
        const items = buckets[bucket.id];
        if (items.length === 0) return null;
        return (
          <div key={bucket.id} className="card" style={{ padding: 0, borderRadius: '12px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.7rem 0.9rem',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: bucket.id === 'atrasadas' ? 'var(--danger-text)' : 'var(--text-muted)',
                }}
              >
                {bucket.label}
              </span>
              <span
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  background: 'var(--surface-2)',
                  borderRadius: '999px',
                  padding: '0.05rem 0.5rem',
                }}
              >
                {items.length}
              </span>
            </div>
            {items.map((t) => (
              <TarefaRow
                key={t.id}
                tarefa={t}
                membro={membroOf(t)}
                now={now}
                onClick={() => onTarefaClick(t)}
                onToggleComplete={(c) => handleToggleComplete(t, c)}
              />
            ))}
          </div>
        );
      })}

      {concluidas.length > 0 && (
        <div className="card" style={{ padding: 0, borderRadius: '12px' }}>
          <button
            type="button"
            onClick={() => setShowConcluidas((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.7rem 0.9rem',
              width: '100%',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              borderBottom: showConcluidas ? '1px solid var(--border-color)' : 'none',
            }}
          >
            {showConcluidas ? (
              <ChevronDown className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
            )}
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-muted)',
              }}
            >
              Concluídas
            </span>
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 600,
                color: 'var(--text-muted)',
                background: 'var(--surface-2)',
                borderRadius: '999px',
                padding: '0.05rem 0.5rem',
              }}
            >
              {concluidas.length}
            </span>
          </button>
          {showConcluidas &&
            concluidas.map((t) => (
              <TarefaRow
                key={t.id}
                tarefa={t}
                membro={membroOf(t)}
                now={now}
                onClick={() => onTarefaClick(t)}
                onToggleComplete={(c) => handleToggleComplete(t, c)}
              />
            ))}
        </div>
      )}
    </div>
  );
}
