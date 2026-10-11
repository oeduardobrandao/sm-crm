import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ArrowUpDown,
  Bookmark,
  Check,
  Clock,
  FileText,
  Film,
  Gauge,
  PieChart,
  Plus,
  RefreshCw,
  Users,
} from 'lucide-react';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { ActionSheet, type ActionSheetAction } from '@/components/mobile/ActionSheet';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import {
  getAccountAIAnalysis,
  type AnalyticsReport,
  type AudienceDemographics,
  type BestPostingTimes,
  type PostAnalytics,
  type PostTag,
  type StoriesAnalyticsResponse,
} from '../../../services/analytics';
import type { ReportDocListItem } from '../../../services/reportDocs';
import type { Baseline } from '../../../lib/ig-rates';
import { sanitizeUrl } from '../../../utils/security';
import {
  Avatar,
  PostThumb,
  SectionHead,
  fmtNumber,
  mediaTypeLabel,
} from '../../analytics/phone/shared';
import { RankedPostStrip } from '../../analytics/phone/RankedPostStrip';
import { AllPostsSheet, type AllPostsRow } from '../../analytics/phone/AllPostsSheet';
import { AIAnalysisPhone, useAIAnalysis } from '../../analytics/phone/AIAnalysisPhone';
import { PeriodSegmented } from '../../analytics/phone/PeriodControl';
import { formatReportMonth } from '../contaFormat';
import { NewTagSheet, PostDetailSheet } from './PostDetailSheet';
import {
  BaselineSection,
  BestTimesSection,
  DAY_FULL,
  DemographicsSection,
  FollowerGrowthCard,
  SavesSection,
  StoriesSectionPhone,
  TypeTopicSection,
  contaAIView,
  formatPct,
} from './ContaSections';

/** The posts table's sortable columns (server-side sort, same keys as desktop). */
const POST_SORT_LABELS: Record<string, string> = {
  posted_at: 'Data',
  impressions: 'Visualizações',
  reach: 'Alcance',
  engagement_rate: 'Engajamento',
  ig_score: 'IG Score',
  likes: 'Curtidas',
  saved: 'Salvos',
  comments: 'Comentários',
  shares: 'Compartilhamentos',
  follows: 'Novos seguidores',
};

const ORDER_OPTIONS = [
  { value: 'views', label: 'Visualizações' },
  { value: 'reach', label: 'Alcance' },
  { value: 'engagement', label: 'Engajamento' },
  { value: 'likes', label: 'Curtidas' },
  { value: 'comments', label: 'Comentários' },
  { value: 'saved', label: 'Salvos' },
  { value: 'shares', label: 'Compart.' },
  { value: 'profile_visits', label: 'Visitas ao perfil' },
  { value: 'follows', label: 'Novos seguidores' },
  { value: 'date', label: 'Data' },
  { value: 'ig_score', label: 'IG Score' },
  { value: 'share_rate', label: 'Compart./visualização' },
  { value: 'like_rate', label: 'Curt./visualização' },
  { value: 'save_rate', label: 'Salvos/visualização' },
  { value: 'comment_rate', label: 'Coment./visualização' },
  { value: 'follows_per_mil_reach', label: 'Seguidores/mil alcançados' },
];

const PERIOD_PRESETS = [
  { value: '7', label: '7d' },
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
  { value: 'month', label: 'Último mês' },
];

const fmtEng = (v: number) => `${v.toFixed(1).replace('.', ',')}%`;

function postSortValue(p: PostAnalytics, col: string): string {
  switch (col) {
    case 'reach':
      return fmtNumber(p.reach);
    case 'engagement_rate':
      return fmtEng(p.engagement_rate);
    case 'ig_score':
      return p.ig_score == null ? 'Sem score' : String(p.ig_score);
    case 'likes':
      return fmtNumber(p.likes);
    case 'saved':
      return fmtNumber(p.saved);
    case 'comments':
      return fmtNumber(p.comments);
    case 'shares':
      return fmtNumber(p.shares);
    case 'follows':
      return typeof p.follows === 'number' ? fmtNumber(p.follows) : 'Sem dado';
    default:
      return fmtNumber(p.views);
  }
}

