import { useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isSameDay,
  startOfMonth,
  subMonths,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import type { IgAccountStatus, ScheduledPost } from '@/store';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/initials';
import { sanitizeUrl } from '@/router';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonStatus } from '@/components/ui/skeletons';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { ChipRow, Chip } from '@/components/mobile/ChipRow';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { useSheetActions } from '@/components/mobile/sheetActions';
import type { BoardCard } from '../hooks/useEntregasData';
import { dateDayKey, summarizeDay } from '../hooks/scheduledPostsUtils';
import { TIPO_LABELS } from '../postLabels';
import { PostStatusChip } from '../components/PostStatusChip';
import { ScheduleButton } from '../components/ScheduleButton';
import { toWorkflowPost } from '../components/PublicacoesPanel';
import './viewsPhone.css';

/** A fluxo deadline on the calendar: the active etapa's prazo or the fluxo's conclusão prevista. */
export interface CalendarDeadlineEvent {
  card: BoardCard;
  type: 'etapa' | 'workflow';
  date: Date;
}

const WEEK_DAYS = [
  { short: 'S', long: 'segunda' },
  { short: 'T', long: 'terça' },
  { short: 'Q', long: 'quarta' },
  { short: 'Q', long: 'quinta' },
  { short: 'S', long: 'sexta' },
  { short: 'S', long: 'sábado' },
  { short: 'D', long: 'domingo' },
];

const EVENT_LABEL: Record<CalendarDeadlineEvent['type'], string> = {
  etapa: 'Prazo da etapa',
  workflow: 'Conclusão prevista',
};

export interface CalendarViewPhoneProps {
  mode: 'entregas' | 'publicacoes';
  /** First day of the month on screen. */
  currentDate: Date;
  onMonthChange: (date: Date) => void;
  selectedDay: number | null;
  onSelectDay: (day: number) => void;
  /** Fluxos mode: the month's deadline events. */
  events: CalendarDeadlineEvent[];
  /** Fluxos mode: cards whose active etapa hasn't started, so they have no deadline yet. */
  undatedCards: BoardCard[];
  /** Fluxos mode with no cards at all after the filters. */
  noCards: boolean;
  /** Publicações mode: the month's scheduled posts by local day. */
  byDay: Map<string, ScheduledPost[]>;
  igStatuses: Map<number, IgAccountStatus>;
  postsLoading: boolean;
  openableWorkflowIds: Set<number>;
  onCardClick: (card: BoardCard) => void;
  onPostClick: (post: ScheduledPost) => void;
  onStatusChange: () => void;
  postProcessesEnabled?: boolean;
  onGoToKanban?: () => void;
}

