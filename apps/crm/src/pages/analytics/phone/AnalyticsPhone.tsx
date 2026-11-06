import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { AlertTriangle, ArrowUpDown, Check, RefreshCw } from 'lucide-react';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { BarList } from '@/components/mobile/BarList';
import {
  getPortfolioAIAnalysis,
  type PortfolioAccount,
  type PortfolioTopPost,
} from '../../../services/analytics';
import { formatRate } from '../../../lib/ig-rates';
import { Avatar, PickerChip, SectionHead, fmtNumber, mediaTypeLabel } from './shared';
import { RankedPostStrip } from './RankedPostStrip';
import { AllPostsSheet, type AllPostsRow } from './AllPostsSheet';
import {
  AIAnalysisPhone,
  priorityTone,
  useAIAnalysis,
  type AITone,
  type AIAnalysisView,
} from './AIAnalysisPhone';

export type AccountSortCol =
  | 'client_name'
  | 'follower_count'
  | 'engagement_rate_avg'
  | 'impressions_28d'
  | 'reach_28d'
  | 'alcance_seg'
  | 'posts_last_30d'
  | 'website_clicks_28d'
  | 'last_post_at';

const SORT_LABELS: Record<AccountSortCol, string> = {
  client_name: 'Nome',
  follower_count: 'Seguidores',
  engagement_rate_avg: 'Engajamento',
  impressions_28d: 'Visualizações (28d)',
  reach_28d: 'Alcance (28d)',
  alcance_seg: 'Alcance / Seg.',
  posts_last_30d: 'Posts (30d)',
  website_clicks_28d: 'Cliques no link',
  last_post_at: 'Último post',
};

const ORDER_OPTIONS = [
  { value: 'views', label: 'Visualizações' },
  { value: 'reach', label: 'Alcance' },
  { value: 'engagement', label: 'Engajamento' },
  { value: 'likes', label: 'Curtidas' },
  { value: 'comments', label: 'Comentários' },
  { value: 'saved', label: 'Salvos' },
  { value: 'share_rate', label: 'Compart./visualização' },
  { value: 'like_rate', label: 'Curt./visualização' },
  { value: 'save_rate', label: 'Salvos/visualização' },
  { value: 'comment_rate', label: 'Coment./visualização' },
  { value: 'date', label: 'Data' },
];
const RATE_KEYS = ['share_rate', 'like_rate', 'save_rate', 'comment_rate'] as const;
type RateOrder = (typeof RATE_KEYS)[number];
const RATE_SHORT: Record<RateOrder, string> = {
  share_rate: 'Compart.',
  like_rate: 'Curt.',
  save_rate: 'Salvos',
  comment_rate: 'Coment.',
};

const FORMAT_OPTIONS = [
  { value: 'IMAGE', label: 'Imagem' },
  { value: 'VIDEO', label: 'Reels' },
  { value: 'CAROUSEL_ALBUM', label: 'Carrossel' },
];

const PERIOD_OPTIONS = [
  { value: 7, label: '7 dias' },
  { value: 28, label: '28 dias' },
  { value: 90, label: '90 dias' },
];

const formatPct = (v: number) => (v === 0 ? '—' : `${v.toFixed(2).replace('.', ',')}%`);

function daysSince(iso: string | null): number | null {
  return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;
}

function sortValueLabel(a: PortfolioAccount, col: AccountSortCol): string {
  switch (col) {
    case 'engagement_rate_avg':
      return formatPct(a.engagement_rate_avg);
    case 'impressions_28d':
      return fmtNumber(a.impressions_28d);
    case 'reach_28d':
      return fmtNumber(a.reach_28d);
    case 'alcance_seg':
      return a.follower_count > 0
        ? `${((a.reach_28d / a.follower_count) * 100).toFixed(1).replace('.', ',')}%`
        : '0,0%';
    case 'posts_last_30d':
      return String(a.posts_last_30d);
    case 'website_clicks_28d':
      return fmtNumber(a.website_clicks_28d ?? 0);
    case 'last_post_at': {
      const d = daysSince(a.last_post_at);
      return d === null ? 'Sem posts' : `${d}d atrás`;
    }
    default:
      return fmtNumber(a.follower_count);
  }
}

