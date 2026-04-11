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
      <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto hub-fade-up">
      <header className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500 font-medium mb-2">
          <span className="accent-bar" />Sua revisão
        </p>
        <h2 className="font-display text-[2rem] sm:text-[2.25rem] leading-[1.05] font-medium tracking-tight text-stone-900 mb-2">Aprovações</h2>
        <p className="text-[14px] text-stone-500">
          {pending.length === 0
            ? 'Tudo em dia. Nenhum post aguardando aprovação.'
            : `${pending.length} post${pending.length > 1 ? 's' : ''} aguardando sua aprovação.`}
        </p>
      </header>
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
