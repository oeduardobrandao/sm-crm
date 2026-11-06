import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Chip, ChipRow } from '@/components/mobile/ChipRow';
import { ListSkeleton } from '@/components/ui/skeletons';
import { KIND_ICON, firstName } from '../components/TodayCard';
import { TODAY_MAX_ROWS, TODAY_PAGE_ROWS, type useTodayCard } from '../useTodayCard';
import { AGENDA_BUCKETS, type AgendaBucket, type AgendaItem } from '../todayAgenda';
import { PhoneSection } from './PhoneSection';

type TodayState = ReturnType<typeof useTodayCard>;

/** Bucket toggles under the page title (FInicio): which groups of "Hoje" are shown. */
export function TodayChips({ today }: { today: TodayState }) {
  const { t, status, counts, visible, toggle } = today;
  if (status !== 'ready') return null;
  return (
    <ChipRow aria-label={t('today.title', 'Hoje')} className="phone-home-chips">
      {AGENDA_BUCKETS.map((b) => (
        <Chip
          key={b}
          label={t(`today.buckets.${b}`)}
          count={counts[b]}
          selected={visible.has(b)}
          onClick={() => toggle(b)}
        />
      ))}
    </ChipRow>
  );
}

function TodayRow({ item, today }: { item: AgendaItem; today: TodayState }) {
  const { t, complete } = today;
  const { Icon, color } = KIND_ICON[item.kind];
  const isTarefa = item.kind === 'tarefa' && item.tarefaId != null;
  const context = [item.context, item.responsavel ? firstName(item.responsavel.nome) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className="phone-home-row">
      {isTarefa ? (
        <button
          type="button"
          className="phone-home-row__check"
          aria-label={t('today.markDone', 'Concluir tarefa')}
          disabled={complete.isPending}
          onClick={() =>
            complete.mutate({
              id: item.tarefaId!,
              previousStatus: item.tarefaStatus ?? 'pendente',
            })
          }
        >
          <span className="phone-home-row__ring" aria-hidden="true">
            <Check />
          </span>
        </button>
      ) : (
        <span className="phone-home-row__icon" aria-hidden="true">
          <Icon style={color ? { color } : undefined} />
        </span>
      )}
      <Link to={item.href} className="phone-home-row__link">
        <span className="phone-home-row__text">
          <span className="phone-home-row__title">{item.title}</span>
          {context && <span className="phone-home-row__context">{context}</span>}
        </span>
        {item.badge && (
          <span className={`board-card-deadline phone-home-badge ${item.badge.className}`}>
            {item.badge.label}
          </span>
        )}
      </Link>
    </li>
  );
}

function BucketGroup({
  bucket,
  today,
  trailing,
}: {
  bucket: AgendaBucket;
  today: TodayState;
  trailing?: ReactNode;
}) {
  const { t, buckets, counts, limits, showMore, showLess } = today;
  const items = buckets[bucket].slice(0, limits[bucket]);
  const remaining = counts[bucket] - limits[bucket];
  return (
    <PhoneSection
      title={`${t(`today.buckets.${bucket}`)} · ${counts[bucket]}`}
      tone={bucket === 'atrasado' ? 'danger' : undefined}
      trailing={trailing}
      data-bucket={bucket}
    >
      {items.map((item) => (
        <TodayRow key={item.key} item={item} today={today} />
      ))}
      {remaining > 0 && (
        <li className="phone-home-row">
          <button type="button" className="phone-home-more" onClick={() => showMore(bucket)}>
            {t('today.more', { count: Math.min(TODAY_PAGE_ROWS, remaining), remaining })}
          </button>
        </li>
      )}
      {limits[bucket] > TODAY_MAX_ROWS && (
        <li className="phone-home-row">
          <button type="button" className="phone-home-more" onClick={() => showLess(bucket)}>
            {t('today.less', 'Mostrar menos')}
          </button>
        </li>
      )}
    </PhoneSection>
  );
}

/** "Hoje" on phones: one grouped section per visible bucket, the tarefa check as the
 *  leading accessory (same mutation and undo toast as the desktop card). */
export function TodayPhone({ today }: { today: TodayState }) {
  const { t, status, scope, counts, total, visible } = today;
  const calendarLink = (
    <Link to="/calendario" className="phone-home-link">
      {t('today.calendar', 'Calendário')}
    </Link>
  );

  if (status === 'loading') {
    return (
      <div className="phone-home-card" data-testid="today-phone">
        <ListSkeleton rows={3} />
      </div>
    );
  }
  if (status !== 'ready') {
    const note =
      status === 'role_error'
        ? t(
            'today.roleError',
            'Não foi possível carregar seu papel neste workspace. Recarregue a página.',
          )
        : status === 'no_membership'
          ? t(
              'today.noMembership',
              'Você não tem mais acesso a este workspace. Troque de workspace ou peça a um administrador para convidar você de novo.',
            )
          : t(
              'agentPending.semVinculo',
              'Seu usuário ainda não está vinculado a um membro da equipe. Peça a um administrador para fazer o vínculo na página Equipe.',
            );
    return (
      <p className="phone-home-note" data-testid="today-phone">
        {note}
      </p>
    );
  }

  if (total === 0) {
    return (
      <PhoneSection title={t('today.title', 'Hoje')} trailing={calendarLink}>
        <li className="phone-home-row">
          <span className="phone-home-empty">
            {scope === 'mine'
              ? t('today.emptyMine', 'Nada para hoje. Bom trabalho!')
              : t('today.empty', 'Nada para hoje.')}
          </span>
        </li>
        <li className="phone-home-row">
          <Link to="/calendario" className="phone-home-row__link phone-home-row__link--action">
            {t('today.emptyAction', 'Ver calendário')}
          </Link>
        </li>
      </PhoneSection>
    );
  }

  const shown = AGENDA_BUCKETS.filter((b) => visible.has(b) && counts[b] > 0);
  if (shown.length === 0) {
    return (
      <p className="phone-home-note" data-testid="today-phone">
        {t('today.title', 'Hoje')}: {calendarLink}
      </p>
    );
  }
  return (
    <div data-testid="today-phone">
      {shown.map((b, i) => (
        <BucketGroup key={b} bucket={b} today={today} trailing={i === 0 ? calendarLink : null} />
      ))}
    </div>
  );
}