export interface ContaDrawerState {
  mode: 'best' | 'worst' | null;
  open: (mode: 'best' | 'worst') => void;
  close: () => void;
  posts: PostAnalytics[];
  total: number;
  orderBy: string;
  setOrderBy: (v: string) => void;
  asc: boolean;
  setAsc: (v: boolean) => void;
  format: string;
  setFormat: (v: string) => void;
  formats: string[];
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
}

type SectionKey = 'demo' | 'times' | 'saves' | 'types' | 'stories' | 'baseline';

const SECTION_TITLES: Record<SectionKey, string> = {
  demo: 'Demografia da audiência',
  times: 'Melhor horário para postar',
  saves: 'Taxa de salvamentos',
  types: 'Desempenho por tipo e tópico',
  stories: 'Stories',
  baseline: 'Baseline Instagram',
};

export interface ContaPhoneProps {
  clientId: number;
  clienteNome: string;
  account: { username: string; profile_picture_url?: string | null };
  /** When the overview came from the server cache: when it was fetched. */
  cachedAt: string | null;
  syncing: boolean;
  onSync: () => void;
  onNewReport: () => void;
  overviewDays: number;
  /** Days of the posts/stories window (the custom period only moves the overview). */
  days: number;
  periodStart?: string;
  periodTag: string;
  onDays: (d: number) => void;
  onLastMonth: () => void;
  onCustomDays: (d: number) => void;
  /** The page's KPI grid (rendered as the phone tile strip). */
  kpis: ReactNode;
  history: { date: string; follower_count: number; source: string }[];
  onManualFollower: () => void;
  posts: PostAnalytics[];
  rankedPosts: PostAnalytics[];
  matureRankedPosts: PostAnalytics[];
  drawer: ContaDrawerState;
  sort: { col: string; dir: 'asc' | 'desc' };
  onSort: (sort: { col: string; dir: 'asc' | 'desc' }) => void;
  showAllPosts: boolean;
  onToggleShowAll: () => void;
  tags: PostTag[];
  onToggleTag: (post: PostAnalytics, tag: PostTag, assigned: boolean) => Promise<void>;
  onCreateTag: (name: string) => Promise<boolean>;
  onDeleteTag: (tagId: number) => void;
  topSaved: PostAnalytics[];
  typeBreakdown: { type: string; count: number; avgEngagement: number }[];
  topicStats: (PostTag & { avgEngagement: number; count: number })[];
  typeHeadline: string | null;
  demographics: AudienceDemographics | null;
  demoHeadline: string | null;
  bestTimes: BestPostingTimes | null;
  stories: StoriesAnalyticsResponse | null;
  baseline: Baseline | null;
  reportDocs: ReportDocListItem[];
  reports: AnalyticsReport[];
  onOpenDoc: (id: string) => void;
  onDeleteDoc: (id: string) => void;
  downloadingReportId: number | null;
  onDownloadReport: (id: number) => void;
  onEmailReport: (report: AnalyticsReport) => void;
}

function reportStatusText(r: AnalyticsReport): { text: string; tone?: string } {
  switch (r.status) {
    case 'pending':
      return { text: 'Pendente', tone: 'phone-an-tone--warn' };
    case 'generating':
      return { text: 'Gerando…', tone: 'phone-an-tone--muted' };
    case 'failed':
      return {
        text: `Falha: ${r.generation_error || 'Erro desconhecido'}`,
        tone: 'phone-an-tone--down',
      };
    case 'skipped':
      return {
        text: 'Fora do plano: o plano do workspace não incluía relatórios de analytics no momento da geração.',
        tone: 'phone-an-tone--muted',
      };
    default:
      return { text: 'Pronto', tone: 'phone-an-tone--up' };
  }
}

