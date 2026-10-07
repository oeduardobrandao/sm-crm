import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Palette,
  FileText,
  BookOpen,
  Lightbulb,
  ChevronRight,
  CheckSquare,
  ArrowRight,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useHub } from '../HubContext';
import { hubAgendaPeriodoQuery, hubPostsQuery, hubPostsRangeQuery } from '../queries';
import type { HubAgendaItem } from '../types';
import { HubDialog } from '../components/ui/HubDialog';
import { AgendaCard } from './agenda/AgendaCard';
import { mergeById } from '../lib/mergeById';
import { isInProduction, localMonthRange } from '../lib/postView';
import { PostCalendar } from '../components/PostCalendar';
import { DashboardSection } from '../components/dashboard/DashboardSection';
import { ClientAvatar } from '../components/ClientAvatar';
import { HomeAgenda } from './agenda/HomeAgenda';

const RESOURCE_LINKS = [
  { labelKey: 'home.resources.marca', label: 'Marca', icon: Palette, path: '/marca' },
  { labelKey: 'home.resources.paginas', label: 'Páginas', icon: FileText, path: '/paginas' },
  { labelKey: 'home.resources.briefing', label: 'Briefing', icon: BookOpen, path: '/briefing' },
  { labelKey: 'home.resources.ideias', label: 'Ideias', icon: Lightbulb, path: '/ideias' },
];

const CALENDAR_STATUSES = new Set([
  'enviado_cliente',
  'aprovado_cliente',
  'correcao_cliente',
  'agendado',
  'postado',
]);

function formatNextPost(scheduledAt: string, lang: string = 'pt-BR'): string {
  const date = new Date(scheduledAt);
  const weekday = date.toLocaleDateString(lang, { weekday: 'short' });
  const time = date.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  return `${weekday.replace('.', '')} ${time}`;
}

