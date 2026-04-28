import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchPosts } from '../api';
import { InstagramPostCard } from '../components/InstagramPostCard';
import { StoryPostCard } from '../components/StoryPostCard';
import { TextPostCard } from '../components/TextPostCard';
import type { HubPost } from '../types';

const VISIBLE_STATUSES = new Set<HubPost['status']>([
  'enviado_cliente', 'aprovado_cliente', 'correcao_cliente', 'agendado', 'postado', 'falha_publicacao',
]);

const STATUS_COLORS: Record<string, string> = {
  enviado_cliente: '#f5a342',
  aprovado_cliente: '#3ecf8e',
  correcao_cliente: '#f55a42',
  agendado: '#42c8f5',
  postado: '#eab308',
  falha_publicacao: '#f55a42',
};

const STATUS_LABELS: Record<string, string> = {
  enviado_cliente: 'Aguardando aprovação',
  aprovado_cliente: 'Aprovado',
  correcao_cliente: 'Correção solicitada',
  agendado: 'Agendado',
  postado: 'Publicado',
  falha_publicacao: 'Falha na publicação',
};

const LOCKED_STATUSES = new Set(['agendado', 'postado', 'falha_publicacao']);

function StatusTag({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? '#94a3b8';
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: '0.65rem',
        fontWeight: 600,
        letterSpacing: '0.02em',
        color,
        background: `${color}14`,
        border: `1px solid ${color}30`,
        borderRadius: 6,
        padding: '0.2rem 0.5rem',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

export function PostagensPage() {
  const { token, bootstrap } = useHub();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { data, isLoading, isError } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
  });

  const allPosts = (data?.posts ?? []).filter(p => VISIBLE_STATUSES.has(p.status));
  const approvals = data?.postApprovals ?? [];
  const instagramProfile = data?.instagramProfile ?? null;

  const groups = Object.values(
    allPosts.reduce<Record<number, { titulo: string; posts: HubPost[] }>>((acc, post) => {
      if (!acc[post.workflow_id]) {
        acc[post.workflow_id] = { titulo: post.workflow_titulo, posts: [] };
      }
      acc[post.workflow_id].posts.push(post);
      return acc;
    }, {})
  ).sort((a, b) => {
    const aDate = a.posts[0]?.workflow_created_at ?? '';
    const bDate = b.posts[0]?.workflow_created_at ?? '';
    return bDate.localeCompare(aDate);
  });

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
    <div className="max-w-5xl mx-auto py-20 text-center text-sm text-stone-500">
      Erro ao carregar postagens.
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto hub-fade-up">
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
          {groups.map(group => {
            const withMedia = group.posts.filter(p => p.media.length > 0 && p.tipo !== 'stories');
            const stories = group.posts.filter(p => p.media.length > 0 && p.tipo === 'stories');
            const withoutMedia = group.posts.filter(p => p.media.length === 0);

            return (
              <section key={group.titulo}>
                <button
                  type="button"
                  className="flex items-center gap-2 mb-4 w-full text-left group"
                  onClick={() => setCollapsed(prev => {
                    const next = new Set(prev);
                    if (next.has(group.titulo)) next.delete(group.titulo);
                    else next.add(group.titulo);
                    return next;
                  })}
                >
                  <span className="h-[1px] w-6 bg-stone-300" />
                  <h3 className="font-display text-[17px] font-semibold tracking-tight text-stone-900">{group.titulo}</h3>
                  <span className="text-[11px] text-stone-400">{group.posts.length} {group.posts.length === 1 ? 'post' : 'posts'}</span>
                  <ChevronDown size={16} className={`ml-auto text-stone-400 transition-transform ${collapsed.has(group.titulo) ? '-rotate-90' : ''}`} />
                </button>

                {!collapsed.has(group.titulo) && withMedia.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {withMedia.map((post, i) => (
                      <div key={post.id} className="flex flex-col gap-1.5">
                        <StatusTag status={post.status} />
                        <InstagramPostCard
                          post={post}
                          token={token}
                          approvals={approvals}
                          instagramProfile={instagramProfile}
                          workspaceName={bootstrap.workspace.name}
                          readOnly
                          priority={i === 0}
                          autoPublishOnApproval={data?.autoPublishOnApproval ?? false}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {!collapsed.has(group.titulo) && stories.length > 0 && (
                  <div className={withMedia.length > 0 ? 'mt-4' : ''}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {stories.map(post => (
                        <div key={post.id} className="flex flex-col gap-1.5">
                          <StatusTag status={post.status} />
                          <StoryPostCard
                            post={post}
                            token={token}
                            approvals={approvals}
                            instagramProfile={instagramProfile}
                            workspaceName={bootstrap.workspace.name}
                            readOnly
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!collapsed.has(group.titulo) && withoutMedia.length > 0 && (
                  <div className={(withMedia.length > 0 || stories.length > 0) ? 'mt-4' : ''}>
                    <div className="max-w-[640px] space-y-3">
                      {withoutMedia.map(post => (
                        <div key={post.id} className="flex flex-col gap-1.5">
                          <StatusTag status={post.status} />
                          <TextPostCard
                            post={post}
                            token={token}
                            approvals={approvals}
                            readOnly
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
