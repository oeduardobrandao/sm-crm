import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { useHub } from '../HubContext';
import { fetchInstagramFeed } from '../api';
import { useHubPosts } from '../hooks/useHubPosts';
import { hubPostQuery, invalidateHubPosts } from '../queries';
import { FeedPreviewButton } from '../components/FeedPreviewButton';
import { PageHeader } from '../components/PageHeader';
import { InstagramGridPreview } from '../components/InstagramGridPreview';
import { StatusFilterChips, type StatusFilter } from '../components/StatusFilterChips';
import { MonthFilterDropdown, type MonthFilterOption } from '../components/MonthFilterDropdown';
import { MediaFilterDropdown, type MediaFilter } from '../components/MediaFilterDropdown';
import { FloatingFilterBar } from '../components/FloatingFilterBar';
import { PostGrid } from '../components/posts/PostGrid';
import { PostDetailDialog } from '../components/posts/PostDetailDialog';
import { isFeedSelectable, type TileMode } from '../components/posts/PostTile';
import {
  ALL_MONTHS,
  countPostsByMonth,
  getPostMonthKey,
  getPostPublishState,
  groupPostsByMonth,
  isPostClientVisible,
  postHasMedia,
  sortPostsNewestFirst,
} from '../lib/postView';
import { isAutoPublishActive } from '../lib/autoPublish';
import type { HubPost } from '../types';

