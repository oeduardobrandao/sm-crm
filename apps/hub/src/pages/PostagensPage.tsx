import { useState, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchPosts, fetchInstagramFeed } from '../api';
import { InstagramPostCard } from '../components/InstagramPostCard';
import { StoryPostCard } from '../components/StoryPostCard';
import { TextPostCard } from '../components/TextPostCard';
import { FeedPreviewButton } from '../components/FeedPreviewButton';
import { InstagramGridPreview } from '../components/InstagramGridPreview';
import type { HubPost } from '../types';
import { VISIBLE_STATUSES } from '../lib/postView';
import { SharePostButton } from '../components/SharePostButton';
import { OpenPostLink } from '../components/OpenPostLink';

const STATUS_COLORS: Record<string, string> = {
  enviado_cliente: '#f5a342',
  aprovado_cliente: '#3ecf8e',
  correcao_cliente: '#f55a42',
  agendado: '#42c8f5',
  publicando: '#E1306C',
  postado: '#eab308',
  falha_publicacao: '#f55a42',
};

const STATUS_LABELS: Record<string, string> = {
  enviado_cliente: 'Aguardando aprovação',
  aprovado_cliente: 'Aprovado',
  correcao_cliente: 'Correção solicitada',
  agendado: 'Agendado',
  publicando: 'Publicando…',
  postado: 'Publicado',
  falha_publicacao: 'Falha na publicação',
};

const LOCKED_STATUSES = new Set(['agendado', 'postado', 'falha_publicacao']);

/**
 * Presentational-only state (not a DB status): a post that is `agendado` with its
 * scheduled time already passed is being published right now. Derived from existing
 * fields so the client portal shows "Publicando…" while the cron works on it.
 */
function getPostPublishState(p: {
  status: HubPost['status'];
  scheduled_at: string | null;
}): string {
  return p.status === 'agendado' && !!p.scheduled_at && new Date(p.scheduled_at) <= new Date()
    ? 'publicando'
    : p.status;
}

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
      <span
        style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }}
      />
      {label}
    </span>
  );
}

