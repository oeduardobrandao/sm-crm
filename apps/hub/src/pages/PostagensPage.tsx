import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { useHub } from '../HubContext';
import { fetchPosts, fetchInstagramFeed } from '../api';
import { FeedPreviewButton } from '../components/FeedPreviewButton';
import { PageHeader } from '../components/PageHeader';
import { InstagramGridPreview } from '../components/InstagramGridPreview';
import { StatusFilterChips, type StatusFilter } from '../components/StatusFilterChips';
import { MonthFilterDropdown, type MonthFilterOption } from '../components/MonthFilterDropdown';
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
  sortPostsChronologically,
} from '../lib/postView';
import { isAutoPublishActive } from '../lib/autoPublish';

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

  const { data, isLoading, isError } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
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
    () => sortPostsChronologically((data?.posts ?? []).filter(isPostClientVisible)),
    [data?.posts],
  );
  // The two filters are cross-faceted: each control's counts reflect the other's selection,
  // so a chip or month never advertises posts the current combination would hide.
  const inMonth = (p: { scheduled_at: string | null }) =>
    monthFilter === ALL_MONTHS || getPostMonthKey(p) === monthFilter;
  const monthScoped = allVisible.filter(inMonth);
  const filterCounts: Record<StatusFilter, number> = {
    all: monthScoped.length,
    enviado_cliente: monthScoped.filter((p) => p.status === 'enviado_cliente').length,
    correcao_cliente: monthScoped.filter((p) => p.status === 'correcao_cliente').length,
    aprovado_cliente: monthScoped.filter((p) => p.status === 'aprovado_cliente').length,
  };
  // Which months exist comes from every visible post (so choosing a status never removes the
  // selected month from under the user); each month's count respects the status filter.
  const monthOptions = useMemo<MonthFilterOption[]>(() => {
    const counts = countPostsByMonth(
      allVisible.filter((p) => statusFilter === 'all' || p.status === statusFilter),
    );
    return groupPostsByMonth(allVisible).map(({ key }) => ({ key, count: counts.get(key) ?? 0 }));
  }, [allVisible, statusFilter]);

  const visiblePosts = useMemo(
    () =>
      allVisible.filter(
        (p) =>
          (statusFilter === 'all' || p.status === statusFilter) &&
          (monthFilter === ALL_MONTHS || getPostMonthKey(p) === monthFilter),
      ),
    [allVisible, statusFilter, monthFilter],
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
  }, [currentId, allVisible, visiblePosts]);

  // MonthFilterDropdown unmounts itself with a single option, so a selected month that
  // vanishes in a refetch (its last post was deleted, unpublished or rescheduled) would leave
  // the grid empty with no control to clear it. Fall back to every month.
  useEffect(() => {
    if (monthFilter === ALL_MONTHS) return;
    if (monthOptions.length > 1 && monthOptions.some((o) => o.key === monthFilter)) return;
    setMonthFilter(ALL_MONTHS);
  }, [monthFilter, monthOptions]);

  const approvals = data?.postApprovals ?? [];
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
      (data?.posts ?? []).filter(
        (p) => isPostClientVisible(p) && isFeedSelectable(p) && selectedIds.has(p.id),
      ),
    [data?.posts, selectedIds],
  );

  const handleToggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const handleInvalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: ['hub-posts', token] }),
    [qc, token],
  );
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
    <div className="max-w-5xl mx-auto hub-fade-up">
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
                {mode === 'select' ? t('posts.done', 'Concluir') : t('posts.select', 'Selecionar')}
              </button>
            </span>
          )
        }
      />

      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
        </div>
      ) : fatalError ? (
        <div className="py-20 text-center text-sm hub-tx2">
          {t('postagens.loadError', 'Erro ao carregar postagens.')}
        </div>
      ) : allVisible.length === 0 ? (
        <p className="text-sm hub-tx2">
          {t('postagens.empty', 'Nenhuma postagem disponível ainda.')}
        </p>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-1.5">
            <MonthFilterDropdown
              value={monthFilter}
              options={monthOptions}
              onChange={setMonthFilter}
            />
            <StatusFilterChips
              value={statusFilter}
              counts={filterCounts}
              onChange={setStatusFilter}
              className="contents"
            />
          </div>
          {visiblePosts.length === 0 ? (
            <p className="text-sm hub-tx2">
              {t('postagens.noResults', 'Nenhuma postagem encontrada para este filtro.')}
            </p>
          ) : (
            <PostGrid
              posts={visiblePosts}
              mode={mode}
              selectedIds={selectedIds}
              onOpen={handleOpen}
              onToggle={handleToggleSelect}
            />
          )}
        </>
      )}

      {!isLoading && !fatalError && (
        <PostDetailDialog
          posts={visiblePosts}
          currentId={currentId}
          token={token}
          approvals={approvals}
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
