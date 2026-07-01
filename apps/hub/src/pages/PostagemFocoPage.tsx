import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchPosts } from '../api';
import { isClientVisible, pickPostCardKind } from '../lib/postView';
import { InstagramPostCard } from '../components/InstagramPostCard';
import { StoryPostCard } from '../components/StoryPostCard';
import { TextPostCard } from '../components/TextPostCard';
import { SharePostButton } from '../components/SharePostButton';

export function PostagemFocoPage() {
  const { token, workspace, bootstrap } = useHub();
  const { postId } = useParams<{ postId: string }>();
  const base = `/${workspace}/hub/${token}`;
  const id = parseInt(postId ?? '', 10);
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
  });

  const backLink = (
    <Link
      to={`${base}/postagens`}
      className="inline-flex items-center gap-1.5 text-[13px] text-stone-500 hover:text-stone-900 mb-8 group transition-colors"
    >
      <ArrowLeft size={15} className="group-hover:-translate-x-0.5 transition-transform" /> Ver
      todas as postagens
    </Link>
  );

  if (isLoading)
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
      </div>
    );

  if (isError)
    return (
      <div className="max-w-3xl mx-auto py-16 text-center">
        <p className="text-sm text-stone-500 mb-4">Não foi possível carregar esta postagem.</p>
        <button
          onClick={() => refetch()}
          className="text-[13px] font-medium text-stone-900 underline decoration-[#FFBF30] decoration-2 underline-offset-4"
        >
          Tentar novamente
        </button>
      </div>
    );

  const post = !isNaN(id) ? data?.posts.find((p) => p.id === id) : undefined;

  if (!post || !isClientVisible(post.status))
    return (
      <div className="max-w-3xl mx-auto hub-fade-up">
        {backLink}
        <div className="py-8 text-stone-500">Esta postagem não está disponível.</div>
      </div>
    );

  const approvals = data?.postApprovals ?? [];
  const onApprovalSubmitted = () => qc.invalidateQueries({ queryKey: ['hub-posts', token] });
  const kind = pickPostCardKind(post);

  return (
    <div className="max-w-3xl mx-auto hub-fade-up">
      {backLink}
      <div className="flex items-center justify-between mb-2">
        <SharePostButton postId={post.id} />
      </div>
      <div className="flex flex-col gap-1.5">
        {kind === 'instagram' && (
          <InstagramPostCard
            post={post}
            token={token}
            approvals={approvals}
            instagramProfile={data?.instagramProfile ?? null}
            workspaceName={bootstrap.workspace.name}
            onApprovalSubmitted={onApprovalSubmitted}
            autoPublishOnApproval={data?.autoPublishOnApproval ?? false}
          />
        )}
        {kind === 'story' && (
          <StoryPostCard
            post={post}
            token={token}
            approvals={approvals}
            instagramProfile={data?.instagramProfile ?? null}
            workspaceName={bootstrap.workspace.name}
            onApprovalSubmitted={onApprovalSubmitted}
          />
        )}
        {kind === 'text' && (
          <TextPostCard
            post={post}
            token={token}
            approvals={approvals}
            onApprovalSubmitted={onApprovalSubmitted}
          />
        )}
      </div>
    </div>
  );
}