export function PostagensPage() {
  const { token, bootstrap } = useHub();
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState<Set<string> | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showGrid, setShowGrid] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
    // Poll while a post is mid-publishing so the client sees it flip to "Publicado"
    // on its own; stops once nothing is publishing.
    refetchInterval: (query) =>
      (query.state.data?.posts ?? []).some((p) => getPostPublishState(p) === 'publicando')
        ? 15000
        : false,
  });

  const allPosts = (data?.posts ?? []).filter((p) => VISIBLE_STATUSES.has(p.status));
  const approvals = data?.postApprovals ?? [];
  const instagramProfile = data?.instagramProfile ?? null;

  const { data: feedData } = useQuery({
    queryKey: ['hub-instagram-feed', token],
    queryFn: () => fetchInstagramFeed(token),
    enabled: showGrid && instagramProfile != null,
  });

  // Only feed-compatible posts (media, not stories) can be selected for the preview.
  const feedSelectable = allPosts.filter((p) => p.media.length > 0 && p.tipo !== 'stories');
  const selectedPosts = feedSelectable.filter((p) => selectedIds.has(p.id));

  function handleToggleSelect(postId: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }

  function handleInvalidate() {
    qc.invalidateQueries({ queryKey: ['hub-posts', token] });
  }

  const groups = useMemo(
    () =>
      Object.values(
        allPosts.reduce<Record<number, { titulo: string; posts: HubPost[] }>>((acc, post) => {
          if (!acc[post.workflow_id]) {
            acc[post.workflow_id] = { titulo: post.workflow_titulo, posts: [] };
          }
          acc[post.workflow_id].posts.push(post);
          return acc;
        }, {}),
      ).sort((a, b) => {
        const aDate = a.posts[0]?.workflow_created_at ?? '';
        const bDate = b.posts[0]?.workflow_created_at ?? '';
        return bDate.localeCompare(aDate);
      }),
    [allPosts],
  );

  const initializedRef = useRef(false);
  if (!initializedRef.current && groups.length > 0 && collapsed === null) {
    initializedRef.current = true;
    setCollapsed(new Set(groups.slice(1).map((g) => g.titulo)));
  }
  const effectiveCollapsed = collapsed ?? new Set<string>();

  groups.forEach((g) => {
    g.posts.sort((a, b) => {
      if (!a.scheduled_at && !b.scheduled_at) return a.ordem - b.ordem;
      if (!a.scheduled_at) return 1;
      if (!b.scheduled_at) return -1;
      const diff = a.scheduled_at.localeCompare(b.scheduled_at);
      return diff !== 0 ? diff : a.ordem - b.ordem;
    });
  });

  if (isLoading)
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
      </div>
    );

  if (isError)
    return (
      <div className="max-w-5xl mx-auto py-20 text-center text-sm text-stone-500">
        Erro ao carregar postagens.
      </div>
    );

  return (
    <div className="max-w-5xl mx-auto hub-fade-up">
      <header className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500 font-medium mb-2">
          <span className="accent-bar" />
          Calendário editorial
        </p>
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-[2rem] sm:text-[2.25rem] leading-[1.05] font-medium tracking-tight text-stone-900">
            Postagens
          </h2>
          {instagramProfile && (
            <FeedPreviewButton selectedCount={selectedPosts.length} onClick={() => setShowGrid(true)} />
          )}
        </div>
        {instagramProfile && feedSelectable.length > 0 && selectedPosts.length === 0 && (
          <p className="text-[12px] text-stone-400 mt-2 flex items-center gap-1.5">
            <svg
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
              className="shrink-0"
            >
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
            Selecione posts para visualizar e reordenar como ficarão no feed do Instagram.
          </p>
        )}
      </header>

      {groups.length === 0 ? (
        <p className="text-sm text-stone-500">Nenhuma postagem disponível ainda.</p>
      ) : (
        <div className="space-y-10">
          {groups.map((group) => {
            const withMedia = group.posts.filter((p) => p.media.length > 0 && p.tipo !== 'stories');
            const stories = group.posts.filter((p) => p.media.length > 0 && p.tipo === 'stories');
            const withoutMedia = group.posts.filter((p) => p.media.length === 0);

            return (
              <section key={group.titulo}>
                <button
                  type="button"
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-4 w-full text-left group"
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev ?? new Set<string>());
                      if (next.has(group.titulo)) next.delete(group.titulo);
                      else next.add(group.titulo);
                      return next;
                    })
                  }
                >
                  <span className="h-[1px] w-6 bg-stone-300 hidden sm:block" />
                  <h3 className="font-display text-[17px] font-semibold tracking-tight text-stone-900">
                    {group.titulo}
                  </h3>
                  <span className="text-[11px] text-stone-400">
                    {group.posts.length} {group.posts.length === 1 ? 'post' : 'posts'}
                  </span>
                  {effectiveCollapsed.has(group.titulo) && (
                    <span className="text-[10px] text-stone-300 dark:text-stone-600 hidden sm:inline">
                      clique para expandir
                    </span>
                  )}
                  <ChevronDown
                    size={16}
                    className={`ml-auto text-stone-400 transition-transform ${effectiveCollapsed.has(group.titulo) ? '-rotate-90' : ''}`}
                  />
                </button>

                {!effectiveCollapsed.has(group.titulo) && withMedia.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {withMedia.map((post, i) => (
                      <div key={post.id} className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <StatusTag status={getPostPublishState(post)} />
                          <span className="flex items-center gap-3">
                            <OpenPostLink postId={post.id} />
                            <SharePostButton postId={post.id} />
                          </span>
                        </div>
                        <InstagramPostCard
                          post={post}
                          token={token}
                          approvals={approvals}
                          instagramProfile={instagramProfile}
                          workspaceName={bootstrap.workspace.name}
                          readOnly
                          isSelected={selectedIds.has(post.id)}
                          onToggleSelect={instagramProfile ? handleToggleSelect : undefined}
                          priority={i === 0}
                          autoPublishOnApproval={data?.autoPublishOnApproval ?? false}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {!effectiveCollapsed.has(group.titulo) && stories.length > 0 && (
                  <div className={withMedia.length > 0 ? 'mt-4' : ''}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {stories.map((post) => (
                        <div key={post.id} className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <StatusTag status={getPostPublishState(post)} />
                            <span className="flex items-center gap-3">
                              <OpenPostLink postId={post.id} />
                              <SharePostButton postId={post.id} />
                            </span>
                          </div>
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

                {!effectiveCollapsed.has(group.titulo) && withoutMedia.length > 0 && (
                  <div className={withMedia.length > 0 || stories.length > 0 ? 'mt-4' : ''}>
                    <div className="max-w-[640px] space-y-3">
                      {withoutMedia.map((post) => (
                        <div key={post.id} className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <StatusTag status={getPostPublishState(post)} />
                            <span className="flex items-center gap-3">
                              <OpenPostLink postId={post.id} />
                              <SharePostButton postId={post.id} />
                            </span>
                          </div>
                          <TextPostCard post={post} token={token} approvals={approvals} readOnly />
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

      {showGrid && feedData && (
        <InstagramGridPreview
          selectedPosts={selectedPosts}
          feedProfile={feedData.profile}
          livePosts={feedData.recentPosts}
          token={token}
          onClose={() => setShowGrid(false)}
          onScheduleUpdated={handleInvalidate}
        />
      )}
    </div>
  );
}