/** /analytics/:id below 768px (FAnalyticsConta + FAnalyticsPost mockups). */
export function ContaPhone(props: ContaPhoneProps) {
  const {
    clientId,
    clienteNome,
    account,
    cachedAt,
    syncing,
    onSync,
    onNewReport,
    overviewDays,
    days,
    periodStart,
    periodTag,
    onDays,
    onLastMonth,
    onCustomDays,
    kpis,
    history,
    onManualFollower,
    posts,
    rankedPosts,
    matureRankedPosts,
    drawer,
    sort,
    onSort,
    showAllPosts,
    onToggleShowAll,
    tags,
    onToggleTag,
    onCreateTag,
    onDeleteTag,
    topSaved,
    typeBreakdown,
    topicStats,
    typeHeadline,
    demographics,
    demoHeadline,
    bestTimes,
    stories,
    baseline,
    reportDocs,
    reports,
    onOpenDoc,
    onDeleteDoc,
    downloadingReportId,
    onDownloadReport,
    onEmailReport,
  } = props;

  const [sortOpen, setSortOpen] = useState(false);
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [tagToRemove, setTagToRemove] = useState<PostTag | null>(null);
  const [section, setSection] = useState<SectionKey | null>(null);
  const [shownSection, setShownSection] = useState<SectionKey | null>(null);
  const [docTarget, setDocTarget] = useState<ReportDocListItem | null>(null);
  const [docToDelete, setDocToDelete] = useState<ReportDocListItem | null>(null);
  const [reportTarget, setReportTarget] = useState<AnalyticsReport | null>(null);

  useEffect(() => {
    if (section) setShownSection(section);
  }, [section]);

  // Derived from the live list so tag toggles (which refetch the posts) show at once.
  const selectedPost = useMemo(
    () => (selectedPostId === null ? null : (posts.find((p) => p.id === selectedPostId) ?? null)),
    [posts, selectedPostId],
  );

  const ai = useAIAnalysis(
    useCallback(async () => {
      const result = await getAccountAIAnalysis(clientId, days);
      if (result.analysis.error) throw new Error('Não foi possível gerar a análise.');
      return { ...result.analysis, generatedAt: result.generatedAt };
    }, [clientId, days]),
    useCallback((e: unknown) => (e instanceof Error && e.message) || 'Erro na análise', []),
  );
  const aiView = useMemo(() => contaAIView(ai.result), [ai.result]);

  const isPreset = [7, 30, 90].includes(overviewDays);
  const periodValue = periodStart ? 'month' : isPreset ? String(overviewDays) : null;

  const visiblePosts = showAllPosts ? posts : posts.slice(0, 5);
  const bestSlot = bestTimes?.topSlots[0] ?? null;
  const avatarUrl =
    account.profile_picture_url && account.profile_picture_url.startsWith('https://')
      ? account.profile_picture_url
      : null;

  const drawerRows: AllPostsRow[] = drawer.posts.map((post) => ({
    key: post.id,
    href: post.permalink,
    thumbnailUrl: post.thumbnail_url,
    mediaType: post.media_type,
    title: post.caption || 'Sem legenda',
    meta: `${format(new Date(post.posted_at), "d 'de' MMM", { locale: ptBR })} · ${mediaTypeLabel(post.media_type)}`,
    metrics: (
      <>
        <span>
          Visualizações <strong>{fmtNumber(post.views)}</strong>
        </span>
        <span>
          Eng. <strong>{post.engagement_rate.toFixed(2).replace('.', ',')}%</strong>
        </span>
        <span>
          Curtidas <strong>{fmtNumber(post.likes)}</strong>
        </span>
        <span>
          Coment. <strong>{fmtNumber(post.comments)}</strong>
        </span>
        <span>
          Salvos <strong>{fmtNumber(post.saved)}</strong>
        </span>
        {typeof post.follows === 'number' && (
          <span>
            Novos seguidores <strong>{fmtNumber(post.follows)}</strong>
          </span>
        )}
      </>
    ),
  }));

  const sectionRows: {
    key: SectionKey;
    icon: ReactNode;
    subtitle: string | null;
    show: boolean;
  }[] = [
    { key: 'demo', icon: <Users />, subtitle: demoHeadline, show: true },
    {
      key: 'times',
      icon: <Clock />,
      subtitle:
        bestTimes && bestTimes.totalPosts >= 5 && bestSlot
          ? `${DAY_FULL[bestTimes.labels_days[bestSlot.day]] ?? bestTimes.labels_days[bestSlot.day]} às ${bestTimes.labels_hours[bestSlot.hour]} · ${formatPct(bestSlot.value)}% eng.`
          : 'Dados insuficientes',
      show: true,
    },
    {
      key: 'saves',
      icon: <Bookmark />,
      subtitle:
        topSaved.length === 1 ? '1 post em destaque' : `${topSaved.length} posts em destaque`,
      show: topSaved.length > 0,
    },
    { key: 'types', icon: <PieChart />, subtitle: typeHeadline, show: true },
    {
      key: 'stories',
      icon: <Film />,
      subtitle: stories
        ? `${stories.kpis.current.stories_count} stories · alcance ${fmtNumber(stories.kpis.current.total_reach)}`
        : null,
      show: !!stories && stories.kpis.current.stories_count > 0,
    },
    {
      key: 'baseline',
      icon: <Gauge />,
      subtitle: baseline ? `${baseline.sample_size} posts no histórico` : null,
      show: !!baseline && baseline.sample_size > 0,
    },
  ];

  const reportActions: ActionSheetAction[] = reportTarget
    ? [
        ...(reportTarget.storage_path
          ? [
              {
                label: downloadingReportId === reportTarget.id ? 'Baixando…' : 'Baixar PDF',
                disabled: downloadingReportId !== null,
                onSelect: () => onDownloadReport(reportTarget.id),
              },
            ]
          : []),
        { label: 'Enviar por e-mail', onSelect: () => onEmailReport(reportTarget) },
      ]
    : [];

  return (
    <div className="phone-kit phone-an">
      <PhoneNavBar
        fallbackTo="/analytics"
        backLabel="Voltar"
        trailing={
          <>
            <PhoneIconButton
              label="Sincronizar dados"
              onClick={onSync}
              disabled={syncing}
              aria-busy={syncing || undefined}
            >
              <RefreshCw aria-hidden="true" className={syncing ? 'phone-an-spin' : undefined} />
            </PhoneIconButton>
            <PhoneIconButton label="Gerar relatório" variant="ink" onClick={onNewReport}>
              <FileText aria-hidden="true" />
            </PhoneIconButton>
          </>
        }
      />

      <div className="phone-an-identity">
        <Avatar src={avatarUrl} initials={clienteNome.slice(0, 2).toUpperCase()} large />
        <div className="phone-an-identity__text">
          <h1 className="phone-an-identity__name">{clienteNome}</h1>
          <p className="phone-an-identity__meta">
            <a
              href={sanitizeUrl(`https://instagram.com/${encodeURIComponent(account.username)}`)}
              target="_blank"
              rel="noopener noreferrer"
            >
              @{account.username}
            </a>
            {cachedAt && (
              <span className="phone-an-tone--muted">
                {' · Dados de '}
                {new Date(cachedAt).toLocaleString('pt-BR', {
                  timeZone: 'America/Sao_Paulo',
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </p>
        </div>
      </div>

      <PeriodSegmented
        presets={PERIOD_PRESETS}
        value={periodValue}
        onChange={(v) => (v === 'month' ? onLastMonth() : onDays(parseInt(v, 10)))}
        custom={{
          days: !periodStart && !isPreset ? overviewDays : null,
          min: 1,
          max: 730,
          onApply: onCustomDays,
        }}
      />
      {periodStart && <p className="phone-an-period__custom">Último mês: {periodTag}</p>}

      {kpis}

      <FollowerGrowthCard history={history} onManual={onManualFollower} />

      <RankedPostStrip
        title="Melhores posts"
        help={`Top posts por visualizações neste período (${periodTag}).`}
        posts={rankedPosts.slice(0, 5)}
        tone="best"
        titleOf={(p) => p.caption || 'Sem legenda'}
        onSeeMore={rankedPosts.length > 5 ? () => drawer.open('best') : undefined}
      />
      <RankedPostStrip
        title="Precisam de atenção"
        help="Posts com pelo menos 48h de publicação e menos visualizações no período."
        posts={matureRankedPosts.slice(0, 5)}
        tone="worst"
        titleOf={(p) => p.caption || 'Sem legenda'}
        onSeeMore={matureRankedPosts.length > 5 ? () => drawer.open('worst') : undefined}
      />

      <SectionHead
        large
        title="Performance de conteúdo"
        trailing={
          posts.length > 0 ? (
            <button
              ref={sortButtonRef}
              type="button"
              className="phone-an-sort"
              aria-haspopup="dialog"
              aria-label={`Ordenar posts: ${POST_SORT_LABELS[sort.col] ?? sort.col}, ${sort.dir === 'asc' ? 'crescente' : 'decrescente'}`}
              onClick={() => setSortOpen(true)}
            >
              <ArrowUpDown aria-hidden="true" />
              {POST_SORT_LABELS[sort.col] ?? sort.col}
            </button>
          ) : undefined
        }
      />
      {posts.length === 0 ? (
        <p className="phone-an-empty">Nenhuma publicação neste período.</p>
      ) : (
        <GroupedList aria-label="Performance de conteúdo">
          {visiblePosts.map((p) => (
            <Cell
              key={p.id}
              icon={<PostThumb url={p.thumbnail_url} mediaType={p.media_type} />}
              label={p.caption || 'Sem legenda'}
              subtitle={`${new Date(p.posted_at).toLocaleDateString('pt-BR')} · ${mediaTypeLabel(p.media_type)} · ${fmtEng(p.engagement_rate)} eng.${p.tags.length > 0 ? ` · ${p.tags.map((t) => t.tag_name).join(', ')}` : ''}`}
              value={<span className="phone-an-row-value">{postSortValue(p, sort.col)}</span>}
              chevron
              aria-haspopup="dialog"
              onClick={() => setSelectedPostId(p.id)}
            />
          ))}
          {posts.length > 5 && (
            <Cell
              label={showAllPosts ? 'Ver menos' : 'Ver mais publicações'}
              onClick={onToggleShowAll}
              aria-expanded={showAllPosts}
            />
          )}
        </GroupedList>
      )}

      <GroupedList header="Mais análises">
        {sectionRows
          .filter((r) => r.show)
          .map((r) => (
            <Cell
              key={r.key}
              icon={r.icon}
              label={SECTION_TITLES[r.key]}
              subtitle={r.subtitle ?? undefined}
              chevron
              aria-haspopup="dialog"
              onClick={() => setSection(r.key)}
            />
          ))}
      </GroupedList>

      <AIAnalysisPhone
        title="Análise inteligente"
        view={aiView}
        loading={ai.loading}
        error={ai.error}
        emptyText="Toque para obter insights personalizados com IA."
        onGenerate={ai.generate}
      />

      <GroupedList
        header="Relatórios gerados"
        footer={
          reportDocs.length === 0 && reports.length === 0
            ? 'Nenhum relatório gerado ainda.'
            : undefined
        }
      >
        <Cell icon={<Plus />} label="Gerar relatório" onClick={onNewReport} />
        {reportDocs.map((doc) => (
          <Cell
            key={doc.id}
            icon={<FileText />}
            label={doc.title}
            subtitle={new Date(doc.created_at).toLocaleDateString('pt-BR')}
            chevron
            aria-haspopup="dialog"
            onClick={() => setDocTarget(doc)}
          />
        ))}
      </GroupedList>
      {reports.length > 0 && (
        <GroupedList header="Formato anterior">
          {reports.map((r) => {
            const status = reportStatusText(r);
            const ready = r.status === 'ready';
            return (
              <Cell
                key={r.id}
                label={`${formatReportMonth(r.report_month)}${r.include_ai ? ' · IA' : ''}`}
                subtitle={
                  <span className="phone-an-cell-sub phone-an-cell-sub--wrap">
                    <span className={status.tone}>{status.text}</span>
                    {r.generated_at && ` · ${new Date(r.generated_at).toLocaleDateString('pt-BR')}`}
                  </span>
                }
                chevron={ready}
                aria-haspopup={ready ? 'dialog' : undefined}
                onClick={ready ? () => setReportTarget(r) : undefined}
              />
            );
          })}
        </GroupedList>
      )}

      {/* ---- Sheets ---- */}

      <ActionSheet
        open={sortOpen}
        onOpenChange={setSortOpen}
        title="Ordenar posts por"
        returnFocusRef={sortButtonRef}
        actions={[
          ...Object.entries(POST_SORT_LABELS).map(([col, label]) => ({
            label,
            icon: sort.col === col ? <Check /> : <span />,
            onSelect: () => onSort({ col, dir: sort.col === col ? sort.dir : 'desc' }),
          })),
          {
            label: sort.dir === 'asc' ? 'Ordem decrescente' : 'Ordem crescente',
            icon: <ArrowUpDown />,
            onSelect: () => onSort({ col: sort.col, dir: sort.dir === 'asc' ? 'desc' : 'asc' }),
          },
        ]}
      />

      <PostDetailSheet
        post={selectedPost}
        onOpenChange={(open) => {
          if (!open) setSelectedPostId(null);
        }}
        tags={tags}
        onToggleTag={onToggleTag}
        onNewTag={() => setNewTagOpen(true)}
      />

      <NewTagSheet open={newTagOpen} onOpenChange={setNewTagOpen} onCreate={onCreateTag} />

      <BottomSheet
        open={section !== null}
        onOpenChange={(open) => {
          if (!open) setSection(null);
        }}
        title={shownSection ? SECTION_TITLES[shownSection] : ''}
        detents={['large']}
        className="phone-an-sheet"
      >
        <div className="phone-an-sheet__body">
          {shownSection === 'demo' && <DemographicsSection data={demographics} />}
          {shownSection === 'times' && <BestTimesSection data={bestTimes} />}
          {shownSection === 'saves' && <SavesSection posts={topSaved} />}
          {shownSection === 'types' && (
            <TypeTopicSection
              typeBreakdown={typeBreakdown}
              topicStats={topicStats}
              tags={tags}
              days={days}
              onRemoveTag={setTagToRemove}
              onNewTag={() => setNewTagOpen(true)}
            />
          )}
          {shownSection === 'stories' && stories && <StoriesSectionPhone data={stories} />}
          {shownSection === 'baseline' && baseline && <BaselineSection baseline={baseline} />}
        </div>
      </BottomSheet>

      <PhoneConfirmSheet
        open={tagToRemove !== null}
        title="Remover esta tag?"
        message={tagToRemove ? `"${tagToRemove.tag_name}" sai de todos os posts.` : undefined}
        actions={[
          {
            label: 'Remover',
            destructive: true,
            onSelect: () => {
              if (tagToRemove) onDeleteTag(tagToRemove.id);
              setTagToRemove(null);
            },
          },
        ]}
        onCancel={() => setTagToRemove(null)}
      />

      <ActionSheet
        open={docTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDocTarget(null);
        }}
        title={docTarget?.title ?? 'Relatório'}
        actions={
          docTarget
            ? [
                { label: 'Abrir', onSelect: () => onOpenDoc(docTarget.id) },
                {
                  label: 'Excluir',
                  destructive: true,
                  onSelect: () => setDocToDelete(docTarget),
                },
              ]
            : []
        }
      />

      <PhoneConfirmSheet
        open={docToDelete !== null}
        title="Excluir este relatório?"
        message="O PDF exportado também é removido."
        actions={[
          {
            label: 'Excluir',
            destructive: true,
            onSelect: () => {
              if (docToDelete) onDeleteDoc(docToDelete.id);
              setDocToDelete(null);
            },
          },
        ]}
        onCancel={() => setDocToDelete(null)}
      />

      <ActionSheet
        open={reportTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReportTarget(null);
        }}
        title={reportTarget ? `Relatório de ${formatReportMonth(reportTarget.report_month)}` : ''}
        actions={reportActions}
      />

      <AllPostsSheet
        open={drawer.mode !== null}
        onOpenChange={(open) => {
          if (!open) drawer.close();
        }}
        title={drawer.mode === 'worst' ? 'Posts que precisam de atenção' : 'Melhores posts'}
        countLabel={`${drawer.posts.length} de ${drawer.total} posts de @${account.username}`}
        rows={drawerRows}
        emptyText="Nenhum post encontrado com estes filtros."
        filters={{
          orderOptions: ORDER_OPTIONS,
          orderBy: drawer.orderBy,
          onOrderBy: drawer.setOrderBy,
          asc: drawer.asc,
          onAsc: drawer.setAsc,
          formatOptions: drawer.formats.map((f) => ({ value: f, label: mediaTypeLabel(f) })),
          format: drawer.format,
          onFormat: drawer.setFormat,
          dateFrom: drawer.dateFrom,
          dateTo: drawer.dateTo,
          onDateFrom: drawer.setDateFrom,
          onDateTo: drawer.setDateTo,
        }}
      />
    </div>
  );
}

/** The page's early states (invalid id, not found, token expired...) on phones. */
export function ContaPhoneMessage({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: { label: string; to: string };
}) {
  return (
    <div className="phone-kit phone-an">
      <PhoneNavBar fallbackTo="/analytics" backLabel="Voltar" />
      <h1 className="phone-an-identity__name">{title}</h1>
      {message && <p className="phone-an-sheet__summary">{message}</p>}
      {action && (
        <Link to={action.to} className="phone-an-primary-button">
          {action.label}
        </Link>
      )}
    </div>
  );
}
