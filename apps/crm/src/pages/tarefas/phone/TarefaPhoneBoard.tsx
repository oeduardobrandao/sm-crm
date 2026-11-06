import { useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Chip, ChipRow } from '@/components/mobile/ChipRow';
import type { ContextMenuTriggerProps } from '@/components/mobile/ContextMenu';
import type { Membro, TarefaWithRelations } from '../../../store';
import type { BoardColumn } from '../views/boardShared';
import { DueChip, MembroAvatar, membroOf, RepeatIcon, SubtasksCount, TagChip } from './parts';
import { TarefaActionsMenu } from './TarefaActionsMenu';
import './tarefasPhone.css';

export interface TarefaPhoneCardProps {
  tarefa: TarefaWithRelations;
  membro: Membro | null;
  now: Date;
  onOpen?: () => void;
  /** The card menu's explicit trigger ("…"), for keyboard and screen-reader users. */
  triggerProps?: ContextMenuTriggerProps;
  hideAssignee?: boolean;
  /** Static copy for the menu preview. */
  preview?: boolean;
}

/** Board card on phones (FTarefasKanban): tags, title, due chip, subtarefas, who, cliente. */
export function TarefaPhoneCard({
  tarefa,
  membro,
  now,
  onOpen,
  triggerProps,
  hideAssignee,
  preview,
}: TarefaPhoneCardProps) {
  const { t } = useTranslation('tasksPhone');
  const done = tarefa.status === 'concluida';
  const body = (
    <>
      {tarefa.tags.length > 0 && (
        <span className="phone-tar-tags">
          {tarefa.tags.map((tag) => (
            <TagChip key={tag.id} tag={tag} />
          ))}
        </span>
      )}
      <span className="phone-tar-card__title">
        {tarefa.serie && (
          <span className="phone-tar-card__repeat">
            <RepeatIcon tarefa={tarefa} />
          </span>
        )}
        {tarefa.titulo}
      </span>
      <span className="phone-tar-card__line">
        <DueChip tarefa={tarefa} now={now} withIcon />
        <SubtasksCount tarefa={tarefa} />
        {!hideAssignee && (
          <span className="phone-tar-card__who">
            <span className="phone-tar-card__who-name">
              {membro?.nome ?? t('shared.noAssignee')}
            </span>
            <MembroAvatar membro={membro} />
          </span>
        )}
      </span>
      {tarefa.cliente_nome && (
        <span className="phone-tar-card__cliente">
          <span
            className="phone-tar-card__dot"
            style={{ background: tarefa.cliente_cor || 'var(--phone-label-secondary)' }}
            aria-hidden="true"
          />
          {tarefa.cliente_nome}
        </span>
      )}
    </>
  );
  return (
    <article className="phone-tar-card" data-done={done || undefined}>
      {preview || !onOpen ? (
        <div className="phone-tar-card__main">{body}</div>
      ) : (
        <button type="button" className="phone-tar-card__main" onClick={onOpen}>
          {body}
        </button>
      )}
      {triggerProps && !preview && (
        <button
          {...triggerProps}
          className="phone-tar-card__more"
          aria-label={t('board.moreActions', { title: tarefa.titulo })}
        >
          <MoreHorizontal aria-hidden="true" />
        </button>
      )}
    </article>
  );
}

export interface TarefaPhoneBoardProps {
  columns: BoardColumn[];
  membros: Membro[];
  now: Date;
  onCardClick: (tarefa: TarefaWithRelations) => void;
  onDropCard: (tarefa: TarefaWithRelations, dropId: string) => void;
  onRefresh: () => void;
  /** Accessible name of the column chips ("Status", "Membros", "Prazos"). */
  chipsLabel?: string;
}

/**
 * The Tarefas boards on phones (Por membro, Kanban, Calendário board; D20/D30): one
 * column at a time behind a chip row, only that column rendered. Cards move through the
 * menu's "Mover para…", which calls the board's own drop handler with the target column,
 * so the write, the optimistic override and the toasts are the desktop drop's. The
 * desktop boards have no manual order, so there is no Reordenar mode and no drag here.
 */
export function TarefaPhoneBoard({
  columns,
  membros,
  now,
  onCardClick,
  onDropCard,
  onRefresh,
  chipsLabel: chipsLabelProp,
}: TarefaPhoneBoardProps) {
  const { t } = useTranslation('tasksPhone');
  const chipsLabel = chipsLabelProp ?? t('board.columns');
  const [chosen, setChosen] = useState<string | null>(null);
  const column =
    columns.find((c) => c.dropId === chosen) ??
    columns.find((c) => c.tarefas.length > 0) ??
    columns[0];
  if (!column) return null;

  const targets = columns
    .filter((c) => c.droppable !== false && c.dropId !== column.dropId)
    .map((c) => ({ id: c.dropId, label: c.title }));
  const panelId = 'phone-tar-board-panel';
  const count = column.tarefas.length;

  return (
    <div className="phone-tar-board" data-testid="phone-tarefa-board">
      <ChipRow aria-label={chipsLabel} semantics="tablist">
        {columns.map((c) => (
          <Chip
            key={c.dropId}
            label={c.title}
            count={c.tarefas.length}
            selected={c.dropId === column.dropId}
            controls={panelId}
            onClick={() => setChosen(c.dropId)}
          />
        ))}
      </ChipRow>

      <section
        id={panelId}
        role="tabpanel"
        aria-label={t('board.panelLabel', {
          column: column.title,
          tasks: t('shared.taskCount', { count }),
        })}
        className="phone-tar-board"
      >
        <div className="phone-tar-board__head">
          <h2
            className="phone-tar-board__title"
            style={column.accent ? { color: column.accent.text } : undefined}
          >
            {column.title} <span>{count}</span>
          </h2>
          {count > 0 && targets.length > 0 && (
            <span className="phone-tar-board__hint">{t('board.holdToMove')}</span>
          )}
        </div>

        {column.onAddClick && (
          <button type="button" className="phone-tar-board__add" onClick={column.onAddClick}>
            <Plus aria-hidden="true" /> {t('board.addTask')}
          </button>
        )}

        {count === 0 ? (
          <p className="phone-tar-board__empty">{t('board.empty')}</p>
        ) : (
          <ul className="phone-tar-board__list">
            {column.tarefas.map((t) => {
              const membro = membroOf(membros, t);
              return (
                <li key={t.id}>
                  <TarefaActionsMenu
                    tarefa={t}
                    moveTargets={targets}
                    onMove={(dropId) => onDropCard(t, dropId)}
                    showAssign={!column.hideAssignee}
                    onRefresh={onRefresh}
                    preview={
                      <TarefaPhoneCard
                        tarefa={t}
                        membro={membro}
                        now={now}
                        hideAssignee={column.hideAssignee}
                        preview
                      />
                    }
                  >
                    {({ triggerProps }) => (
                      <TarefaPhoneCard
                        tarefa={t}
                        membro={membro}
                        now={now}
                        hideAssignee={column.hideAssignee}
                        onOpen={() => onCardClick(t)}
                        triggerProps={triggerProps}
                      />
                    )}
                  </TarefaActionsMenu>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
