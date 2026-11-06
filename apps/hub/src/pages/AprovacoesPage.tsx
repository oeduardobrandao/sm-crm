import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useHub } from '../HubContext';
import { compactHubToken } from '../lib/hubLinks';
import { useHubLook } from '../hooks/useHubLook';
import { fetchInstagramFeed } from '../api';
import {
  hubLinhasQuery,
  hubMaterialRequestsQuery,
  hubPostsQuery,
  invalidateHubPosts,
} from '../queries';
import { FeedPreviewButton } from '../components/FeedPreviewButton';
import { PageHeader } from '../components/PageHeader';
import { MediaFilterDropdown, type MediaFilter } from '../components/MediaFilterDropdown';
import { FloatingFilterBar } from '../components/FloatingFilterBar';
import { FILTER_PILL_CLASS, filterPillStyle } from '../components/filterPill';
import { InstagramGridPreview } from '../components/InstagramGridPreview';
import { PostGrid } from '../components/posts/PostGrid';
import { PostDetailDialog } from '../components/posts/PostDetailDialog';
import { isFeedSelectable, type TileMode } from '../components/posts/PostTile';
import { isAutoPublishActive } from '../lib/autoPublish';
import {
  sortPostsByScheduled,
  sortPostsChronologically,
  type PostSortDirection,
} from '../lib/postView';
import { PostGridSkeleton } from '../components/Skeleton';
import { LinhaEditorialTab } from './aprovacoes/LinhaEditorialTab';
import { MaterialTab } from './aprovacoes/MaterialTab';

type ApprovalTab = 'posts' | 'linha' | 'material';

