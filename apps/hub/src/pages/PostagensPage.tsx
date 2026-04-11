import { useQueryClient, useQuery } from '@tanstack/react-query';
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
      <div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );

  if (isError) return (
    <div className="max-w-2xl mx-auto py-20 text-center text-sm text-muted-foreground">
      Erro ao carregar postagens.
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-6">Postagens</h2>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma postagem disponível ainda.</p>
      ) : (
        <div className="space-y-10">
          {groups.map(group => (
            <section key={group.titulo}>
              <h3 className="text-base font-semibold mb-3 text-foreground">{group.titulo}</h3>
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
