import { useState } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useHub } from '../HubContext';
import { fetchPosts, fetchInstagramFeed } from '../api';
import { InstagramPostCard } from '../components/InstagramPostCard';
import { StoryPostCard } from '../components/StoryPostCard';
import { TextPostCard } from '../components/TextPostCard';
import { FeedPreviewButton } from '../components/FeedPreviewButton';
import { InstagramGridPreview } from '../components/InstagramGridPreview';

export function AprovacoesPage() {
  const { token, bootstrap } = useHub();
  const qc = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showGrid, setShowGrid] = useState(false);

  const { data, isLoading } = useQuery({
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
  const pending = (data?.posts ?? [])
    .filter(p => p.status === 'enviado_cliente')
    .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''));

  const withMedia = pending.filter(p => p.media.length > 0 && p.tipo !== 'stories');
  const stories = pending.filter(p => p.media.length > 0 && p.tipo === 'stories');
  const withoutMedia = pending.filter(p => p.media.length === 0);

  function handleToggleSelect(postId: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }

  function handleInvalidate() {
    qc.invalidateQueries({ queryKey: ['hub-posts', token] });
  }

  if (isLoading) return (
    <div className="flex justify-center py-20">
      <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
    </div>
  );

  const selectedPosts = withMedia.filter(p => selectedIds.has(p.id));

  return (
    <div className="max-w-5xl mx-auto hub-fade-up">
      <header className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500 font-medium mb-2">
          <span className="accent-bar" />Sua revisão
        </p>
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-[2rem] sm:text-[2.25rem] leading-[1.05] font-medium tracking-tight text-stone-900">Aprovações</h2>
          {instagramProfile && (
            <FeedPreviewButton selectedCount={selectedIds.size} onClick={() => setShowGrid(true)} />
          )}
        </div>
        <p className="text-[14px] text-stone-500 mt-2">
          {pending.length === 0
            ? 'Tudo em dia. Nenhum post aguardando aprovação.'
            : `${pending.length} post${pending.length > 1 ? 's' : ''} aguardando sua aprovação.`}
        </p>
      </header>

      {withMedia.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {withMedia.map(post => (
              <InstagramPostCard
                key={post.id}
                post={post}
                token={token}
                approvals={approvals}
                instagramProfile={instagramProfile}
                workspaceName={bootstrap.workspace.name}
                isSelected={selectedIds.has(post.id)}
                onToggleSelect={handleToggleSelect}
                onApprovalSubmitted={handleInvalidate}
              />
            ))}
          </div>
        </>
      )}

      {stories.length > 0 && (
        <div className={withMedia.length > 0 ? 'mt-10 pt-8 border-t border-stone-200' : ''}>
          {withMedia.length > 0 && (
            <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500 font-medium mb-4">
              <span className="accent-bar" />Stories
            </p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {stories.map(post => (
              <StoryPostCard
                key={post.id}
                post={post}
                token={token}
                approvals={approvals}
                instagramProfile={instagramProfile}
                workspaceName={bootstrap.workspace.name}
                onApprovalSubmitted={handleInvalidate}
              />
            ))}
          </div>
        </div>
      )}

      {withoutMedia.length > 0 && (
        <div className={(withMedia.length > 0 || stories.length > 0) ? 'mt-10 pt-8 border-t border-stone-200' : ''}>
          {(withMedia.length > 0 || stories.length > 0) && (
            <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500 font-medium mb-4">
              <span className="accent-bar" />Posts sem mídia
            </p>
          )}
          <div className="max-w-[640px] space-y-3">
            {withoutMedia.map(post => (
              <TextPostCard
                key={post.id}
                post={post}
                token={token}
                approvals={approvals}
                onApprovalSubmitted={handleInvalidate}
              />
            ))}
          </div>
        </div>
      )}

      {showGrid && feedData && (
        <InstagramGridPreview
          selectedPosts={selectedPosts}
          feedProfile={feedData.profile}
          livePosts={feedData.recentPosts}
          onClose={() => setShowGrid(false)}
        />
      )}
    </div>
  );
}
