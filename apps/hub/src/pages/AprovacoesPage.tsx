import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useHub } from '../HubContext';
import { fetchPosts } from '../api';
import { PostCard } from '../components/PostCard';

export function AprovacoesPage() {
  const { token } = useHub();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
  });

  const approvals = data?.postApprovals ?? [];
  const propertyValues = data?.propertyValues ?? [];
  const workflowSelectOptions = data?.workflowSelectOptions ?? [];
  const pending = (data?.posts ?? [])
    .filter(p => p.status === 'enviado_cliente')
    .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''));

  if (isLoading) return (
    <div className="flex justify-center py-20">
      <div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-1">Aprovações</h2>
      <p className="text-sm text-muted-foreground mb-6">
        {pending.length === 0
          ? 'Nenhum post aguardando aprovação.'
          : `${pending.length} post${pending.length > 1 ? 's' : ''} aguardando sua aprovação.`}
      </p>
      <div className="space-y-3">
        {pending.map(post => (
          <PostCard
            key={post.id}
            post={post}
            token={token}
            approvals={approvals}
            propertyValues={propertyValues}
            workflowSelectOptions={workflowSelectOptions}
            onApprovalSubmitted={() => qc.invalidateQueries({ queryKey: ['hub-posts', token] })}
          />
        ))}
      </div>
    </div>
  );
}
