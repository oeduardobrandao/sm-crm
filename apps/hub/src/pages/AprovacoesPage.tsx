import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { useHub } from '../HubContext';
import { fetchPosts, fetchInstagramFeed } from '../api';
import { FeedPreviewButton } from '../components/FeedPreviewButton';
import { PageHeader } from '../components/PageHeader';
import { MediaFilterChips, type MediaFilter } from '../components/MediaFilterChips';
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

function SortToggle({
  value,
  onChange,
}: {
  value: PostSortDirection;
  onChange: (value: PostSortDirection) => void;
}) {
  const { t } = useTranslation('hubPosts');
  const options: { key: PostSortDirection; label: string }[] = [
    { key: 'asc', label: t('aprovacoes.sort.oldest', 'Mais antigos') },
    { key: 'desc', label: t('aprovacoes.sort.newest', 'Mais recentes') },
  ];
  return (
    <div
      role="group"
      aria-label={t('aprovacoes.sort.label', 'Ordenar por')}
      className="inline-flex overflow-hidden rounded-full border"
      style={{ borderColor: 'var(--hub-bd)' }}
    >
      {options.map((opt) => {
        const selected = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(opt.key)}
            className="px-3 py-1 text-[12px] font-semibold transition-colors"
            style={
              selected
                ? { background: 'var(--hub-txt)', color: 'var(--hub-card)' }
                : { color: 'var(--hub-tx2)' }
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function AprovacoesPage() {
  const { t } = useTranslation('hubPosts');
  const { token, workspace, bootstrap } = useHub();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { postId } = useParams<{ postId: string }>();
  const base = `/${workspace}/hub/${token}/aprovacoes`;
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

  const { data, isLoading, isError } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
  });
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
    return { all: pending.length, withMedia, withoutMedia: pending.length - withMedia };
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

  // The count/empty line is only truthful once the fetch has succeeded; while loading or
  // after a failure "Tudo em dia" would claim an empty queue we haven't actually seen.
  const description =
    isLoading || fatalError
      ? undefined
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
    <div className="max-w-5xl mx-auto hub-fade-up">
      <PageHeader
        title={t('aprovacoes.title', 'Aprovações')}
        description={description}
        action={
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
          {t('aprovacoes.loadError', 'Erro ao carregar aprovações.')}
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <MediaFilterChips
                value={mediaFilter}
                counts={mediaCounts}
                onChange={setMediaFilter}
              />
              <SortToggle value={sortDir} onChange={setSortDir} />
            </div>
          )}
          {pending.length > 0 && visiblePosts.length === 0 ? (
            <p className="text-sm hub-tx2">
              {t('aprovacoes.noResults', 'Nenhum post encontrado para este filtro.')}
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
          <PostDetailDialog
            fallbackTitle={t('aprovacoes.title', 'Aprovações')}
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
