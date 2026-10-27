import { createContext, useContext, type ReactNode } from 'react';
import { Calendar as CalendarIcon, Check, CheckSquare, Repeat, User2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PessoaAvatar } from '@/components/PessoaAvatar';
import { cn } from '@/lib/utils';
import type { Membro, TarefaTag, TarefaWithRelations } from '../../../store';
import { dueBadge, type DeadlineClass } from '../tarefasLogic';
import { describeRecorrencia } from '../recorrenciaLogic';
import './tarefasPhone.css';

/**
 * What a phone row or card needs from the page to act on a tarefa beyond the view's own
 * props: open the detail screen and the edit form. Provided by TarefasPage's phone
 * branch; null outside it (the menus then leave those actions out).
 */
export interface TarefasPhoneActions {
  membros: Membro[];
  onRefresh: () => void;
  openDetail: (tarefa: TarefaWithRelations) => void;
  edit: (tarefa: TarefaWithRelations) => void;
}

export const TarefasPhoneContext = createContext<TarefasPhoneActions | null>(null);

export function useTarefasPhoneActions(): TarefasPhoneActions | null {
  return useContext(TarefasPhoneContext);
}

const TONE: Record<DeadlineClass, string | undefined> = {
  'deadline-overdue': 'overdue',
  'deadline-warning': 'warning',
  'deadline-caution': 'caution',
  'deadline-ok': undefined,
};

/** The due chip ("Hoje", "2 dias de atraso"), from the same dueBadge the desktop uses. */
export function DueChip({
  tarefa,
  now,
  withIcon,
}: {
  tarefa: TarefaWithRelations;
  now: Date;
  withIcon?: boolean;
}) {
  const badge = dueBadge(tarefa, now);
  if (!badge) return null;
  return (
    <span className="phone-tar-due" data-tone={TONE[badge.className]}>
      {withIcon && <CalendarIcon aria-hidden="true" />}
      {badge.label}
    </span>
  );
}

/** 44px completion circle (FTarefas): a real checkbox for assistive tech. */
export function TarefaCheck({
  checked,
  onToggle,
  label,
  small,
  disabled,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  small?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cn('phone-tar-check', small && 'phone-tar-check--small')}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <span className="phone-tar-check__ring" aria-hidden="true">
        {checked && <Check strokeWidth={3} />}
      </span>
    </button>
  );
}

export function MembroAvatar({ membro, large }: { membro: Membro | null; large?: boolean }) {
  if (!membro) {
    return (
      <span
        className={cn('phone-tar-avatar phone-tar-avatar--empty', large && 'phone-tar-avatar--lg')}
        aria-hidden="true"
      >
        <User2 />
      </span>
    );
  }
  return (
    <PessoaAvatar
      nome={membro.nome}
      fotoUrl={membro.avatar_url}
      seed={membro.id}
      className={cn('phone-tar-avatar', large && 'phone-tar-avatar--lg')}
    />
  );
}

export function TagChip({ tag }: { tag: TarefaTag }) {
  return (
    <span className="phone-tar-tag" style={{ background: `${tag.cor}22`, color: tag.cor }}>
      {tag.nome}
    </span>
  );
}

export function RepeatIcon({ tarefa }: { tarefa: TarefaWithRelations }) {
  const { t } = useTranslation('tasksPhone');
  if (!tarefa.serie) return null;
  return (
    <span
      role="img"
      aria-label={t('parts.recurring', { description: describeRecorrencia(tarefa.serie) })}
      className="phone-tar-meta__item"
    >
      <Repeat aria-hidden="true" />
    </span>
  );
}

export function SubtasksCount({ tarefa }: { tarefa: TarefaWithRelations }) {
  const { t } = useTranslation('tasksPhone');
  if (tarefa.subtarefas_total <= 0) return null;
  const complete = tarefa.subtarefas_concluidas === tarefa.subtarefas_total;
  return (
    <span
      className="phone-tar-meta__item"
      data-complete={complete || undefined}
      aria-label={t('parts.subtasksOf', {
        done: tarefa.subtarefas_concluidas,
        total: tarefa.subtarefas_total,
      })}
    >
      <CheckSquare aria-hidden="true" />
      {tarefa.subtarefas_concluidas}/{tarefa.subtarefas_total}
    </span>
  );
}

/** Second line of a list row: due chip · recorrência · cliente · subtarefas. */
export function TarefaMeta({ tarefa, now }: { tarefa: TarefaWithRelations; now: Date }) {
  const parts: ReactNode[] = [];
  const due = <DueChip key="due" tarefa={tarefa} now={now} />;
  if (dueBadge(tarefa, now)) parts.push(due);
  if (tarefa.serie) parts.push(<RepeatIcon key="rep" tarefa={tarefa} />);
  if (tarefa.cliente_nome)
    parts.push(
      <span key="cli" className="phone-tar-meta__item">
        {tarefa.cliente_nome}
      </span>,
    );
  if (tarefa.subtarefas_total > 0) parts.push(<SubtasksCount key="sub" tarefa={tarefa} />);
  if (parts.length === 0) return null;
  return (
    <span className="phone-tar-meta">
      {parts.map((p, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <span aria-hidden="true">·</span>}
          {p}
        </span>
      ))}
    </span>
  );
}

export function membroOf(membros: Membro[], tarefa: TarefaWithRelations): Membro | null {
  if (tarefa.responsavel_id == null) return null;
  return membros.find((m) => m.id === tarefa.responsavel_id) ?? null;
}