function monthCells(month: Date): (Date | null)[] {
  const start = startOfMonth(month);
  const lead = (getDay(start) + 6) % 7; // Monday first, like the desktop MonthGrid
  const days = eachDayOfInterval({ start, end: endOfMonth(month) });
  return [...Array.from({ length: lead }, () => null), ...days];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function SomenteFluxos({ onGoToKanban }: { onGoToKanban?: () => void }) {
  return (
    <p className="phone-ent-v-note phone-ent-v-note--inline">
      Somente fluxos. Posts individuais aparecem no{' '}
      <button type="button" className="phone-ent-v-link" onClick={onGoToKanban}>
        quadro
      </button>
      .
    </p>
  );
}

function UndatedList({
  cards,
  onCardClick,
}: {
  cards: BoardCard[];
  onCardClick: (card: BoardCard) => void;
}) {
  const { closeThen } = useSheetActions();
  return (
    <GroupedList
      aria-label="Fluxos sem data"
      footer="A etapa atual destes fluxos ainda não começou, então eles ainda não têm prazo no calendário."
    >
      {cards.map((card) => (
        <Cell
          key={card.workflow.id}
          label={card.workflow.titulo}
          subtitle={`${card.cliente?.nome || 'Sem cliente'} · Etapa: ${card.etapa.nome}`}
          chevron
          onClick={() => closeThen(() => onCardClick(card))}
        />
      ))}
    </GroupedList>
  );
}

function PostRow({
  post,
  openable,
  igStatus,
  onPostClick,
  onStatusChange,
}: {
  post: ScheduledPost;
  openable: boolean;
  igStatus: IgAccountStatus | null;
  onPostClick: (post: ScheduledPost) => void;
  onStatusChange: () => void;
}) {
  const registry = useStatusRegistry();
  const safePermalink =
    post.status === 'postado' && post.instagram_permalink
      ? sanitizeUrl(post.instagram_permalink)
      : null;
  const body = (
    <>
      <span className="phone-ent-v-cal-item__time">
        {format(new Date(post.scheduled_at), 'HH:mm')}
      </span>
      <span className="phone-ent-v-cal-item__text">
        <span className="phone-ent-v-cal-item__client">
          <span className="phone-ent-v-avatar phone-ent-v-avatar--xs" aria-hidden="true">
            {getInitials(post.cliente_nome || '')}
          </span>
          <span className="phone-ent-v-cal-item__client-name">
            {post.cliente_nome || 'Sem cliente'}
          </span>
          <span className="phone-ent-v-cal-item__tipo">{TIPO_LABELS[post.tipo]}</span>
        </span>
        <span className="phone-ent-v-cal-item__title">{post.titulo || 'Post sem título'}</span>
      </span>
      <PostStatusChip post={post} registry={registry} />
    </>
  );
  return (
    <li className="phone-cell phone-ent-v-cal-item">
      {openable ? (
        <button
          type="button"
          className="phone-ent-v-cal-item__main"
          onClick={() => onPostClick(post)}
        >
          {body}
        </button>
      ) : (
        <div className="phone-ent-v-cal-item__main">{body}</div>
      )}
      {/* Same inline actions as the desktop panel; ScheduleButton renders nothing
          when the post isn't actionable, and the strip then collapses (:empty). */}
      <div className="phone-ent-v-cal-item__actions">
        <ScheduleButton
          post={toWorkflowPost(post)}
          hasInstagramAccount={igStatus != null}
          igAccountStatus={igStatus}
          tiktokSettingsComplete={false}
          tiktokIncompleteTooltip="Abra o post para configurar o TikTok"
          onStatusChange={onStatusChange}
          compact
        />
        {safePermalink && (
          <a
            href={safePermalink}
            target="_blank"
            rel="noopener noreferrer"
            className="phone-ent-v-link phone-ent-v-cal-item__permalink"
          >
            <ExternalLink aria-hidden="true" /> Ver no Instagram
          </a>
        )}
      </div>
    </li>
  );
}

/**
 * Calendário below 768px: a compact month grid with one dot per item, the selected
 * day's list under it, and (fluxos mode) a "Sem data" chip for the fluxos the desktop
 * grid can't place. Both modes keep the desktop handlers: a fluxo opens through
 * `onCardClick`, a post through `onPostClick` only when its fluxo is openable.
 */
export function CalendarViewPhone(p: CalendarViewPhoneProps) {
  const [undatedOpen, setUndatedOpen] = useState(false);
  const shownMonth = p.currentDate;
  const year = shownMonth.getFullYear();
  const month = shownMonth.getMonth();
  const today = new Date();
  const monthName = format(shownMonth, 'MMMM', { locale: ptBR });
  const cells = monthCells(shownMonth);

  const selectedDate = p.selectedDay != null ? new Date(year, month, p.selectedDay) : null;
  const selectedEvents = selectedDate
    ? p.events.filter((e) => isSameDay(e.date, selectedDate))
    : [];
  const selectedPosts = selectedDate ? (p.byDay.get(dateDayKey(selectedDate)) ?? []) : [];
  const dayHeader = selectedDate
    ? format(selectedDate, "EEEE, d 'de' MMMM", { locale: ptBR })
    : null;

  if (p.mode === 'entregas' && p.noCards) {
    return (
      <div className="phone-ent-v">
        <p className="phone-ent-v-note">Nenhuma entrega encontrada. Ajuste os filtros.</p>
        {p.postProcessesEnabled && <SomenteFluxos onGoToKanban={p.onGoToKanban} />}
      </div>
    );
  }

  const dayInfo = (date: Date): { dots: string[]; label: string } => {
    if (p.mode === 'entregas') {
      const evs = p.events.filter((e) => isSameDay(e.date, date));
      const etapas = evs.filter((e) => e.type === 'etapa').length;
      const wfs = evs.length - etapas;
      const parts = [
        etapas > 0 ? plural(etapas, 'prazo de etapa', 'prazos de etapa') : null,
        wfs > 0 ? plural(wfs, 'conclusão prevista', 'conclusões previstas') : null,
      ].filter(Boolean);
      return {
        dots: evs.slice(0, 3).map((e) => `phone-ent-v-dot--${e.type}`),
        label: parts.join(', '),
      };
    }
    const posts = p.byDay.get(dateDayKey(date)) ?? [];
    const { total, postados, falhas } = summarizeDay(posts);
    const parts = [
      total > 0 ? plural(total, 'post', 'posts') : null,
      postados > 0 ? plural(postados, 'postado', 'postados') : null,
      falhas > 0 ? plural(falhas, 'falha', 'falhas') : null,
    ].filter(Boolean);
    return {
      dots: posts
        .slice(0, 3)
        .map((post) =>
          post.status === 'falha_publicacao'
            ? 'phone-ent-v-dot--falha'
            : post.status === 'postado'
              ? 'phone-ent-v-dot--postado'
              : 'phone-ent-v-dot--post',
        ),
      label: parts.join(', '),
    };
  };

  return (
    <div className="phone-ent-v">
      {p.postProcessesEnabled && p.mode === 'entregas' && (
        <SomenteFluxos onGoToKanban={p.onGoToKanban} />
      )}

      {p.mode === 'entregas' && p.undatedCards.length > 0 && (
        <ChipRow aria-label="Fluxos sem data" className="phone-ent-v-chips">
          <Chip
            label="Sem data"
            count={p.undatedCards.length}
            onClick={() => setUndatedOpen(true)}
          />
        </ChipRow>
      )}

      <div className="phone-ent-v-cal">
        <div className="phone-ent-v-cal__head">
          <h2 className="phone-ent-v-cal__month">
            {format(shownMonth, 'MMMM yyyy', { locale: ptBR })}
          </h2>
          <span className="phone-ent-v-cal__nav">
            <button
              type="button"
              className="phone-ent-v-round-btn"
              aria-label="Mês anterior"
              onClick={() => p.onMonthChange(subMonths(shownMonth, 1))}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <button
              type="button"
              className="phone-ent-v-round-btn"
              aria-label="Próximo mês"
              onClick={() => p.onMonthChange(addMonths(shownMonth, 1))}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </span>
        </div>
        <div className="phone-ent-v-cal__weekdays" aria-hidden="true">
          {WEEK_DAYS.map((d) => (
            <span key={d.long}>{d.short}</span>
          ))}
        </div>
        <div className="phone-ent-v-cal__grid">
          {cells.map((date, i) => {
            if (!date) return <span key={`blank-${i}`} />;
            const d = date.getDate();
            const { dots, label } = dayInfo(date);
            const selected = p.selectedDay === d;
            return (
              <button
                key={d}
                type="button"
                className={cn(
                  'phone-ent-v-cal__day',
                  isSameDay(date, today) && 'phone-ent-v-cal__day--today',
                  selected && 'phone-ent-v-cal__day--selected',
                )}
                aria-pressed={selected}
                aria-label={`${d} de ${monthName}${label ? `, ${label}` : ''}`}
                onClick={() => p.onSelectDay(d)}
              >
                {d}
                <span className="phone-ent-v-cal__dots" aria-hidden="true">
                  {dots.map((cls, j) => (
                    <i key={j} className={cn('phone-ent-v-dot', cls)} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {p.mode === 'entregas' ? (
        <>
          {selectedEvents.length === 0 ? (
            <p className="phone-ent-v-empty">
              {selectedDate ? 'Nenhuma entrega neste dia.' : 'Selecione um dia.'}
            </p>
          ) : (
            <GroupedList header={dayHeader} className="phone-ent-v-group">
              {selectedEvents.map((ev, i) => (
                <Cell
                  key={`${ev.card.workflow.id}-${ev.type}-${i}`}
                  icon={
                    <i
                      className={cn(
                        'phone-ent-v-dot phone-ent-v-dot--lg',
                        `phone-ent-v-dot--${ev.type}`,
                      )}
                    />
                  }
                  label={ev.card.workflow.titulo}
                  subtitle={`${ev.card.cliente?.nome || 'Sem cliente'} · Etapa: ${ev.card.etapa.nome}`}
                  value={EVENT_LABEL[ev.type]}
                  onClick={() => p.onCardClick(ev.card)}
                />
              ))}
            </GroupedList>
          )}
          <p className="phone-ent-v-legend" aria-hidden="true">
            <span className="phone-ent-v-legend__item">
              <i className="phone-ent-v-dot phone-ent-v-dot--etapa" /> Prazo da etapa
            </span>
            <span className="phone-ent-v-legend__item">
              <i className="phone-ent-v-dot phone-ent-v-dot--workflow" /> Conclusão prevista
            </span>
          </p>
        </>
      ) : p.postsLoading ? (
        <SkeletonStatus>
          <div className="phone-ent-v-skeleton">
            {[0, 1].map((i) => (
              <div key={i} className="phone-ent-v-skeleton__row">
                <Skeleton className="h-4 w-10" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-4" style={{ width: i === 0 ? '72%' : '58%' }} />
                </div>
              </div>
            ))}
          </div>
        </SkeletonStatus>
      ) : selectedPosts.length === 0 ? (
        <p className="phone-ent-v-empty">
          {selectedDate ? 'Nenhuma publicação neste dia.' : 'Selecione um dia.'}
        </p>
      ) : (
        <GroupedList header={dayHeader} className="phone-ent-v-group">
          {selectedPosts.map((post) => (
            <PostRow
              key={post.id}
              post={post}
              // A post avulso is always openable; a wired one only while its fluxo is a loaded card.
              openable={post.workflow_id == null || p.openableWorkflowIds.has(post.workflow_id)}
              igStatus={
                post.cliente_id != null ? (p.igStatuses.get(post.cliente_id) ?? null) : null
              }
              onPostClick={p.onPostClick}
              onStatusChange={p.onStatusChange}
            />
          ))}
        </GroupedList>
      )}

      {p.mode === 'entregas' && (
        <BottomSheet
          open={undatedOpen}
          onOpenChange={setUndatedOpen}
          title={`Sem data · ${p.undatedCards.length}`}
          detents={['medium', 'large']}
        >
          <UndatedList cards={p.undatedCards} onCardClick={p.onCardClick} />
        </BottomSheet>
      )}
    </div>
  );
}
