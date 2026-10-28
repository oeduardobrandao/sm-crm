import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { CheckSquare, Repeat } from 'lucide-react';
import { getIntlLocale } from '@mesaas/i18n';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PessoaAvatar } from '@/components/PessoaAvatar';
import type { Membro, TarefaWithRelations } from '../../../store';
import { dueBadge, parseDateOnly, STATUS_LABELS } from '../tarefasLogic';
import { describeRecorrencia } from '../recorrenciaLogic';
import { TagPill } from './TagPicker';

const NEUTRAL_BAR = 'var(--border-color)';

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    // An engine without :focus-visible: keep the keyboard path working.
    return true;
  }
}

/**
 * One line of the desktop month grid: the client's colour as the left bar (the
 * at-a-glance client identifier), the title, and the assignee's avatar at the right.
 * Tags and the rest live in the hover card.
 */
export function TarefaChip({
  tarefa,
  membro,
  overlay,
}: {
  tarefa: TarefaWithRelations;
  membro: Membro | null;
  overlay?: boolean;
}) {
  const done = tarefa.status === 'concluida';
  return (
    <div
      data-testid="tarefa-chip"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.25rem',
        minHeight: 18,
        fontSize: '0.62rem',
        fontWeight: 600,
        lineHeight: 1.3,
        padding: '0 0.2rem 0 0.35rem',
        borderRadius: '5px',
        borderLeft: `3px solid ${tarefa.cliente_cor ?? NEUTRAL_BAR}`,
        background: 'var(--surface-2)',
        color: done ? 'var(--text-muted)' : 'var(--text-main)',
        cursor: overlay ? 'grabbing' : 'pointer',
      }}
    >
      <span
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textDecoration: done ? 'line-through' : undefined,
        }}
      >
        {tarefa.titulo}
      </span>
      {membro && (
        <PessoaAvatar
          nome={membro.nome}
          fotoUrl={membro.avatar_url}
          seed={membro.id}
          size={16}
          className="!font-extrabold"
        />
      )}
    </div>
  );
}

function CardRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', minWidth: 0 }}>
        {children}
      </span>
    </>
  );
}

/** Hover card body: everything the one-line chip leaves out. */
function TarefaChipCard({
  tarefa,
  membro,
}: {
  tarefa: TarefaWithRelations;
  membro: Membro | null;
}) {
  const { t } = useTranslation('tasks');
  const badge = dueBadge(tarefa, new Date());
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <span style={{ fontSize: '0.8rem', fontWeight: 600, lineHeight: 1.3 }}>{tarefa.titulo}</span>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          columnGap: '0.75rem',
          rowGap: '0.3rem',
          alignItems: 'center',
        }}
      >
        {tarefa.cliente_nome && (
          <CardRow label={t('calendarView.card.client')}>
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                flexShrink: 0,
                background: tarefa.cliente_cor ?? NEUTRAL_BAR,
              }}
            />
            <span className="truncate">{tarefa.cliente_nome}</span>
          </CardRow>
        )}
        <CardRow label={t('calendarView.card.assignee')}>
          {membro ? (
            <>
              <PessoaAvatar
                nome={membro.nome}
                fotoUrl={membro.avatar_url}
                seed={membro.id}
                size={16}
                className="!font-extrabold"
              />
              <span className="truncate">{membro.nome}</span>
            </>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>{t('shared.noAssignee')}</span>
          )}
        </CardRow>
        <CardRow label={t('calendarView.card.due')}>
          {tarefa.data_limite ? (
            <>
              <span>{parseDateOnly(tarefa.data_limite).toLocaleDateString(getIntlLocale())}</span>
              {badge && (
                <span
                  className={`board-card-deadline ${badge.className}`}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {badge.label}
                </span>
              )}
            </>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>{t('calendarView.card.noDue')}</span>
          )}
        </CardRow>
        <CardRow label={t('calendarView.card.status')}>{STATUS_LABELS[tarefa.status]}</CardRow>
      </div>
      {tarefa.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
          {tarefa.tags.map((tag) => (
            <TagPill key={tag.id} tag={tag} small />
          ))}
        </div>
      )}
      {(tarefa.subtarefas_total > 0 || tarefa.serie) && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem',
            color: 'var(--text-muted)',
          }}
        >
          {tarefa.subtarefas_total > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <CheckSquare className="h-3 w-3 shrink-0" aria-hidden="true" />
              {t('calendarView.card.subtasks', {
                done: tarefa.subtarefas_concluidas,
                total: tarefa.subtarefas_total,
              })}
            </span>
          )}
          {tarefa.serie && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <Repeat className="h-3 w-3 shrink-0" aria-hidden="true" />
              {describeRecorrencia(tarefa.serie)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A draggable month-grid chip with its hover card. The card opens after the
 * provider's delay on hover, or at once on keyboard focus; it is held closed while
 * any chip is being dragged (`dragging`), since dnd-kit never tells Radix to close.
 * Click or Enter/Space opens the task.
 */
export function DraggableTarefaChip({
  tarefa,
  membro,
  dragging,
  onClick,
}: {
  tarefa: TarefaWithRelations;
  membro: Membro | null;
  dragging: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: String(tarefa.id),
  });
  // dnd-kit's describedby points at keyboard-drag instructions, but no KeyboardSensor is
  // registered; dropping it lets the tooltip's own aria-describedby through the Slot merge.
  const { 'aria-describedby': _dragInstructions, ...dragAttributes } = attributes;
  const [open, setOpen] = useState(false);
  // A card that tried to open mid-drag must not pop up right after the drop.
  useEffect(() => {
    if (dragging) setOpen(false);
  }, [dragging]);

  return (
    <Tooltip
      open={dragging ? false : open}
      onOpenChange={(next) => {
        if (!dragging) setOpen(next);
      }}
    >
      <TooltipTrigger asChild>
        <div
          ref={setNodeRef}
          {...dragAttributes}
          {...listeners}
          onClick={onClick}
          // Focus opens the card only for keyboard users. Closing the task sheet hands
          // focus back to the chip that opened it; after a mouse click that focus is not
          // :focus-visible, and without this the card would pop open over the grid.
          // Default-prevented, Radix's composed onFocus skips opening.
          onFocus={(e) => {
            if (!isFocusVisible(e.currentTarget)) e.preventDefault();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClick();
            }
          }}
          style={{
            transform: CSS.Translate.toString(transform),
            opacity: isDragging ? 0.4 : 1,
            touchAction: 'none',
          }}
        >
          <TarefaChip tarefa={tarefa} membro={membro} />
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="start"
        collisionPadding={8}
        className="w-[260px] max-w-[min(260px,calc(100vw-16px))] p-3 text-left text-xs"
        style={{
          background: 'var(--card-bg)',
          color: 'var(--text-main)',
          border: '1px solid var(--border-color)',
          boxShadow: '0 8px 24px rgba(18, 21, 26, 0.12)',
        }}
      >
        <TarefaChipCard tarefa={tarefa} membro={membro} />
      </TooltipContent>
    </Tooltip>
  );
}
