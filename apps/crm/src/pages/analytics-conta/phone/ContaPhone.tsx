import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { getDateFnsLocale, getIntlLocale } from '@mesaas/i18n';
import {
  ArrowUpDown,
  Bookmark,
  Check,
  Clock,
  FileText,
  Film,
  Gauge,
  PieChart,
  RefreshCw,
  Users,
} from 'lucide-react';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { toast } from 'sonner';
import {
  getAccountAIAnalysis,
  getPostAnalyticsById,
  type AccountHealth,
  type AudienceDemographics,
  type BestPostingTimes,
  type PostAnalytics,
  type PostTag,
  type StoriesAnalyticsResponse,
} from '../../../services/analytics';
import type { Baseline, RateDistributions } from '../../../lib/ig-rates';
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
import { AccountCommentsCard } from '../comments/AccountCommentsCard';
import { AIAnalysisPhone, useAIAnalysis } from '../../analytics/phone/AIAnalysisPhone';
import { PeriodSegmented } from '../../analytics/phone/PeriodControl';
import { dayFull, hourText } from '../contaFormat';
import { NewTagSheet, PostDetailSheet } from './PostDetailSheet';
import { AccountHealthCard } from '../health/AccountHealthCard';
import {
  BaselineSection,
  BestTimesSection,
  DemographicsSection,
  FollowerGrowthCard,
  SavesSection,
  StoriesSectionPhone,
  TypeTopicSection,
  contaAIView,
  formatPct,
} from './ContaSections';

/** The posts table's sortable columns (server-side sort, same keys as desktop). */
const POST_SORT_COLS = [
  'posted_at',
  'impressions',
  'reach',
  'engagement_rate',
  'ig_score',
  'likes',
  'saved',
  'comments',
  'shares',
  'follows',
];

const ORDER_KEYS = [
  'views',
  'reach',
  'engagement',
  'likes',
  'comments',
  'saved',
  'shares',
  'profile_visits',
  'follows',
  'date',
  'ig_score',
  'share_rate',
  'like_rate',
  'save_rate',
  'comment_rate',
  'follows_per_mil_reach',
];

const fmtEng = (v: number) =>
  `${getIntlLocale() === 'en-US' ? v.toFixed(1) : v.toFixed(1).replace('.', ',')}%`;