export function HomePage() {
  const { t, i18n } = useTranslation('hubHome');
  const { bootstrap, token } = useHub();
  const { workspace } = useParams<{ workspace: string }>();
  const navigate = useNavigate();
  const base = `/${workspace}/hub/${token}`;

  const { data, isLoading } = useQuery(hubPostsQuery(token));

  const allPosts = data?.posts ?? [];
  const pendingCount = allPosts.filter((p) => p.status === 'enviado_cliente').length;
  const posts = allPosts.filter((p) => CALENDAR_STATUSES.has(p.status) || isInProduction(p));

  // Months that start before the shell's window are fetched on demand by scheduled_at range
  // (the shell holds every post scheduled after the cutoff, so later months are complete).
  const [shown, setShown] = useState<{ year: number; month: number } | null>(null);
  const handleMonthChange = useCallback(
    (year: number, month: number) => setShown({ year, month }),
    [],
  );
  const historyCutoff = data?.historyCutoff ?? null;
  const monthRange = shown ? localMonthRange(shown.year, shown.month) : null;
  const needsRange =
    monthRange !== null &&
    historyCutoff !== null &&
    Date.parse(monthRange.from) < Date.parse(historyCutoff);
  const rangeQuery = useQuery({
    ...hubPostsRangeQuery(token, monthRange?.from ?? '', monthRange?.to ?? ''),
    enabled: needsRange,
  });
  // Plain computation: `posts` is a fresh filter every render, so a memo would never hit.
  // Shared events: every month shown, whatever historyCutoff says (the shell has none).
  const agendaAtiva = bootstrap.feature_agenda === true;
  const periodoQuery = useQuery({
    ...hubAgendaPeriodoQuery(token, monthRange?.from ?? '', monthRange?.to ?? ''),
    enabled: agendaAtiva && monthRange !== null,
  });
  const [eventoAberto, setEventoAberto] = useState<HubAgendaItem | null>(null);
  // The open card follows the month query (an answer patches it), falling back to the
  // clicked snapshot while that month refetches or after the event left it.
  const eventoAtual = eventoAberto
    ? (periodoQuery.data?.find((i) => i.ocorrencia_id === eventoAberto.ocorrencia_id) ??
      eventoAberto)
    : null;

  const calendarPosts = mergeById(posts, needsRange ? (rangeQuery.data?.posts ?? []) : []).filter(
    (p) => CALENDAR_STATUSES.has(p.status) || isInProduction(p),
  );

  const now = new Date();
  const thisMonthCount = allPosts.filter((p) => {
    if (!p.scheduled_at) return false;
    const d = new Date(p.scheduled_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;

  const decided = allPosts.filter(
    (p) => p.status === 'aprovado_cliente' || p.status === 'correcao_cliente',
  );
  const approvalRate =
    decided.length === 0
      ? '—'
      : `${Math.round((decided.filter((p) => p.status === 'aprovado_cliente').length / decided.length) * 100)}%`;

  const upcoming = allPosts
    .filter((p) => p.scheduled_at && new Date(p.scheduled_at) >= now)
    .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''));
  const nextPost = upcoming[0];

  const firstName = bootstrap.cliente_nome.split(' ')[0];
  const dateLocale = i18n.language === 'en' ? 'en-US' : 'pt-BR';

  const kpis = [
    {
      label: t('home.kpi.postsThisMonth.label', 'Posts este mês'),
      value: String(thisMonthCount),
      hint: t('home.kpi.postsThisMonth.hint', 'Feed, Reels, Stories'),
    },
    {
      label: t('home.kpi.pendingApprovals.label', 'Aprovações pendentes'),
      value: String(pendingCount),
      hint: pendingCount
        ? t('home.kpi.pendingApprovals.hintCount', '{{count}} para revisar', {
            count: pendingCount,
          })
        : t('home.kpi.pendingApprovals.hintZero', 'Tudo em dia'),
      onClick: () => navigate(`${base}/aprovacoes`),
    },
    {
      label: t('home.kpi.approvalRate.label', 'Taxa de aprovação'),
      value: approvalRate,
      hint: t('home.kpi.approvalRate.hint', 'Aprovados vs. correção'),
    },
    {
      label: t('home.kpi.nextPost.label', 'Próximo post'),
      value: nextPost ? formatNextPost(nextPost.scheduled_at!, dateLocale) : '—',
      hint: nextPost?.titulo ?? t('home.kpi.nextPost.hintEmpty', 'Nada agendado'),
    },
  ];

  return (
    <div className="hub-fade-up flex flex-col gap-6">
      <section>
        <ClientAvatar
          name={bootstrap.cliente_nome}
          photoUrl={bootstrap.cliente_foto_url}
          size={128}
        />
        <p className="text-[13px] font-medium hub-tx3 mb-1.5 mt-4">{bootstrap.workspace.name}</p>
        <h1 className="font-display font-medium text-[clamp(2rem,5vw,3rem)] leading-[1.04] tracking-tight hub-txt mb-1.5">
          {t('home.greeting', 'Olá,')} <em className="italic font-normal">{firstName}</em> 👋
        </h1>
      </section>

      <section
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
      >
        {kpis.map((k) => {
          const content = (
            <>
              <div>
                <div className="text-[15px] font-semibold tracking-tight hub-txt">{k.label}</div>
                <div className="text-[12.5px] hub-tx3 mt-0.5">{k.hint}</div>
              </div>
              <div className="font-display text-[2.1rem] font-medium tracking-tight leading-none hub-txt mt-3.5">
                {k.value}
              </div>
            </>
          );
          return k.onClick ? (
            <button
              key={k.label}
              type="button"
              onClick={k.onClick}
              className="hub-card hub-card-hover cursor-pointer p-4 text-left w-full flex flex-col justify-between"
            >
              {content}
            </button>
          ) : (
            <div key={k.label} className="hub-card p-4 flex flex-col justify-between">
              {content}
            </div>
          );
        })}
      </section>

      {pendingCount > 0 && (
        <button
          type="button"
          onClick={() => navigate(`${base}/aprovacoes`)}
          className="hub-fade-up w-full flex items-center gap-3 px-5 py-3.5 rounded-2xl text-left group transition-shadow hover:shadow-sm"
          style={{
            background: 'color-mix(in srgb, var(--hub-txt) 5%, transparent)',
            border: '1px solid color-mix(in srgb, var(--hub-txt) 14%, transparent)',
          }}
        >
          <span
            className="flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0"
            style={{
              background: 'color-mix(in srgb, var(--hub-txt) 10%, transparent)',
              color: 'var(--hub-txt)',
            }}
          >
            <CheckSquare size={16} strokeWidth={2} />
          </span>
          <span className="flex-1 text-sm font-medium hub-txt">
            {pendingCount === 1
              ? t('home.pendingBanner.singular', 'Você tem 1 post aguardando aprovação')
              : t('home.pendingBanner.plural', 'Você tem {{count}} posts aguardando aprovação', {
                  count: pendingCount,
                })}
          </span>
          <ArrowRight
            size={16}
            className="hub-tx3 group-hover:translate-x-0.5 transition-transform flex-shrink-0"
          />
        </button>
      )}

      {bootstrap.feature_agenda && <HomeAgenda token={token} base={base} />}

      <section className="hub-card p-5">
        <h3 className="font-semibold text-[16px] tracking-tight hub-txt">
          {t('home.calendarSection.title', 'Calendário')}
        </h3>
        <div className="text-[12.5px] hub-tx3 mt-0.5 mb-2.5">
          {t('home.calendarSection.subtitle', 'Próximas publicações')}
        </div>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin h-5 w-5 rounded-full border-2 border-stone-300 border-t-stone-900" />
          </div>
        ) : (
          <PostCalendar
            posts={calendarPosts}
            eventos={agendaAtiva ? (periodoQuery.data ?? []) : undefined}
            eventosErro={agendaAtiva && periodoQuery.isError && !periodoQuery.isFetching}
            onRetryEventos={() => void periodoQuery.refetch()}
            onEventoClick={setEventoAberto}
            onMonthChange={handleMonthChange}
            loading={needsRange && rangeQuery.isFetching}
            notice={
              needsRange && rangeQuery.isError && !rangeQuery.isFetching ? (
                <p className="mb-3 flex items-center gap-2 text-[12.5px] hub-tx2">
                  {t('calendar.rangeError', 'Não foi possível carregar este mês.')}
                  <button
                    type="button"
                    onClick={() => void rangeQuery.refetch()}
                    className="font-semibold underline"
                  >
                    {t('calendar.rangeRetry', 'Tentar novamente')}
                  </button>
                </p>
              ) : null
            }
          />
        )}
      </section>

      {eventoAtual && (
        <HubDialog open onRequestClose={() => setEventoAberto(null)} title={eventoAtual.titulo}>
          {/* Bottom sheet on mobile, centered card on desktop. */}
          <div className="w-full md:max-w-[520px] self-end md:self-center max-h-full overflow-y-auto px-3 pb-3 md:p-0">
            <div className="flex justify-end mb-2">
              <button
                type="button"
                onClick={() => setEventoAberto(null)}
                aria-label={t('calendar.fecharEvento', 'Fechar')}
                className="w-9 h-9 rounded-full flex items-center justify-center bg-[var(--hub-card)] hub-txt shadow-sm"
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>
            <AgendaCard item={eventoAtual} token={token} agora={Date.now()} />
          </div>
        </HubDialog>
      )}

      <section className="hub-card p-5">
        <h3 className="font-semibold text-[16px] tracking-tight hub-txt">
          {t('home.resources.title', 'Recursos')}
        </h3>
        <div className="text-[12.5px] hub-tx3 mt-0.5 mb-2.5">
          {t('home.resources.subtitle', 'Acesso rápido')}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {RESOURCE_LINKS.map(({ labelKey, label, icon: Icon, path }) => (
            <button
              key={path}
              onClick={() => navigate(`${base}${path}`)}
              className="flex flex-col items-start gap-2.5 p-3.5 rounded-xl border hub-border text-left hover:border-[var(--hub-bd2)] hover:shadow-sm transition-all group"
            >
              <span className="w-8 h-8 rounded-lg hub-bg-soft flex items-center justify-center hub-tx2 flex-shrink-0">
                <Icon size={16} strokeWidth={1.75} />
              </span>
              <span className="flex items-center gap-1 text-[14px] font-medium hub-txt">
                {t(labelKey, label)}
                <ChevronRight
                  size={14}
                  className="hub-tx3 group-hover:translate-x-0.5 transition-transform"
                />
              </span>
            </button>
          ))}
        </div>
      </section>

      <DashboardSection />
    </div>
  );
}