export function PostagensPage() {
  const { t } = useTranslation('hubPosts');
  const { token, workspace, bootstrap } = useHub();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { postId } = useParams<{ postId: string }>();
  const base = `/${workspace}/hub/${token}/postagens`;
  const currentId =
    postId !== undefined && !isNaN(parseInt(postId, 10))
      ? parseInt(postId, 10)
      : postId !== undefined
        ? -1
        : null;

  const [mode, setMode] = useState<TileMode>('browse');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showGrid, setShowGrid] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [monthFilter, setMonthFilter] = useState<string>(ALL_MONTHS);
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');

  const {
    data,
    posts,
    postApprovals,
    isLoading,
    isError,
    loadOlder,
    hasOlder,
    isLoadingOlder,
    olderError,
  } = useHubPosts(token, {
    history: true,
    // Poll while a post is mid-publishing so the client sees it flip to "Publicado".
    refetchInterval: (query) =>
      (query.state.data?.posts ?? []).some((p) => getPostPublishState(p) === 'publicando')
        ? 15000
        : false,
  });

  // A failed refetch keeps the cached `data` (status flips to 'error' but data stays), so
  // only treat the error as fatal when there is nothing to show: otherwise a background
  // refetch failure would unmount the grid and an open dialog with an unsent correction.
  const fatalError = isError && data === undefined;

  const allVisible = useMemo(
    () => sortPostsNewestFirst(posts.filter(isPostClientVisible)),
    [posts],
  );

  // A deep link (share link, message chip, calendar) can point at a post older than what is
  // loaded: fetch just that post. 404 leaves the dialog's "não disponível" branch.
  const wantsSingle =
    !isLoading &&
    !fatalError &&
    currentId !== null &&
    currentId > 0 &&
    !allVisible.some((p) => p.id === currentId);
  const single = useQuery({ ...hubPostQuery(token, currentId ?? 0), enabled: wantsSingle });
  // Same visibility guard as the list (defence in depth; an old backend ignores post_id and
  // returns its whole list).
  const singlePost = wantsSingle
    ? single.data?.posts.find((p) => p.id === currentId && isPostClientVisible(p))
    : undefined;
  // The three filters are cross-faceted: each control's counts reflect the other two
  // selections, so a chip or menu option never advertises posts the current combination hides.
  const inMonth = (p: HubPost) => monthFilter === ALL_MONTHS || getPostMonthKey(p) === monthFilter;
  const inStatus = (p: HubPost) => statusFilter === 'all' || p.status === statusFilter;
  const inMedia = (p: HubPost) =>
    mediaFilter === 'all' || (mediaFilter === 'with') === postHasMedia(p);
  const statusScoped = allVisible.filter((p) => inMonth(p) && inMedia(p));
  const filterCounts: Record<StatusFilter, number> = {
    all: statusScoped.length,
    enviado_cliente: statusScoped.filter((p) => p.status === 'enviado_cliente').length,
    correcao_cliente: statusScoped.filter((p) => p.status === 'correcao_cliente').length,
    aprovado_cliente: statusScoped.filter((p) => p.status === 'aprovado_cliente').length,
  };
  const mediaScoped = allVisible.filter((p) => inMonth(p) && inStatus(p));
  const withMedia = mediaScoped.filter(postHasMedia).length;
  const mediaCounts = { with: withMedia, without: mediaScoped.length - withMedia };
  // Which months exist comes from every visible post (so choosing a status never removes the
  // selected month from under the user); each month's count respects the other filters.
  const monthOptions = useMemo<MonthFilterOption[]>(() => {
    const counts = countPostsByMonth(
      allVisible.filter(
        (p) =>
          (statusFilter === 'all' || p.status === statusFilter) &&
          (mediaFilter === 'all' || (mediaFilter === 'with') === postHasMedia(p)),
      ),
    );
    return groupPostsByMonth(allVisible).map(({ key }) => ({ key, count: counts.get(key) ?? 0 }));
  }, [allVisible, statusFilter, mediaFilter]);

  const visiblePosts = useMemo(
    () =>
      allVisible.filter(
        (p) =>
          (statusFilter === 'all' || p.status === statusFilter) &&
          (monthFilter === ALL_MONTHS || getPostMonthKey(p) === monthFilter) &&
          (mediaFilter === 'all' || (mediaFilter === 'with') === postHasMedia(p)),
      ),
    [allVisible, statusFilter, monthFilter, mediaFilter],
  );

  // Filters start at "Todos", so a deep link never lands on a hidden post. What can:
  // a background refetch moving the OPEN post out of the active status filter
  // (the agency approved it meanwhile). Reset so the strip and prev/next match the grid.
  useEffect(() => {
    if (currentId === null || currentId === -1) return;
    if (!allVisible.some((p) => p.id === currentId)) return;
    if (visiblePosts.some((p) => p.id === currentId)) return;
    setStatusFilter('all');
    setMonthFilter(ALL_MONTHS);
    setMediaFilter('all');
  }, [currentId, allVisible, visiblePosts]);

  // MonthFilterDropdown unmounts itself with a single option, so a selected month that
  // vanishes in a refetch (its last post was deleted, unpublished or rescheduled) would leave
  // the grid empty with no control to clear it. Fall back to every month.
  useEffect(() => {
    if (monthFilter === ALL_MONTHS) return;
    if (monthOptions.length > 1 && monthOptions.some((o) => o.key === monthFilter)) return;
    setMonthFilter(ALL_MONTHS);
  }, [monthFilter, monthOptions]);

  const approvals = postApprovals;
  const instagramProfile = data?.instagramProfile ?? null;

  const { data: feedData } = useQuery({
    queryKey: ['hub-instagram-feed', token],
    queryFn: () => fetchInstagramFeed(token),
    enabled: showGrid && instagramProfile != null,
  });

  // Memoized on the query data + selection so the preview modal isn't handed a fresh
  // array reference (which would reset an in-progress reorder) on every background refetch.
  const selectedPosts = useMemo(
    () =>
      posts.filter((p) => isPostClientVisible(p) && isFeedSelectable(p) && selectedIds.has(p.id)),
    [posts, selectedIds],
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

  return (
    // No `.hub-fade-up` on this wrapper: its lingering transform would trap the filter bar's
    // `position: fixed` (see FloatingFilterBar). The header and content fade in on their own.
    <div className="max-w-5xl mx-auto">
      <div className="hub-fade-up">
        <PageHeader
          title={t('postagens.title', 'Postagens')}
          description={
            mode === 'select'
              ? t(
                  'postagens.selectHint',
                  'Selecione posts para visualizar e reordenar como ficarão no feed do Instagram.',
                )
              : t('postagens.defaultDescription', 'Todos os posts do seu calendário de conteúdo.')
          }
          action={
            instagramProfile && (
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
                  className="rounded-[4px] border hub-border px-3 py-2 text-[13px] font-semibold hub-tx2"
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

      {isLoading ? (
        <div className="hub-fade-up flex justify-center py-20">
          <div className="animate-spin h-6 w-6 rounded-full border-2 hub-spinner" />
        </div>
      ) : fatalError ? (
        <div className="hub-fade-up py-20 text-center text-sm hub-tx2">
          {t('postagens.loadError', 'Erro ao carregar postagens.')}
        </div>
      ) : allVisible.length === 0 ? (
        <p className="hub-fade-up text-sm hub-tx2">
          {hasOlder
            ? t('postagens.emptyRecent', 'Nenhuma postagem recente.')
            : t('postagens.empty', 'Nenhuma postagem disponível ainda.')}
        </p>
      ) : (
        <>
          <FloatingFilterBar>
            <MonthFilterDropdown
              value={monthFilter}
              options={monthOptions}
              onChange={setMonthFilter}
            />
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
            <StatusFilterChips
              value={statusFilter}
              counts={filterCounts}
              onChange={setStatusFilter}
              className="contents"
            />
          </FloatingFilterBar>
          {visiblePosts.length === 0 ? (
            <p className="hub-fade-up text-sm hub-tx2">
              {t('postagens.noResults', 'Nenhuma postagem encontrada para este filtro.')}
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
        </>
      )}

      {!isLoading && !fatalError && hasOlder && (
        <div className="hub-fade-up flex flex-col items-center gap-2 py-6">
          {olderError && !isLoadingOlder && (
            <p className="text-[13px] hub-tx2">
              {t('postagens.olderError', 'Não foi possível carregar os posts anteriores.')}
            </p>
          )}
          <button
            type="button"
            onClick={loadOlder}
            disabled={isLoadingOlder}
            className="hub-btn-secondary rounded-[4px] px-4 py-2 text-[13px] font-semibold disabled:opacity-60"
          >
            {isLoadingOlder
              ? t('postagens.loadingOlder', 'Carregando…')
              : olderError
                ? t('postagens.retryOlder', 'Tentar novamente')
                : t('postagens.loadOlder', 'Carregar posts anteriores')}
          </button>
        </div>
      )}

      {!isLoading && !fatalError && !(wantsSingle && single.isPending) && (
        <PostDetailDialog
          posts={singlePost ? [singlePost] : visiblePosts}
          currentId={currentId}
          token={token}
          approvals={singlePost ? (single.data?.postApprovals ?? []) : approvals}
          standalone={!!singlePost}
          instagramProfile={instagramProfile}
          workspaceName={bootstrap.workspace.name}
          isAutoPublish={(p) => isAutoPublishActive(data, p.workflow_id, p.id)}
          onNavigate={handleNavigate}
          onApprovalSubmitted={handleInvalidate}
        />
      )}

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
    </div>
  );
}