function postSortValue(p: PostAnalytics, col: string, t: TFunction): string {
  switch (col) {
    case 'reach':
      return fmtNumber(p.reach);
    case 'engagement_rate':
      return fmtEng(p.engagement_rate);
    case 'ig_score':
      return p.ig_score == null ? t('phone.noScore') : String(p.ig_score);
    case 'likes':
      return fmtNumber(p.likes);
    case 'saved':
      return fmtNumber(p.saved);
    case 'comments':
      return fmtNumber(p.comments);
    case 'shares':
      return fmtNumber(p.shares);
    case 'follows':
      return typeof p.follows === 'number' ? fmtNumber(p.follows) : t('phone.noValue');
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
  /** Rate distributions for the post sheet's Engajamento tab. */
  dists?: RateDistributions;
  /** The page's account-health read (one query, shared with desktop); null hides the card. */
  health: AccountHealth | null | undefined;
  healthLoading: boolean;
  /** The client analytics shell's tab control, rendered under the identity. */
  tabs?: ReactNode;
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
    dists,
    health,
    healthLoading,
    tabs,
  } = props;

  const { t } = useTranslation('analyticsAccount');
  const sectionTitle = (key: SectionKey) => t(`phone.section.${key}`);
  const postSortLabel = (col: string) =>
    POST_SORT_COLS.includes(col) ? t(`phone.sort.${col}`) : col;
  const [sortOpen, setSortOpen] = useState(false);
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  // The health card's best post when it is outside the loaded list (fetched by id).
  const [fetchedPost, setFetchedPost] = useState<PostAnalytics | null>(null);
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [tagToRemove, setTagToRemove] = useState<PostTag | null>(null);
  const [section, setSection] = useState<SectionKey | null>(null);
  const [shownSection, setShownSection] = useState<SectionKey | null>(null);

  useEffect(() => {
    if (section) setShownSection(section);
  }, [section]);

  // Derived from the live list so tag toggles (which refetch the posts) show at once.
  const selectedPost = useMemo(() => {
    if (selectedPostId === null) return null;
    const listed = posts.find((p) => p.id === selectedPostId);
    if (listed) return listed;
    return fetchedPost?.id === selectedPostId ? fetchedPost : null;
  }, [posts, selectedPostId, fetchedPost]);

  // Bumped on every open and close: a by-id fetch that resolves after another open or a close
  // is stale and must not take over the sheet (nor toast its error).
  const openRequestRef = useRef(0);
  const selectPost = (postId: string | null) => {
    openRequestRef.current += 1;
    setSelectedPostId(postId);
  };

  const openHealthPost = async (postId: string) => {
    if (posts.some((p) => p.id === postId)) {
      selectPost(postId);
      return;
    }
    const request = ++openRequestRef.current;
    try {
      const fetched = await getPostAnalyticsById(clientId, postId, dists);
      if (request !== openRequestRef.current) return;
      if (!fetched) {
        toast.error(t('toast.openPostFailed'));
        return;
      }
      setFetchedPost(fetched);
      setSelectedPostId(fetched.id);
    } catch {
      if (request === openRequestRef.current) toast.error(t('toast.openPostFailed'));
    }
  };

  // A post fetched by id is not in the list, so the list refetch after a tag toggle does not
  // reach it: fetch it again, unless the user has moved on meanwhile.
  const toggleTag = async (post: PostAnalytics, tag: PostTag, assigned: boolean) => {
    // Captured before the toggle's await: an open or close during the toggle also invalidates it.
    const request = openRequestRef.current;
    await onToggleTag(post, tag, assigned);
    if (fetchedPost === null || post.id !== fetchedPost.id || selectedPostId !== post.id) return;
    if (posts.some((p) => p.id === post.id)) return;
    try {
      const refreshed = await getPostAnalyticsById(clientId, post.id, dists);
      if (request !== openRequestRef.current || !refreshed) return;
      // Never replace a different post that was fetched meanwhile.
      setFetchedPost((prev) => (prev?.id === refreshed.id ? refreshed : prev));
    } catch {
      // The toggle itself succeeded; the sheet keeps the previous copy.
    }
  };

  const ai = useAIAnalysis(
    useCallback(async () => {
      const result = await getAccountAIAnalysis(clientId, days);
      if (result.analysis.error) throw new Error(t('ai.failed'));
      return { ...result.analysis, generatedAt: result.generatedAt };
    }, [clientId, days, t]),
    useCallback((e: unknown) => (e instanceof Error && e.message) || t('ai.error'), [t]),
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
    href: post.permalink ?? '',
    thumbnailUrl: post.thumbnail_url,
    mediaType: post.media_type,
    title: post.caption || t('page.noCaption'),
    meta: `${format(new Date(post.posted_at), t('phone.dateShort'), { locale: getDateFnsLocale() })} · ${mediaTypeLabel(post.media_type)}`,
    onSelect: () => selectPost(post.id),
    metrics: (
      <>
        <span>
          {t('phone.rowViews')} <strong>{fmtNumber(post.views)}</strong>
        </span>
        <span>
          {t('phone.rowEng')}{' '}
          <strong>
            {getIntlLocale() === 'en-US'
              ? post.engagement_rate.toFixed(2)
              : post.engagement_rate.toFixed(2).replace('.', ',')}
            %
          </strong>
        </span>
        <span>
          {t('phone.rowLikes')} <strong>{fmtNumber(post.likes)}</strong>
        </span>
        <span>
          {t('phone.rowComments')} <strong>{fmtNumber(post.comments)}</strong>
        </span>
        <span>
          {t('phone.rowSaved')} <strong>{fmtNumber(post.saved)}</strong>
        </span>
        {typeof post.follows === 'number' && (
          <span>
            {t('phone.rowFollows')} <strong>{fmtNumber(post.follows)}</strong>
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
          ? t('phone.bestSub', {
              day: dayFull(bestTimes.labels_days[bestSlot.day]),
              hour: hourText(bestTimes.labels_hours[bestSlot.hour]),
              pct: formatPct(bestSlot.value),
            })
          : t('phone.insufficient'),
      show: true,
    },
    {
      key: 'saves',
      icon: <Bookmark />,
      subtitle: t('saves.featured', { count: topSaved.length }),
      show: topSaved.length > 0,
    },
    { key: 'types', icon: <PieChart />, subtitle: typeHeadline, show: true },
    {
      key: 'stories',
      icon: <Film />,
      subtitle: stories
        ? t('phone.storiesSub', {
            count: stories.kpis.current.stories_count,
            reach: fmtNumber(stories.kpis.current.total_reach),
          })
        : null,
      show: !!stories && stories.kpis.current.stories_count > 0,
    },
    {
      key: 'baseline',
      icon: <Gauge />,
      subtitle: baseline ? t('phone.baselineSub', { count: baseline.sample_size }) : null,
      show: !!baseline && baseline.sample_size > 0,
    },
  ];

  return (
    <div className="phone-kit phone-an">
      <PhoneNavBar
        fallbackTo="/analytics"
        backLabel={t('phone.back')}
        trailing={
          <>
            <PhoneIconButton
              label={t('phone.sync')}
              onClick={onSync}
              disabled={syncing}
              aria-busy={syncing || undefined}
            >
              <RefreshCw aria-hidden="true" className={syncing ? 'phone-an-spin' : undefined} />
            </PhoneIconButton>
            <PhoneIconButton label={t('phone.report')} variant="ink" onClick={onNewReport}>
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
                {t('phone.dataFrom')}
                {new Date(cachedAt).toLocaleString(getIntlLocale(), {
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

      {tabs}

      <PeriodSegmented
        presets={[
          { value: '7', label: '7d' },
          { value: '30', label: '30d' },
          { value: '90', label: '90d' },
          { value: 'month', label: t('filter.lastMonth') },
        ]}
        value={periodValue}
        onChange={(v) => (v === 'month' ? onLastMonth() : onDays(parseInt(v, 10)))}
        custom={{
          days: !periodStart && !isPreset ? overviewDays : null,
          min: 1,
          max: 730,
          onApply: onCustomDays,
        }}
      />
      {periodStart && (
        <p className="phone-an-period__custom">{t('phone.lastMonth', { period: periodTag })}</p>
      )}

      <AccountHealthCard
        health={health}
        isLoading={healthLoading}
        onOpenPost={(postId) => void openHealthPost(postId)}
        layout="phone"
      />

      {/* Wide touch screens: two columns (analyticsPhone.css). */}
      <div className="phone-an-pair phone-an-stack">
        <div className="phone-an-half phone-an-stack">{kpis}</div>
        <div className="phone-an-half phone-an-stack">
          <FollowerGrowthCard history={history} onManual={onManualFollower} />
        </div>
      </div>

      <RankedPostStrip
        title={t('phone.bestTitle')}
        help={t('ranked.bestDescription', { period: periodTag })}
        posts={rankedPosts.slice(0, 5)}
        tone="best"
        titleOf={(p) => p.caption || t('page.noCaption')}
        onSelect={(p) => selectPost(p.id)}
        onSeeMore={rankedPosts.length > 5 ? () => drawer.open('best') : undefined}
      />
      <RankedPostStrip
        title={t('phone.worstTitle')}
        help={t('ranked.worstDescription')}
        posts={matureRankedPosts.slice(0, 5)}
        tone="worst"
        titleOf={(p) => p.caption || t('page.noCaption')}
        onSelect={(p) => selectPost(p.id)}
        onSeeMore={matureRankedPosts.length > 5 ? () => drawer.open('worst') : undefined}
      />

      {/* Wide touch screens: two columns (analyticsPhone.css). */}
      <div className="phone-an-pair phone-an-stack">
        <div className="phone-an-half phone-an-stack">
          <SectionHead
            large
            title={t('phone.contentPerf')}
            trailing={
              posts.length > 0 ? (
                <button
                  ref={sortButtonRef}
                  type="button"
                  className="phone-an-sort"
                  aria-haspopup="dialog"
                  aria-label={t('phone.sortPosts', {
                    col: postSortLabel(sort.col),
                    dir: sort.dir === 'asc' ? t('phone.ascending') : t('phone.descending'),
                  })}
                  onClick={() => setSortOpen(true)}
                >
                  <ArrowUpDown aria-hidden="true" />
                  {postSortLabel(sort.col)}
                </button>
              ) : undefined
            }
          />
          {posts.length === 0 ? (
            <p className="phone-an-empty">{t('table.empty')}</p>
          ) : (
            <GroupedList aria-label={t('phone.contentPerf')}>
              {visiblePosts.map((p) => (
                <Cell
                  key={p.id}
                  icon={<PostThumb url={p.thumbnail_url} mediaType={p.media_type} />}
                  label={p.caption || t('page.noCaption')}
                  subtitle={t('phone.postSubtitle', {
                    date: new Date(p.posted_at).toLocaleDateString(getIntlLocale()),
                    type: mediaTypeLabel(p.media_type),
                    eng: fmtEng(p.engagement_rate),
                    tags:
                      p.tags.length > 0 ? ` · ${p.tags.map((tag) => tag.tag_name).join(', ')}` : '',
                  })}
                  value={
                    <span className="phone-an-row-value">{postSortValue(p, sort.col, t)}</span>
                  }
                  chevron
                  aria-haspopup="dialog"
                  onClick={() => selectPost(p.id)}
                />
              ))}
              {posts.length > 5 && (
                <Cell
                  label={showAllPosts ? t('phone.showLess') : t('phone.showMore')}
                  onClick={onToggleShowAll}
                  aria-expanded={showAllPosts}
                />
              )}
            </GroupedList>
          )}
        </div>
        <div className="phone-an-half phone-an-stack">
          <GroupedList header={t('phone.moreAnalyses')}>
            {sectionRows
              .filter((r) => r.show)
              .map((r) => (
                <Cell
                  key={r.key}
                  icon={r.icon}
                  label={sectionTitle(r.key)}
                  subtitle={r.subtitle ?? undefined}
                  chevron
                  aria-haspopup="dialog"
                  onClick={() => setSection(r.key)}
                />
              ))}
          </GroupedList>
        </div>
      </div>

      <AccountCommentsCard clientId={clientId} posts={posts} compact />

      <AIAnalysisPhone
        title={t('phone.aiTitle')}
        view={aiView}
        loading={ai.loading}
        error={ai.error}
        emptyText={t('phone.aiEmpty')}
        onGenerate={ai.generate}
      />

      {/* ---- Sheets ---- */}

      <ActionSheet
        open={sortOpen}
        onOpenChange={setSortOpen}
        title={t('phone.sortBy')}
        returnFocusRef={sortButtonRef}
        actions={[
          ...POST_SORT_COLS.map((col) => ({
            label: t(`phone.sort.${col}`),
            icon: sort.col === col ? <Check /> : <span />,
            onSelect: () => onSort({ col, dir: sort.col === col ? sort.dir : 'desc' }),
          })),
          {
            label: sort.dir === 'asc' ? t('phone.orderDesc') : t('phone.orderAsc'),
            icon: <ArrowUpDown />,
            onSelect: () => onSort({ col: sort.col, dir: sort.dir === 'asc' ? 'desc' : 'asc' }),
          },
        ]}
      />

      <BottomSheet
        open={section !== null}
        onOpenChange={(open) => {
          if (!open) setSection(null);
        }}
        title={shownSection ? sectionTitle(shownSection) : ''}
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
        title={t('phone.removeTag')}
        message={tagToRemove ? t('phone.removeTagMsg', { name: tagToRemove.tag_name }) : undefined}
        actions={[
          {
            label: t('phone.remove'),
            destructive: true,
            onSelect: () => {
              if (tagToRemove) onDeleteTag(tagToRemove.id);
              setTagToRemove(null);
            },
          },
        ]}
        onCancel={() => setTagToRemove(null)}
      />

      <AllPostsSheet
        open={drawer.mode !== null}
        onOpenChange={(open) => {
          if (!open) drawer.close();
        }}
        title={drawer.mode === 'worst' ? t('phone.drawerWorst') : t('phone.bestTitle')}
        countLabel={t('drawer.subtitle', {
          shown: drawer.posts.length,
          total: drawer.total,
          username: account.username,
        })}
        rows={drawerRows}
        emptyText={t('drawer.empty')}
        filters={{
          orderOptions: ORDER_KEYS.map((value) => ({ value, label: t(`drawer.sort.${value}`) })),
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

      {/* Opens over the list too: sheets mount on open, so the latest one is on top. */}
      <PostDetailSheet
        clientId={clientId}
        post={selectedPost}
        onOpenChange={(open) => {
          if (!open) selectPost(null);
        }}
        tags={tags}
        onToggleTag={toggleTag}
        onNewTag={() => setNewTagOpen(true)}
        dists={dists}
      />

      <NewTagSheet open={newTagOpen} onOpenChange={setNewTagOpen} onCreate={onCreateTag} />
    </div>
  );
}

/** The page's early states (invalid id, not found, token expired...) on phones. */
export function ContaPhoneMessage({
  title,
  message,
  action,
  tabs,
}: {
  title: string;
  message?: string;
  action?: { label: string; to: string };
  /** The client analytics shell's tab control, kept above the message. */
  tabs?: ReactNode;
}) {
  const { t } = useTranslation('analyticsAccount');
  return (
    <div className="phone-kit phone-an">
      <PhoneNavBar fallbackTo="/analytics" backLabel={t('phone.back')} />
      {tabs}
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
