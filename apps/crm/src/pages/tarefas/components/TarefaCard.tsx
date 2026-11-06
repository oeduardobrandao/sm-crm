import { useEffect, useState } from 'react';
import { Calendar as CalendarIcon, CheckSquare, MessageCircle, Repeat, User2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PessoaAvatar } from '@/components/PessoaAvatar';
import { updateTarefa, type Membro, type TarefaWithRelations } from '../../../store';
import { dueBadge } from '../tarefasLogic';
import { describeRecorrencia } from '../recorrenciaLogic';
import { TagPill } from './TagPicker';

/** "MessageCircle n" next to the subtask counter on board cards and list rows; nothing at 0. */
export function TarefaComentariosCount({ total }: { total: number }) {
  const { t } = useTranslation('tasks');
  if (total <= 0) return null;
  const label = t('shared.commentCount', { count: total });
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
        fontSize: '0.68rem',
        color: 'var(--text-muted)',
      }}
    >
      <MessageCircle className="h-3 w-3" aria-hidden="true" />
      {total}
    </span>
  );
}

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
  const { t } = useTranslation('tasks');
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
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.3rem',
          }}
        >
          {tarefa.serie && (
            <span
              role="img"
              aria-label={t('shared.recurringTask')}
              title={describeRecorrencia(tarefa.serie)}
              style={{
                display: 'inline-flex',
                color: 'var(--text-muted)',
                flexShrink: 0,
                marginTop: '0.2rem',
              }}
            >
              <Repeat className="h-3 w-3" />
            </span>
          )}
          <span>{tarefa.titulo}</span>
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
                title={displayMembro?.nome}
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
                  <PessoaAvatar
                    nome={displayMembro.nome}
                    fotoUrl={displayMembro.avatar_url}
                    seed={displayMembro.id}
                    size={20}
                    className="!text-[0.55rem] !font-extrabold"
                  />
                ) : (
                  <span
                    title={t('shared.noAssignee')}
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
                        toast.success(t('commands.assigneeUpdated'));
                        onRefresh();
                      } catch {
                        setLocalMembro(undefined);
                        toast.error(t('commands.assigneeError'));
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
                    <PessoaAvatar
                      nome={m.nome}
                      fotoUrl={m.avatar_url}
                      seed={m.id}
                      size={16}
                      className="!text-[0.5rem]"
                    />
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
        <TarefaComentariosCount total={tarefa.comentarios_total} />
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
