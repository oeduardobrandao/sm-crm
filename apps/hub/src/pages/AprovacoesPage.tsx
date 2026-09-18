import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { useHub } from '../HubContext';
import { fetchPosts, fetchInstagramFeed } from '../api';
import { FeedPreviewButton } from '../components/FeedPreviewButton';
import { PageHeader } from '../components/PageHeader';
import { InstagramGridPreview } from '../components/InstagramGridPreview';
import { PostGrid } from '../components/posts/PostGrid';
import { PostDetailDialog } from '../components/posts/PostDetailDialog';
import { isFeedSelectable, type TileMode } from '../components/posts/PostTile';
import { isAutoPublishActive } from '../lib/autoPublish';
import { sortPostsChronologically } from '../lib/postView';

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

  const { data, isLoading, isError } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
  });
  const { data: feedData } = useQuery({
    queryKey: ['hub-instagram-feed', token],
    queryFn: () => fetchInstagramFeed(token),
    enabled: showGrid && data?.instagramProfile != null,
  });

  const approvals = data?.postApprovals ?? [];
  const instagramProfile = data?.instagramProfile ?? null;
  const pending = useMemo(
    () =>
      sortPostsChronologically((data?.posts ?? []).filter((p) => p.status === 'enviado_cliente')),
    [data?.posts],
  );
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
    isLoading || isError
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
                className="rounded-[var(--hub-r-ctl)] border hub-border px-3 py-2 text-[13px] font-semibold hub-tx2"
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
      ) : isError ? (
        <div className="py-20 text-center text-sm hub-tx2">
          {t('aprovacoes.loadError', 'Erro ao carregar aprovações.')}
        </div>
      ) : (
        <>
          <PostGrid
            posts={pending}
            mode={mode}
            selectedIds={selectedIds}
            onOpen={handleOpen}
            onToggle={handleToggleSelect}
          />
          <PostDetailDialog
            posts={pending}
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
