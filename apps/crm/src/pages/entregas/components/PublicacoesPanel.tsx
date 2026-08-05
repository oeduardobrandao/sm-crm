import { ExternalLink, ChevronRight } from 'lucide-react';
import type { ScheduledPost, WorkflowPost, IgAccountStatus } from '@/store';
import { ScheduleButton } from './ScheduleButton';
import { formatPostDate } from '@/utils/postDate';
import { TIPO_LABELS } from '../postLabels';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import { PostStatusChip } from './PostStatusChip';
import { sanitizeUrl } from '@/router';

interface PublicacoesPanelProps {
  posts: ScheduledPost[];
  igStatuses: Map<number, IgAccountStatus>;
  openableWorkflowIds: Set<number>;
  isLoading: boolean;
  selectedLabel: string | null;
  onPostClick: (workflowId: number, postId: number) => void;
  onStatusChange: () => void;
}

// ScheduleButton only reads id/status/tipo/scheduled_at/ig_caption/publish_error plus
// platform/tiktok_* (to route to the right platform service); the rest are filled
// with inert defaults so we never fetch the heavy `conteudo`.
function toWorkflowPost(p: ScheduledPost): WorkflowPost {
  return {
    id: p.id,
    workflow_id: p.workflow_id,
    titulo: p.titulo,
    conteudo: null,
    conteudo_plain: '',
    tipo: p.tipo,
    ordem: p.ordem,
    status: p.status,
    responsavel_id: p.responsavel_id,
    scheduled_at: p.scheduled_at,
    ig_caption: p.ig_caption,
    instagram_permalink: p.instagram_permalink,
    published_at: p.published_at,
    publish_error: p.publish_error,
    platform: p.platform,
    tiktok_publish_status: p.tiktok_publish_status,
    tiktok_publish_error: p.tiktok_publish_error,
    tiktok_post_url: p.tiktok_post_url,
    instagram_media_id: p.instagram_media_id,
  };
}

export function PublicacoesPanel({
  posts,
  igStatuses,
  openableWorkflowIds,
  isLoading,
  selectedLabel,
  onPostClick,
  onStatusChange,
}: PublicacoesPanelProps) {
  const statusRegistry = useStatusRegistry();
  return (
    <div className="scheduled-panel">
      <div className="scheduled-header">
        <h3>Publicações</h3>
        <p>{selectedLabel ?? 'Selecione um dia.'}</p>
      </div>
      <div className="scheduled-list">
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
            <p>Carregando…</p>
          </div>
        ) : posts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
            <p>{selectedLabel ? 'Nenhuma publicação neste dia.' : 'Selecione um dia.'}</p>
          </div>
        ) : (
          posts.map((p) => {
            const openable = openableWorkflowIds.has(p.workflow_id);
            const igStatus = p.cliente_id != null ? (igStatuses.get(p.cliente_id) ?? null) : null;
            const hasInstagramAccount = igStatus != null;
            const safePermalink =
              p.status === 'postado' && p.instagram_permalink
                ? sanitizeUrl(p.instagram_permalink)
                : null;
            return (
              <div
                key={p.id}
                className="scheduled-item"
                style={{ cursor: openable ? 'pointer' : 'default' }}
                onClick={openable ? () => onPostClick(p.workflow_id, p.id) : undefined}
              >
                <div className="item-top">
                  <span className="post-tipo-badge">{TIPO_LABELS[p.tipo]}</span>
                  <PostStatusChip post={p} registry={statusRegistry} />
                </div>
                <div className="item-title">{p.cliente_nome || '—'}</div>
                <div className="item-subtitle">{p.titulo || 'Post sem título'}</div>
                <div className="item-divider" />
                <div className="item-meta">{formatPostDate(p.scheduled_at)}</div>

                {/* Inline actions; ScheduleButton renders nothing when the post is not
                    actionable or the client has no IG account. Stop propagation so its
                    buttons/dialogs don't trigger the row's drawer-open click. */}
                <div onClick={(e) => e.stopPropagation()}>
                  <ScheduleButton
                    post={toWorkflowPost(p)}
                    hasInstagramAccount={hasInstagramAccount}
                    igAccountStatus={igStatus}
                    // The compact calendar panel has no TikTok settings UI, so a
                    // tiktok/both post can never be "ready" here — schedule/publish-now
                    // stay gated until the user opens the post in the full drawer.
                    tiktokSettingsComplete={false}
                    tiktokIncompleteTooltip="Abra o post para configurar o TikTok"
                    onStatusChange={onStatusChange}
                    compact
                  />
                </div>

                {safePermalink && (
                  <a
                    href={safePermalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: '0.75rem',
                      color: 'var(--primary-color)',
                      marginTop: 8,
                    }}
                  >
                    <ExternalLink className="h-3 w-3" /> Ver no Instagram
                  </a>
                )}

                {openable && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                      fontSize: '0.7rem',
                      color: 'var(--text-muted)',
                      marginTop: 8,
                    }}
                  >
                    Abrir no fluxo <ChevronRight className="h-3 w-3" />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
