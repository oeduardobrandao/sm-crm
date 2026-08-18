import { useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Cake,
  CalendarCheck,
  ClipboardList,
  Flag,
  MailQuestion,
  PencilLine,
  Send,
  Star,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { EmptyStateGuide } from '../../../components/help/EmptyStateGuide';
import { updateTarefa, type TarefaStatus, type TarefaWithRelations } from '../../../store';
import { useTodayAgenda } from '../useTodayAgenda';
import {
  AGENDA_BUCKETS,
  type AgendaBucket,
  type AgendaItem,
  type AgendaKind,
} from '../todayAgenda';

const MAX_ROWS = 8;
const PAGE_ROWS = 20;

const KIND_ICON: Record<AgendaKind, { Icon: typeof Flag; color?: string }> = {
  tarefa: { Icon: ClipboardList },
  etapa: { Icon: Flag, color: 'var(--warning)' },
  post_agendado: { Icon: Send },
  post_aguardando_cliente: { Icon: MailQuestion },
  post_pendente: { Icon: PencilLine },
  income: { Icon: ArrowUpRight, color: 'var(--success)' },
  expense: { Icon: ArrowDownLeft, color: 'var(--danger)' },
  birthday: { Icon: Cake, color: 'var(--pink, #ec4899)' },
  data: { Icon: Star, color: 'var(--info, #6366f1)' },
};

function initials(nome: string): string {
  const parts = nome.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

function firstName(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

interface CompleteVars {
  id: number;
  previousStatus: TarefaStatus;
}

/**
 * Dashboard "Hoje": role-aware agenda of what needs attention (overdue, today,
 * next 7 days). Owners/admins see the whole workspace with who is responsible;
 * agents see only what is assigned to them. Data + role gating live in
 * useTodayAgenda; this component only renders and handles the inline
 * "concluir tarefa" mutation.
 */
export function TodayCard() {
  const { t } = useTranslation('dashboard');
  const queryClient = useQueryClient();
  const { status, scope, buckets, now } = useTodayAgenda();
  const [visible, setVisible] = useState<Set<AgendaBucket>>(
    () => new Set<AgendaBucket>(['atrasado', 'hoje']),
  );
  // Rows shown per bucket beyond the initial cap; expands in place, never navigates.
  const [limits, setLimits] = useState<Record<AgendaBucket, number>>({
    atrasado: MAX_ROWS,
    hoje: MAX_ROWS,
    proximos: MAX_ROWS,
  });
  const showMore = (b: AgendaBucket) =>
    setLimits((prev) => ({ ...prev, [b]: prev[b] + PAGE_ROWS }));
  const showLess = (b: AgendaBucket) => setLimits((prev) => ({ ...prev, [b]: MAX_ROWS }));

  const complete = useMutation({
    mutationFn: ({ id }: CompleteVars) => updateTarefa(id, { status: 'concluida' }),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ['tarefas'] });
      const previous = queryClient.getQueryData<TarefaWithRelations[]>(['tarefas']);
      queryClient.setQueryData<TarefaWithRelations[]>(['tarefas'], (old) =>
        (old ?? []).map((task) => (task.id === id ? { ...task, status: 'concluida' } : task)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['tarefas'], ctx.previous);
      toast.error(t('today.taskDoneError', 'Não foi possível concluir a tarefa.'));
    },
    onSuccess: (_data, { id, previousStatus }) => {
      toast.success(t('today.taskDone', 'Tarefa concluída'), {
        action: {
          label: t('today.taskDoneUndo', 'Desfazer'),
          onClick: () => undo.mutate({ id, status: previousStatus }),
        },
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tarefas'] });
    },
  });

  const undo = useMutation({
    mutationFn: ({ id, status }: { id: number; status: TarefaStatus }) =>
      updateTarefa(id, { status }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tarefas'] });
    },
  });

  const toggle = (b: AgendaBucket) =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });

  const counts = {
    atrasado: buckets.atrasado.length,
    hoje: buckets.hoje.length,
    proximos: buckets.proximos.length,
  };
  const total = counts.atrasado + counts.hoje + counts.proximos;

  const dateLabel = format(now, "EEEE, d 'de' MMMM", { locale: ptBR });
  const summary = [
    dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1),
    t('today.summary', { overdue: counts.atrasado, today: counts.hoje }),
    scope === 'mine' ? t('today.mine', 'atribuídos a você') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const stopNav = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const renderRow = (item: AgendaItem) => {
    const { Icon, color } = KIND_ICON[item.kind];
    return (
      <Link key={item.key} to={item.href} className="today-row">
        {item.kind === 'tarefa' && item.tarefaId != null ? (
          <span onClick={stopNav} className="today-row-check">
            <Checkbox
              aria-label={t('today.markDone', 'Concluir tarefa')}
              checked={false}
              disabled={complete.isPending}
              onCheckedChange={() =>
                complete.mutate({
                  id: item.tarefaId!,
                  previousStatus: item.tarefaStatus ?? 'pendente',
                })
              }
            />
          </span>
        ) : (
          <Icon className="today-row-icon" style={color ? { color } : undefined} aria-hidden />
        )}
        <span className="today-row-title">{item.title}</span>
        {item.context && <span className="today-row-context">{item.context}</span>}
        <span className="today-row-end">
          {item.responsavel && (
            <span className="today-row-who" title={item.responsavel.nome}>
              <span className="today-row-avatar">{initials(item.responsavel.nome)}</span>
              {firstName(item.responsavel.nome)}
            </span>
          )}
          {item.badge && (
            <span className={`board-card-deadline ${item.badge.className}`}>
              {item.badge.label}
            </span>
          )}
        </span>
      </Link>
    );
  };

  return (
    <div className="card today-card animate-up" data-testid="today-card">
      <div className="today-head">
        <h3 className="today-title">
          <CalendarCheck className="h-4 w-4" aria-hidden />
          {t('today.title', 'Hoje')}
        </h3>
        <Link to="/calendario" className="today-cal-link">
          {t('today.calendar', 'Calendário')} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
      <p className="today-sub">{summary}</p>

      {status === 'loading' && (
        <div style={{ textAlign: 'center', padding: '1.5rem' }}>
          <Spinner size="md" />
        </div>
      )}

      {status === 'role_error' && (
        <p className="today-note">
          {t(
            'today.roleError',
            'Não foi possível carregar seu papel neste workspace. Recarregue a página.',
          )}
        </p>
      )}

      {status === 'no_membership' && (
        <p className="today-note">
          {t(
            'today.noMembership',
            'Você não tem mais acesso a este workspace. Troque de workspace ou peça a um administrador para convidar você de novo.',
          )}
        </p>
      )}

      {status === 'membro_missing' && (
        <p className="today-note">
          {t(
            'agentPending.semVinculo',
            'Seu usuário ainda não está vinculado a um membro da equipe. Peça a um administrador para fazer o vínculo na página Equipe.',
          )}
        </p>
      )}

      {status === 'ready' && (
        <>
          <div className="today-chips" role="group" aria-label={t('today.title', 'Hoje')}>
            {AGENDA_BUCKETS.map((b) => (
              <button
                key={b}
                type="button"
                className={`today-chip${b === 'atrasado' && counts[b] > 0 ? ' is-danger' : ''}${counts[b] === 0 ? ' is-empty' : ''}`}
                aria-pressed={visible.has(b)}
                onClick={() => toggle(b)}
              >
                {t(`today.buckets.${b}`)} <span className="today-chip-n">{counts[b]}</span>
              </button>
            ))}
          </div>

          {total === 0 ? (
            <EmptyStateGuide
              icon="📅"
              title={
                scope === 'mine'
                  ? t('today.emptyMine', 'Nada para hoje. Bom trabalho!')
                  : t('today.empty', 'Nada para hoje.')
              }
              description=""
              actionLabel={t('today.emptyAction', 'Ver calendário')}
              actionHref="/calendario"
            />
          ) : (
            AGENDA_BUCKETS.filter((b) => visible.has(b) && counts[b] > 0).map((b) => (
              <section key={b} className="today-group" data-bucket={b}>
                <h4 className={`today-group-label${b === 'atrasado' ? ' is-danger' : ''}`}>
                  {t(`today.buckets.${b}`)}
                  <span className="today-group-count">{counts[b]}</span>
                </h4>
                <div className="today-list">{buckets[b].slice(0, limits[b]).map(renderRow)}</div>
                {(counts[b] > limits[b] || limits[b] > MAX_ROWS) && (
                  <div className="today-more-row">
                    {counts[b] > limits[b] && (
                      <button type="button" className="today-more" onClick={() => showMore(b)}>
                        {t('today.more', {
                          count: Math.min(PAGE_ROWS, counts[b] - limits[b]),
                          remaining: counts[b] - limits[b],
                        })}
                      </button>
                    )}
                    {limits[b] > MAX_ROWS && (
                      <button type="button" className="today-more" onClick={() => showLess(b)}>
                        {t('today.less', 'Mostrar menos')}
                      </button>
                    )}
                  </div>
                )}
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}