export interface AnalyticsDrawerState {
  mode: 'best' | 'worst' | null;
  open: (mode: 'best' | 'worst') => void;
  close: () => void;
  posts: PortfolioTopPost[];
  /** Posts the open list draws from (all ranked, or the mature ones for "worst"). */
  total: number;
  orderBy: string;
  setOrderBy: (v: string) => void;
  asc: boolean;
  setAsc: (v: boolean) => void;
  format: string;
  setFormat: (v: string) => void;
  client: string;
  setClient: (v: string) => void;
  clients: string[];
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
}

export interface AnalyticsPhoneProps {
  /** Accounts after the cliente filter. */
  accounts: PortfolioAccount[];
  sortedAccounts: PortfolioAccount[];
  clientOptions: PortfolioAccount[];
  clienteFilter: string;
  onClienteFilter: (v: string) => void;
  days: number;
  onDays: (d: number) => void;
  syncing: boolean;
  canSync: boolean;
  onSync: () => void;
  syncResult: { success: number; failed: number; failedNames: string[] } | null;
  silentAccounts: PortfolioAccount[];
  /** The page's KPI grid; `StatCardGrid` renders it as the phone tile strip. */
  kpis: ReactNode;
  bestPosts: PortfolioTopPost[];
  worstPosts: PortfolioTopPost[];
  sortColumn: AccountSortCol;
  sortDirection: 'asc' | 'desc';
  onSortColumn: (c: AccountSortCol) => void;
  onToggleDirection: () => void;
  specialtyStats: {
    specialty: string;
    count: number;
    avgEngagement: number;
    avgFollowers: number;
  }[];
  drawer: AnalyticsDrawerState;
}

