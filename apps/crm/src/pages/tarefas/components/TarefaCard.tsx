import { useEffect, useState } from 'react';
import { Calendar as CalendarIcon, CheckSquare, User2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { avatarColorClass } from '@/lib/avatarColor';
import { getInitials, updateTarefa, type Membro, type TarefaWithRelations } from '../../../store';
import { dueBadge } from '../tarefasLogic';
import { TagPill } from './TagPicker';

interface TarefaCardProps {
  tarefa: TarefaWithRelations;
  membro: Membro | null;
  now: Date;
  onClick: () => void;
  membros: Membro[];
  onRefresh: () => void;
  /** Hides the assignee chip (redundant inside a member column). */
  hideAssignee?: boolean;
}

/** Presentational task card for the board views. Drag wrappers live in the views. */
export function TarefaCard({
  tarefa,
  membro,
  now,
  onClick,
  membros,
  onRefresh,
  hideAssignee,
}: TarefaCardProps) {
  const badge = dueBadge(tarefa, now);
  const [assignOpen, setAssignOpen] = useState(false);
  const [localMembro, setLocalMembro] = useState<Membro | null | undefined>(undefined);
  const displayMembro = localMembro !== undefined ? localMembro : membro;

  // A successful reassign sets localMembro to optimistically show the new
  // avatar before onRefresh's refetch lands. Once the prop actually catches up
  // (this task's responsavel_id changed -- from this reassign or any other,
  // e.g. the detail sheet), drop the override so the card can't get stuck
  // showing a stale assignee if it re-renders in place rather than remounting.
  useEffect(() => {
    setLocalMembro(undefined);
  }, [tarefa.responsavel_id]);

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
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}
      >
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
        {!hideAssignee && (
          <DropdownMenu
            open={assignOpen}
            onOpenChange={(open) => {
              if (membros.length > 0) setAssignOpen(open);
            }}
          >
            <DropdownMenuTrigger asChild>
              <span
                style={{ flexShrink: 0, cursor: membros.length > 0 ? 'pointer' : 'default' }}
                onPointerDown={(e) => {
                  if (membros.length === 0) return;
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  if (membros.length === 0) return;
                  e.stopPropagation();
                }}
              >
                {displayMembro ? (
                  <span
                    className={`avatar ${avatarColorClass(displayMembro.id ?? displayMembro.nome)}`}
                    style={{ width: 20, height: 20, fontSize: '0.55rem', fontWeight: 800 }}
                    title={displayMembro.nome}
                  >
                    {getInitials(displayMembro.nome)}
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
            </DropdownMenuTrigger>
            {membros.length > 0 && (
              <DropdownMenuContent align="end" style={{ zIndex: 99999, minWidth: '160px' }}>
                {membros.map((m) => (
                  <DropdownMenuItem
                    key={m.id}
                    onClick={async (e) => {
                      e.stopPropagation();
                      setAssignOpen(false);
                      setLocalMembro(m);
                      try {
                        await updateTarefa(tarefa.id!, { responsavel_id: m.id ?? null });
                        toast.success('Responsável atualizado!');
                        onRefresh();
                      } catch {
                        setLocalMembro(undefined);
                        toast.error('Erro ao atualizar responsável');
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                    }}
                  >
                    <span
                      className={`avatar ${avatarColorClass(m.id ?? m.nome)}`}
                      style={{ width: 16, height: 16, fontSize: '0.5rem' }}
                    >
                      {getInitials(m.nome)}
                    </span>
                    {m.nome}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            )}
          </DropdownMenu>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginTop: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        {badge && (
          <span
            className={`board-card-deadline ${badge.className}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
          >
            <CalendarIcon className="h-3 w-3" />
            {badge.label}
          </span>
        )}
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
      </div>
      {tarefa.cliente_nome && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            marginTop: '0.5rem',
            paddingTop: '0.4rem',
            borderTop: '1px solid var(--border-color)',
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: tarefa.cliente_cor || 'var(--text-muted)',
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: '0.7rem', fontWeight: 500, color: 'var(--text-muted)' }}>
            {tarefa.cliente_nome}
          </span>
        </div>
      )}
    </div>
  );
}
