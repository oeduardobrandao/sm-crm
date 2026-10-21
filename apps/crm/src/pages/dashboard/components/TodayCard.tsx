import type { MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
import { ListSkeleton } from '@/components/ui/skeletons';
import { PessoaAvatar } from '@/components/PessoaAvatar';
import { EmptyStateGuide } from '../../../components/help/EmptyStateGuide';
import {
  useTodayCard,
  TODAY_MAX_ROWS as MAX_ROWS,
  TODAY_PAGE_ROWS as PAGE_ROWS,
} from '../useTodayCard';
import { AGENDA_BUCKETS, type AgendaItem, type AgendaKind } from '../todayAgenda';

export const KIND_ICON: Record<AgendaKind, { Icon: typeof Flag; color?: string }> = {
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

export function initials(nome: string): string {
  const parts = nome.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function firstName(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

type TodayComplete = ReturnType<typeof useTodayCard>['complete'];

/** One agenda row (a link): tarefa checkbox or kind icon, title, context, who and the badge.
 *  Shared by the classic "Hoje" card and the Vidro grouped list, which passes a `context`
 *  without the group's own name and drops `who` when grouping by responsible. */
export function TodayRow({
  item,
  complete,
  context = item.context,
  showWho = true,
}: {
  item: AgendaItem;
  complete: TodayComplete;
  context?: string;
  showWho?: boolean;
}) {
  const { t } = useTranslation('dashboard');
  const { Icon, color } = KIND_ICON[item.kind];
  const stopNav = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <Link to={item.href} className="today-row">
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
      {context && <span className="today-row-context">{context}</span>}
      <span className="today-row-end">
        {showWho && item.responsavel && (
          <span className="today-row-who" title={item.responsavel.nome}>
            {/* .today-row-avatar keeps the neutral chip; the important font beats .avatar's breakpoint rule. */}
            <PessoaAvatar
              nome={item.responsavel.nome}
              fotoUrl={item.responsavel.avatar_url}
              seed={item.responsavel.id}
              size={20}
              className="today-row-avatar !text-[0.6rem]"
            />
            {firstName(item.responsavel.nome)}
          </span>
        )}
        {item.badge && (
          <span className={`board-card-deadline ${item.badge.className}`}>{item.badge.label}</span>
        )}
      </span>
    </Link>
  );
}

/**
 * Dashboard "Hoje": role-aware agenda of what needs attention (overdue, today,
 * next 7 days). Owners/admins see the whole workspace with who is responsible;
 * agents see only what is assigned to them. Data + role gating live in
 * useTodayAgenda; this component only renders and handles the inline
 * "concluir tarefa" mutation.
 */
export function TodayCard() {
  const {
    t,
    status,
    scope,
    buckets,
    counts,
    total,
    summary,
    visible,
    toggle,
    limits,
    showMore,
    showLess,
    complete,
  } = useTodayCard();

  const renderRow = (item: AgendaItem) => (
    <TodayRow key={item.key} item={item} complete={complete} />
  );

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

      {status === 'loading' && <ListSkeleton rows={3} />}

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
