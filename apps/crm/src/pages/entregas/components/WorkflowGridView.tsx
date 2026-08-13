import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  InstagramGrid,
  type GridItem,
  type GridProfile,
  type ReorderUpdate,
} from '@mesaas/ui/InstagramGrid';
import { supabase } from '@/lib/supabase';
import { getClientePosts } from '@/store';
import { getPostCovers } from '@/services/postMedia';
import { getInstagramPosts, reorderClientePostSchedules } from '@/services/instagram';

/** Agency-side reschedulable statuses (mirrors the CRM allowlist in the RPC). */
const CRM_MOVABLE = new Set([
  'rascunho',
  'revisao_interna',
  'aprovado_interno',
  'enviado_cliente',
  'aprovado_cliente',
  'correcao_cliente',
]);

/** A planned post is movable when reschedulable, or scheduled for a still-future slot. */
function plannedMovable(status: string, scheduledAt: string | null): boolean {
  if (CRM_MOVABLE.has(status)) return true;
  if (status === 'agendado')
    return !!scheduledAt && new Date(scheduledAt).getTime() > Date.now() + 600_000;
  return false;
}

function mediaTypeFor(tipo: string): string {
  if (tipo === 'carrossel') return 'CAROUSEL_ALBUM';
  if (tipo === 'reels') return 'VIDEO';
  return 'IMAGE';
}

interface WorkflowGridViewProps {
  clienteId: number;
  clienteNome: string;
}

/**
 * Entregas-drawer grid tab: the full Instagram grid for a client — planned posts
 * across every active workflow interleaved with the client's live Instagram feed
 * as fixed anchors — rendered through the shared <InstagramGrid/>. Dragging a
 * planned tile swaps publish dates (persisted via the CRM reorder endpoint).
 */
export function WorkflowGridView({ clienteId, clienteNome }: WorkflowGridViewProps) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['workflow-grid', clienteId],
    queryFn: async () => {
      const [account, planned] = await Promise.all([
        supabase
          .from('instagram_accounts')
          .select('username, profile_picture_url, follower_count, following_count, media_count')
          .eq('client_id', clienteId)
          .maybeSingle()
          .then((r) => r.data),
        getClientePosts(clienteId),
      ]);

      // Feed grid = non-story, Instagram-bound planned posts that are not already
      // live or failed. TikTok-only posts never belong on an IG grid (and must not
      // be reschedulable here); published posts come from the live feed, not the
      // planned set. Legacy rows have no platform → treated as Instagram.
      const plannedFeed = planned.filter(
        (p) =>
          p.tipo !== 'stories' &&
          p.platform !== 'tiktok' &&
          p.status !== 'postado' &&
          p.status !== 'falha_publicacao',
      );
      const covers = await getPostCovers(plannedFeed.map((p) => p.id));

      // Load up to ~30 recent live posts (matches the Hub feed preview). The edge
      // endpoint pages at 10, so walk pages until the cap or the feed runs out —
      // otherwise the "full grid" would only show the 10 newest live anchors.
      let live: Awaited<ReturnType<typeof getInstagramPosts>>['posts'] = [];
      if (account) {
        try {
          for (let page = 1; page <= 3; page++) {
            const res = await getInstagramPosts(clienteId, page);
            live = live.concat(res.posts);
            if (live.length >= res.total || res.posts.length < 10) break;
          }
        } catch {
          live = [];
        }
      }

      return { account, plannedFeed, covers, live };
    },
    staleTime: 30_000,
  });

  const profile: GridProfile | null = data?.account
    ? {
        username: data.account.username ?? clienteNome,
        profilePictureUrl: data.account.profile_picture_url ?? null,
        followerCount: data.account.follower_count ?? 0,
        followingCount: data.account.following_count ?? 0,
        mediaCount: data.account.media_count ?? 0,
      }
    : null;

  const items = useMemo<GridItem[]>(() => {
    if (!data) return [];
    const planned: GridItem[] = data.plannedFeed.map((p) => {
      const cover = data.covers.get(p.id);
      const isVideo = cover?.kind === 'video';
      const movable = plannedMovable(p.status, p.scheduled_at);
      // Grid always shows an image: full-res cover for photos, poster for videos.
      // (Rendering a <video> per tile is what made the grid slow, and the 128px
      // thumbnail is what made it look low-res — use the full url instead.)
      const img = isVideo
        ? (cover?.thumbnail_url ?? null)
        : (cover?.url ?? cover?.thumbnail_url ?? null);
      return {
        source: 'hub',
        mobility: movable ? 'movable' : 'fixed',
        id: `hub-${p.id}`,
        postId: p.id,
        status: p.status,
        thumbnailUrl: img,
        videoUrl: null,
        blurDataUrl: cover?.blur_data_url ?? null,
        mediaType: mediaTypeFor(p.tipo),
        isCarousel: p.tipo === 'carrossel',
        scheduledAt: p.scheduled_at,
        sortTs: p.scheduled_at ?? '',
      };
    });

    const live: GridItem[] = data.live.map((p) => ({
      source: 'live',
      mobility: 'fixed',
      id: `live-${p.id}`,
      postId: null,
      status: null,
      thumbnailUrl: p.thumbnail_url,
      videoUrl: null,
      mediaType: p.media_type,
      isCarousel: p.media_type === 'CAROUSEL_ALBUM',
      scheduledAt: null,
      sortTs: p.posted_at,
    }));

    return [...planned, ...live].sort((a, b) => (b.sortTs ?? '').localeCompare(a.sortTs ?? ''));
  }, [data]);

  const handleReorder = async (updates: ReorderUpdate[]) => {
    await reorderClientePostSchedules(clienteId, updates);
  };

  const handleSaved = () => {
    qc.invalidateQueries({ queryKey: ['workflow-grid', clienteId] });
    qc.invalidateQueries({ queryKey: ['clientePosts', clienteId] });
    qc.invalidateQueries({ queryKey: ['workflow-posts-with-props'] });
  };

  if (isLoading) {
    return <div className="drawer-empty">Carregando grade...</div>;
  }

  if (items.length === 0) {
    return (
      <div className="drawer-empty">
        Nenhum post para exibir na grade. Agende posts para ver como o feed vai ficar.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '16px' }}>
      <div
        style={{
          width: 'min(420px, 100%)',
          border: '0.5px solid var(--border-color)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <InstagramGrid
          items={items}
          profile={profile}
          onReorder={handleReorder}
          onSaved={handleSaved}
        />
      </div>
    </div>
  );
}