/** /analytics below 768px (FAnalytics mockup). The page keeps every hook and number. */
export function AnalyticsPhone(props: AnalyticsPhoneProps) {
  const {
    accounts,
    sortedAccounts,
    clientOptions,
    clienteFilter,
    onClienteFilter,
    days,
    onDays,
    syncing,
    canSync,
    onSync,
    syncResult,
    silentAccounts,
    kpis,
    bestPosts,
    worstPosts,
    sortColumn,
    sortDirection,
    onSortColumn,
    onToggleDirection,
    specialtyStats,
    drawer,
  } = props;
  const [sortOpen, setSortOpen] = useState(false);
  const sortButtonRef = useRef<HTMLButtonElement>(null);

  const clientLabel =
    clienteFilter === 'all'
      ? 'Todos'
      : (clientOptions.find((a) => String(a.client_id) === clienteFilter)?.client_name ?? 'Todos');

  const subtitle = (
    <>
      {accounts.length === 1 ? '1 conta' : `${accounts.length} contas`} · {days} dias
      {syncing && <span className="phone-an-subtitle-line">Sincronizando…</span>}
      {!syncing && syncResult && (
        <span
          role="status"
          className={`phone-an-subtitle-line ${syncResult.failed > 0 ? 'phone-an-tone--warn' : 'phone-an-tone--up'}`}
        >
          {syncResult.success} sincronizada{syncResult.success !== 1 ? 's' : ''}
          {syncResult.failed > 0 &&
            `, ${syncResult.failed} falhou: ${syncResult.failedNames.join(', ')}`}
        </span>
      )}
    </>
  );

  const ai = useAIAnalysis(
    useCallback(async () => {
      const result = await getPortfolioAIAnalysis();
      if (!result || result.analysis.error) {
        throw new Error('Não foi possível gerar a análise. Tente novamente.');
      }
      return { ...result.analysis, generatedAt: result.generatedAt };
    }, []),
    useCallback(
      (e: unknown) =>
        e instanceof Error && e.message.startsWith('Não foi possível')
          ? e.message
          : 'Erro ao gerar análise. Tente novamente.',
      [],
    ),
  );
  const aiView = useMemo(() => portfolioAIView(ai.result), [ai.result]);

  const benchmarkAvg =
    accounts.length > 0
      ? accounts.reduce((s, a) => s + a.engagement_rate_avg, 0) / accounts.length
      : 0;

  const drawerRows: AllPostsRow[] = drawer.posts.map((post) => {
    const rateKey = (RATE_KEYS as readonly string[]).includes(drawer.orderBy)
      ? (drawer.orderBy as RateOrder)
      : null;
    return {
      key: post.id,
      href: post.permalink,
      thumbnailUrl: post.thumbnail_url,
      mediaType: post.media_type,
      title: post.client_name,
      meta: `${format(new Date(post.posted_at), "d 'de' MMM", { locale: ptBR })} · ${mediaTypeLabel(post.media_type)}`,
      metrics: (
        <>
          <span>
            Visualizações <strong>{fmtNumber(post.views)}</strong>
          </span>
          <span>
            Eng. <strong>{formatPct(post.engagement_rate)}</strong>
          </span>
          {rateKey && (
            <span>
              {RATE_SHORT[rateKey]}/visualização <strong>{formatRate(post.rates[rateKey])}</strong>
            </span>
          )}
          <span>
            Curtidas <strong>{fmtNumber(post.likes)}</strong>
          </span>
          <span>
            Coment. <strong>{fmtNumber(post.comments)}</strong>
          </span>
          <span>
            Salvos <strong>{fmtNumber(post.saved)}</strong>
          </span>
        </>
      ),
    };
  });

  return (
    <div className="phone-kit phone-an">
      <PhonePageHeader
        title="Analytics"
        subtitle={subtitle}
        actions={
          <PhoneIconButton
            label="Sincronizar todas as contas"
            onClick={onSync}
            disabled={syncing || !canSync}
            aria-busy={syncing || undefined}
          >
            <RefreshCw aria-hidden="true" className={syncing ? 'phone-an-spin' : undefined} />
          </PhoneIconButton>
        }
      />

      <div className="phone-an-chips">
        <PickerChip<string>
          label="Cliente"
          valueLabel={clientLabel}
          sheetTitle="Cliente"
          options={clientOptions.map((a) => ({ value: String(a.client_id), label: a.client_name }))}
          value={clienteFilter === 'all' ? null : clienteFilter}
          onChange={(v) => onClienteFilter(v ?? 'all')}
          emptyOption={{ label: 'Todos os clientes' }}
          searchable={clientOptions.length > 8}
        />
        <PickerChip<number>
          label="Período"
          valueLabel={`${days} dias`}
          options={PERIOD_OPTIONS}
          value={days}
          onChange={(v) => v !== null && onDays(v)}
        />
      </div>

      {silentAccounts.length > 0 && (
        <section className="phone-an-callout" aria-label="Contas silenciosas" role="status">
          <div className="phone-an-callout__head">
            <AlertTriangle aria-hidden="true" />
            <h2 className="phone-an-callout__title">Contas silenciosas</h2>
          </div>
          <p className="phone-an-callout__text">
            {silentAccounts.length === 1
              ? '1 conta sem postar no período'
              : `${silentAccounts.length} contas sem postar no período`}
          </p>
          <div className="phone-an-callout__chips">
            {silentAccounts.map((a) => {
              const d = daysSince(a.last_post_at);
              return (
                <Link
                  key={a.client_id}
                  to={`/analytics/${a.client_id}`}
                  className="phone-an-silent-chip"
                >
                  <Avatar initials={a.client_sigla} color={a.client_cor} />
                  {a.client_name}
                  <span className="phone-an-badge phone-an-badge--warn">
                    {d !== null ? `${d}d sem postar` : 'Sem posts'}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {kpis}

      <RankedPostStrip
        title="Melhores posts"
        help="Top 5 posts com mais visualizações no período selecionado."
        posts={bestPosts.slice(0, 5)}
        tone="best"
        titleOf={(p) => p.client_name}
        onSeeMore={bestPosts.length > 5 ? () => drawer.open('best') : undefined}
      />
      <RankedPostStrip
        title="Precisam de atenção"
        help="Posts com pelo menos 48h desde a publicação e menos visualizações no período."
        posts={worstPosts.slice(0, 5)}
        tone="worst"
        titleOf={(p) => p.client_name}
        onSeeMore={worstPosts.length > 5 ? () => drawer.open('worst') : undefined}
      />

      <SectionHead
        large
        title="Todas as contas"
        trailing={
          accounts.length > 0 ? (
            <button
              ref={sortButtonRef}
              type="button"
              className="phone-an-sort"
              aria-haspopup="dialog"
              aria-label={`Ordenar contas: ${SORT_LABELS[sortColumn]}, ${sortDirection === 'asc' ? 'crescente' : 'decrescente'}`}
              onClick={() => setSortOpen(true)}
            >
              <ArrowUpDown aria-hidden="true" />
              {SORT_LABELS[sortColumn]}
            </button>
          ) : undefined
        }
      />
      {accounts.length === 0 ? (
        <p className="phone-an-empty">
          Nenhuma conta Instagram conectada. Conecte contas na página de cada cliente.
        </p>
      ) : (
        <GroupedList aria-label="Todas as contas">
          {sortedAccounts.map((a) => {
            const d = daysSince(a.last_post_at);
            const silent = d === null || d > 7;
            const deltaIcon = a.follower_delta > 0 ? '↑' : a.follower_delta < 0 ? '↓' : '';
            return (
              <Cell
                key={a.client_id}
                to={`/analytics/${a.client_id}`}
                icon={
                  <Avatar
                    src={a.profile_picture_url}
                    initials={a.client_sigla}
                    color={a.client_cor}
                  />
                }
                label={a.client_name}
                subtitle={
                  <>
                    {a.follower_delta !== 0 && (
                      <>
                        <span
                          className={
                            a.follower_delta > 0 ? 'phone-an-tone--up' : 'phone-an-tone--down'
                          }
                        >
                          {deltaIcon} {fmtNumber(Math.abs(a.follower_delta))}
                        </span>
                        {' · '}
                      </>
                    )}
                    {formatPct(a.engagement_rate_avg)} eng. ·{' '}
                    <span className={silent ? 'phone-an-tone--down' : undefined}>
                      {d === null ? 'Sem posts' : `${d}d atrás`}
                    </span>
                  </>
                }
                value={<span className="phone-an-row-value">{sortValueLabel(a, sortColumn)}</span>}
              />
            );
          })}
        </GroupedList>
      )}

      {accounts.length >= 2 && (
        <BarList
          header="Benchmarking de engajamento"
          footer={`Média do portfólio: ${formatPct(benchmarkAvg)}. Verde está acima da média.`}
          items={[...accounts]
            .sort((a, b) => b.engagement_rate_avg - a.engagement_rate_avg)
            .map((a) => ({
              key: String(a.client_id),
              label: a.client_name,
              value: a.engagement_rate_avg,
              valueLabel: formatPct(a.engagement_rate_avg),
              color:
                a.engagement_rate_avg >= benchmarkAvg
                  ? 'var(--phone-an-up)'
                  : 'var(--phone-an-down)',
            }))}
        />
      )}

      {accounts.length >= 2 && specialtyStats.length >= 2 && (
        <BarList
          header="Por especialidade"
          items={specialtyStats.map((s) => ({
            key: s.specialty,
            label: s.specialty,
            subtitle: `${s.count} conta${s.count > 1 ? 's' : ''} · ${fmtNumber(s.avgFollowers)} seg. médio`,
            value: s.avgEngagement,
            valueLabel: formatPct(s.avgEngagement),
          }))}
        />
      )}

      {accounts.length >= 1 && (
        <AIAnalysisPhone
          title="Análise inteligente do portfólio"
          view={aiView}
          loading={ai.loading}
          error={ai.error}
          emptyText="Toque para obter uma análise estratégica do portfólio com IA."
          onGenerate={ai.generate}
        />
      )}

      <ActionSheet
        open={sortOpen}
        onOpenChange={setSortOpen}
        title="Ordenar contas por"
        returnFocusRef={sortButtonRef}
        actions={[
          ...(Object.keys(SORT_LABELS) as AccountSortCol[]).map((col) => ({
            label: SORT_LABELS[col],
            icon: sortColumn === col ? <Check /> : <span />,
            onSelect: () => onSortColumn(col),
          })),
          {
            label: sortDirection === 'asc' ? 'Ordem decrescente' : 'Ordem crescente',
            icon: <ArrowUpDown />,
            onSelect: onToggleDirection,
          },
        ]}
      />

      <AllPostsSheet
        open={drawer.mode !== null}
        onOpenChange={(open) => {
          if (!open) drawer.close();
        }}
        title={drawer.mode === 'worst' ? 'Posts que precisam de atenção' : 'Todos os posts'}
        countLabel={`${drawer.posts.length} de ${drawer.total} posts`}
        note={
          (RATE_KEYS as readonly string[]).includes(drawer.orderBy)
            ? 'Top 200 por visualizações, reordenado por taxa'
            : undefined
        }
        rows={drawerRows}
        emptyText="Nenhum post encontrado com estes filtros."
        filters={{
          orderOptions: ORDER_OPTIONS,
          orderBy: drawer.orderBy,
          onOrderBy: drawer.setOrderBy,
          asc: drawer.asc,
          onAsc: drawer.setAsc,
          formatOptions: FORMAT_OPTIONS,
          format: drawer.format,
          onFormat: drawer.setFormat,
          clientOptions: drawer.clients.map((name) => ({ value: name, label: name })),
          client: drawer.client,
          onClient: drawer.setClient,
          dateFrom: drawer.dateFrom,
          dateTo: drawer.dateTo,
          onDateFrom: drawer.setDateFrom,
          onDateTo: drawer.setDateTo,
        }}
      />
    </div>
  );
}

const STATUS_TONE: Record<string, AITone> = {
  destaque: 'up',
  estável: 'info',
  atenção: 'warn',
};

// The AI payload is untyped JSON.
export function portfolioAIView(a: any): AIAnalysisView | null {
  if (!a) return null;
  return {
    score: a.portfolioHealth
      ? {
          value: a.portfolioHealth.score,
          label: 'Saúde do portfólio',
          summary: a.portfolioHealth.summary,
        }
      : undefined,
    ranking: Array.isArray(a.accountRanking)
      ? {
          title: 'Ranking de contas',
          items: a.accountRanking.map((acc: any) => ({
            badge: String(acc.status ?? ''),
            tone: STATUS_TONE[acc.status] ?? 'down',
            title: String(acc.username ?? ''),
            detail: acc.keyMetric ? String(acc.keyMetric) : undefined,
          })),
        }
      : undefined,
    sections: [
      { title: 'Insights cruzados', text: a.crossAccountInsights },
      { title: 'Alocação de esforço', text: a.resourceAllocation },
      { title: 'Resumo mensal', text: a.monthlyDigest },
    ],
    actions: Array.isArray(a.priorityActions)
      ? {
          title: 'Ações prioritárias',
          items: a.priorityActions.map((p: any) => ({
            badge: String(p.prioridade ?? ''),
            tone: priorityTone(p.prioridade),
            title: `${p.conta}: ${p.acao}`,
            detail: p.impacto ? String(p.impacto) : undefined,
          })),
        }
      : undefined,
    generatedAt: a.generatedAt,
  };
}