function SortToggle({
  value,
  onChange,
}: {
  value: PostSortDirection;
  onChange: (value: PostSortDirection) => void;
}) {
  const { t } = useTranslation('hubPosts');
  const look = useHubLook();
  const options: { key: PostSortDirection; label: string }[] = [
    { key: 'asc', label: t('aprovacoes.sort.oldest', 'Mais antigos') },
    { key: 'desc', label: t('aprovacoes.sort.newest', 'Mais recentes') },
  ];
  // `contents`: the pills sit directly in the floating filter row, same shape as the filters.
  return (
    <div role="group" aria-label={t('aprovacoes.sort.label', 'Ordenar por')} className="contents">
      {options.map((opt) => {
        const selected = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(opt.key)}
            className={FILTER_PILL_CLASS}
            style={filterPillStyle(selected, look)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ApprovalTabs({
  active,
  tabs,
  onSelect,
}: {
  active: ApprovalTab;
  tabs: { key: ApprovalTab; label: string }[];
  onSelect: (tab: ApprovalTab) => void;
}) {
  const { t } = useTranslation('hubLinha');
  const look = useHubLook();
  return (
    <div role="tablist" aria-label={t('abas.rotulo')} className="mb-6 flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const selected = active === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab.key)}
            className={FILTER_PILL_CLASS}
            style={filterPillStyle(selected, look)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function AprovacoesPage() {
  const { t } = useTranslation('hubPosts');
  const { t: tLinha } = useTranslation('hubLinha');
  const { t: tMaterial } = useTranslation('hubMaterial');
  const pauta = useHubLook() === 'pauta';
  const { token, workspace, bootstrap } = useHub();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const featureLinha = bootstrap.feature_linha_editorial === true;
  const { postId } = useParams<{ postId: string }>();
  const base = `/${workspace}/hub/${compactHubToken(token)}/aprovacoes`;
  const currentId =
    postId !== undefined && !isNaN(parseInt(postId, 10))
      ? parseInt(postId, 10)
      : postId !== undefined
        ? -1
        : null;

  const [mode, setMode] = useState<TileMode>('browse');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showGrid, setShowGrid] = useState(false);
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [sortDir, setSortDir] = useState<PostSortDirection>('asc');

  const { data, isLoading, isError } = useQuery(hubPostsQuery(token));
  // Same cache entry the tab and the nav badge read. Flag off: never fetched.
  const { data: linhasData } = useQuery({ ...hubLinhasQuery(token), enabled: featureLinha });
  const linhasWaiting = (linhasData?.linhas ?? []).filter((l) => l.status === 'enviada').length;
  // Same cache entry the nav badge reads. Open requests only; the endpoint has no flag.
  const {
    data: materialData,
    isLoading: materialLoading,
    isError: materialIsError,
  } = useQuery(hubMaterialRequestsQuery(token));
  const materialCount = materialData?.length ?? 0;
  const materialFailed = materialIsError && materialData === undefined;
  // A post deep link (/aprovacoes/:id) always means the Posts view.
  const aba = searchParams.get('aba');
  const showLinha = featureLinha && aba === 'linha' && currentId === null;
  // Stays on Material while the list loads, falls back to Posts once the last request closes.
  const showMaterial =
    aba === 'material' &&
    currentId === null &&
    (materialLoading || materialCount > 0 || materialFailed);
  const { data: feedData } = useQuery({
    queryKey: ['hub-instagram-feed', token],
    queryFn: () => fetchInstagramFeed(token),
    enabled: showGrid && data?.instagramProfile != null,
  });

  // A failed refetch keeps the cached `data` (status flips to 'error' but data stays), so
  // only treat the error as fatal when there is nothing to show: otherwise a background
  // refetch failure would unmount the grid and an open dialog with an unsent correction.
  const fatalError = isError && data === undefined;

  const approvals = data?.postApprovals ?? [];
  const instagramProfile = data?.instagramProfile ?? null;
  const pending = useMemo(
    () =>
      sortPostsChronologically((data?.posts ?? []).filter((p) => p.status === 'enviado_cliente')),
    [data?.posts],
  );
  // A refetch can empty the queue while in select mode; the toggle is hidden then, so
  // without this reset the client would be stuck in a mode they cannot leave.
  useEffect(() => {
    if (pending.length === 0) {
      setMode('browse');
      setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
      setMediaFilter('all');
    }
  }, [pending.length]);
  const mediaCounts = useMemo(() => {
    const withMedia = pending.filter((p) => p.media.length > 0).length;
    return { with: withMedia, without: pending.length - withMedia };
  }, [pending]);
  // What the grid AND the dialog receive, so prev/next, the strip and auto-advance follow
  // the on-screen order. `selectedPosts` below deliberately stays on the full pending list.
  const visiblePosts = useMemo(
    () =>
      sortPostsByScheduled(
        mediaFilter === 'all'
          ? pending
          : pending.filter((p) => p.media.length > 0 === (mediaFilter === 'with')),
        sortDir,
      ),
    [pending, mediaFilter, sortDir],
  );
  // The filter starts at "Todos", so a deep link never lands on a hidden post. What can:
  // a background refetch moving the OPEN post out of the active filter (the agency added or
  // removed its media meanwhile). Reset so the strip and prev/next match the grid.
  useEffect(() => {
    if (currentId === null || currentId === -1) return;
    if (!pending.some((p) => p.id === currentId)) return;
    if (visiblePosts.some((p) => p.id === currentId)) return;
    setMediaFilter('all');
  }, [currentId, pending, visiblePosts]);
  const selectedPosts = useMemo(
    () => pending.filter((p) => isFeedSelectable(p) && selectedIds.has(p.id)),
    [pending, selectedIds],
  );

  const handleToggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const handleInvalidate = useCallback(() => invalidateHubPosts(qc, token), [qc, token]);
  const handleCloseGrid = useCallback(() => setShowGrid(false), []);
  const handleOpen = useCallback((id: number) => navigate(`${base}/${id}`), [navigate, base]);
  const handleNavigate = useCallback(
    (id: number | null) =>
      id === null
        ? navigate(base, { replace: true })
        : navigate(`${base}/${id}`, { replace: true }),
    [navigate, base],
  );

  const materialPhrase =
    materialCount === 1
      ? tMaterial('cabecalho.pedidos.um')
      : tMaterial('cabecalho.pedidos.varios', { n: materialCount });
  const postsPhrase =
    pending.length === 1
      ? tMaterial('cabecalho.posts.um')
      : tMaterial('cabecalho.posts.varios', { n: pending.length });
  // Only the non-zero parts. Waits for both lists so it never claims "0 posts" mid-load.
  const materialDescription =
    materialCount === 0 || isLoading
      ? undefined
      : pending.length === 0
        ? tMaterial('cabecalho.so', { pedidos: materialPhrase })
        : tMaterial('cabecalho.juntos', { posts: postsPhrase, pedidos: materialPhrase });

  // The bar shows whenever at least two pills would: Posts always, Linha with its flag,
  // Material only while a request is open.
  const tabBar: { key: ApprovalTab; label: string }[] = [
    { key: 'posts', label: tLinha('abas.posts', { n: pending.length }) },
    ...(featureLinha
      ? [{ key: 'linha' as const, label: tLinha('abas.linha', { n: linhasWaiting }) }]
      : []),
    ...(materialCount > 0 || (showMaterial && materialFailed)
      ? [{ key: 'material' as const, label: tLinha('abas.material', { n: materialCount }) }]
      : []),
  ];

  // The count/empty line is only truthful once the fetch has succeeded; while loading or
  // after a failure "Tudo em dia" would claim an empty queue we haven't actually seen.
  const description =
    showLinha || isLoading || fatalError
      ? undefined
      : materialCount > 0 && mode !== 'select'
        ? materialDescription
        : mode === 'select'
          ? t(
              'aprovacoes.selectHint',
              'Selecione posts para visualizar como ficarão no feed do Instagram.',
            )
          : pending.length === 0
            ? t('aprovacoes.emptyDescription', 'Tudo em dia. Nenhum post aguardando aprovação.')
            : t(
                'aprovacoes.pendingDescription',
                '{{count}} post{{plural}} aguardando sua aprovação.',
                {
                  count: pending.length,
                  plural: pending.length > 1 ? 's' : '',
                },
              );

  return (
    // No `.hub-fade-up` on this wrapper: its lingering transform would trap the filter bar's
    // `position: fixed` (see FloatingFilterBar). The header and content fade in on their own.
    <div className="max-w-5xl mx-auto">
      <div className="hub-fade-up">
        <PageHeader
          title={t('aprovacoes.title', 'Aprovações')}
          description={description}
          action={
            !showLinha &&
            !showMaterial &&
            instagramProfile &&
            pending.length > 0 && (
              <span className="flex items-center gap-2">
                {mode === 'select' && (
                  <FeedPreviewButton
                    selectedCount={selectedPosts.length}
                    onClick={() => setShowGrid(true)}
                  />
                )}
                <button
                  type="button"
                  onClick={() => setMode((m) => (m === 'select' ? 'browse' : 'select'))}
                  className={
                    pauta
                      ? 'hub-btn-secondary px-3 py-2 text-[13px] font-semibold'
                      : 'rounded-[4px] border hub-border px-3 py-2 text-[13px] font-semibold hub-tx2'
                  }
                >
                  {mode === 'select'
                    ? t('posts.done', 'Concluir')
                    : t('posts.select', 'Selecionar')}
                </button>
              </span>
            )
          }
        />
      </div>

      {tabBar.length >= 2 && (
        <ApprovalTabs
          active={showLinha ? 'linha' : showMaterial ? 'material' : 'posts'}
          tabs={tabBar}
          onSelect={(tab) => {
            // On a post deep link the other views can't show (they need the list route):
            // leave the post the same way closing it does, landing on the chosen tab.
            if (tab !== 'posts' && currentId !== null) {
              navigate(`${base}?aba=${tab}`, { replace: true });
              return;
            }
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                if (tab === 'posts') next.delete('aba');
                else next.set('aba', tab);
                return next;
              },
              { replace: true },
            );
          }}
        />
      )}

      {showLinha ? (
        // No `.hub-fade-up` here either: the decision bar is `position: fixed`.
        <LinhaEditorialTab />
      ) : showMaterial ? (
        // The tile sets `?pedido=`; MaterialTab opens the request dialog from it.
        <MaterialTab
          onOpen={(id) =>
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                next.set('pedido', String(id));
                return next;
              },
              { replace: true },
            )
          }
        />
      ) : isLoading ? (
        <div className="hub-fade-up">
          <PostGridSkeleton />
        </div>
      ) : fatalError ? (
        <div className="hub-fade-up py-20 text-center text-sm hub-tx2">
          {t('aprovacoes.loadError', 'Erro ao carregar aprovações.')}
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <FloatingFilterBar>
              <MediaFilterDropdown
                value={mediaFilter}
                counts={mediaCounts}
                onChange={setMediaFilter}
              />
              <span
                aria-hidden="true"
                className="mx-1 h-5 w-px shrink-0"
                style={{ background: 'var(--hub-bd)' }}
              />
              <SortToggle value={sortDir} onChange={setSortDir} />
            </FloatingFilterBar>
          )}
          {pending.length > 0 && visiblePosts.length === 0 ? (
            <p className="hub-fade-up text-sm hub-tx2">
              {t('aprovacoes.noResults', 'Nenhum post encontrado para este filtro.')}
            </p>
          ) : (
            <div className="hub-fade-up">
              <PostGrid
                posts={visiblePosts}
                mode={mode}
                selectedIds={selectedIds}
                onOpen={handleOpen}
                onToggle={handleToggleSelect}
              />
            </div>
          )}
          <PostDetailDialog
            fallbackTitle={t('aprovacoes.title', 'Aprovações')}
            posts={visiblePosts}
            currentId={currentId}
            token={token}
            approvals={approvals}
            mediaNotes={data?.mediaNotes ?? []}
            instagramProfile={instagramProfile}
            workspaceName={bootstrap.workspace.name}
            isAutoPublish={(p) => isAutoPublishActive(data, p.workflow_id, p.id)}
            onNavigate={handleNavigate}
            onApprovalSubmitted={handleInvalidate}
          />
          {showGrid && feedData && (
            <InstagramGridPreview
              selectedPosts={selectedPosts}
              feedProfile={feedData.profile}
              livePosts={feedData.recentPosts}
              token={token}
              onClose={handleCloseGrid}
              onScheduleUpdated={handleInvalidate}
            />
          )}
        </>
      )}
    </div>
  );
}
