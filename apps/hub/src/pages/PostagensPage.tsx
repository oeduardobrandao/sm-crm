import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useHub } from '../HubContext';
import { fetchPosts } from '../api';
import { PostCard } from '../components/PostCard';
import type { HubPost } from '../types';

const VISIBLE_STATUSES = new Set<HubPost['status']>([
  'enviado_cliente', 'aprovado_cliente', 'correcao_cliente', 'agendado', 'publicado',
]);

export function PostagensPage() {
  const { token } = useHub();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const expandPostId = searchParams.get('post') ? Number(searchParams.get('post')) : null;
  const { data, isLoading, isError } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
  });

  const allPosts = (data?.posts ?? []).filter(p => VISIBLE_STATUSES.has(p.status));
  const approvals = data?.postApprovals ?? [];
  const propertyValues = data?.propertyValues ?? [];
  const workflowSelectOptions = data?.workflowSelectOptions ?? [];

  // Group by workflow_id, sorted by workflow_titulo alphabetically
  const groups = Object.values(
    allPosts.reduce<Record<number, { titulo: string; posts: HubPost[] }>>((acc, post) => {
      if (!acc[post.workflow_id]) {
        acc[post.workflow_id] = { titulo: post.workflow_titulo, posts: [] };
      }
      acc[post.workflow_id].posts.push(post);
      return acc;
    }, {})
  ).sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));

  // Within each group: sort by scheduled_at asc (nulls last), then by ordem
  groups.forEach(g => {
    g.posts.sort((a, b) => {
      if (!a.scheduled_at && !b.scheduled_at) return a.ordem - b.ordem;
      if (!a.scheduled_at) return 1;
      if (!b.scheduled_at) return -1;
      const diff = a.scheduled_at.localeCompare(b.scheduled_at);
      return diff !== 0 ? diff : a.ordem - b.ordem;
    });
  });

  if (isLoading) return (
    <div className="flex justify-center py-20">
      <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
    </div>
  );

  if (isError) return (
    <div className="max-w-3xl mx-auto py-20 text-center text-sm text-stone-500">
      Erro ao carregar postagens.
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto hub-fade-up">
      <header className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500 font-medium mb-2">
          <span className="accent-bar" />Calendário editorial
        </p>
        <h2 className="font-display text-[2rem] sm:text-[2.25rem] leading-[1.05] font-medium tracking-tight text-stone-900">Postagens</h2>
      </header>

      {groups.length === 0 ? (
        <p className="text-sm text-stone-500">Nenhuma postagem disponível ainda.</p>
      ) : (
        <div className="space-y-10">
          {groups.map(group => (
            <section key={group.titulo}>
              <div className="flex items-center gap-2 mb-4">
                <span className="h-[1px] w-6 bg-stone-300" />
                <h3 className="font-display text-[17px] font-semibold tracking-tight text-stone-900">{group.titulo}</h3>
                <span className="text-[11px] text-stone-400">{group.posts.length} {group.posts.length === 1 ? 'post' : 'posts'}</span>
              </div>
              <div className="space-y-3">
                {group.posts.map(post => (
                  <PostCard
                    key={post.id}
                    post={post}
                    token={token}
                    approvals={approvals}
                    propertyValues={propertyValues}
                    workflowSelectOptions={workflowSelectOptions}
                    onApprovalSubmitted={() => qc.invalidateQueries({ queryKey: ['hub-posts', token] })}
                    defaultExpanded={expandPostId === post.id}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
