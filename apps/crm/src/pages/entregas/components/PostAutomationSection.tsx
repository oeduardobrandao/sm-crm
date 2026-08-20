import { Suspense, lazy, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import type { SelectedTarget } from '@/pages/automacoes/AutomationFormDialog';
import {
  getAutomationsForPost,
  type InstagramCommentAutomation,
  type WorkflowPost,
} from '../../../store';

// =============================================================================
// Comment-to-DM automations for one post, inside the Entregas editor.
//
// The Automações page is the full surface (every client, send log, delete); this
// is the shortcut for the moment the user is actually thinking about the post:
// see what is already armed for it, and arm a new one without leaving the drawer.
// =============================================================================

/** Lazy so the dialog (and everything it pulls in: the IG post grid, the covers
 * service) stays out of the Entregas chunk until someone opens it. */
const AutomationFormDialog = lazy(() => import('@/pages/automacoes/AutomationFormDialog'));

/** Same cap the dialog applies to a caption snapshot. */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Mirrors the Automações listing: a null `ig_media_id` means the target has not
 * published yet. A tombstoned automation never reaches this list -- its post is
 * gone, so this drawer does not exist either. */
function isAwaitingPublication(a: InstagramCommentAutomation): boolean {
  return a.workflow_post_id != null && a.ig_media_id == null;
}

export function PostAutomationSection({
  post,
  clienteId,
  currentUserRole,
  hasInstagramAccount,
}: {
  post: WorkflowPost;
  clienteId: number;
  currentUserRole: 'owner' | 'admin' | 'agent';
  hasInstagramAccount: boolean;
}) {
  const { t } = useTranslation('automations');
  const qc = useQueryClient();
  const { features } = useWorkspaceLimits();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<InstagramCommentAutomation | null>(null);

  // Comments only exist on an Instagram post that can still be commented on:
  // Stories expire, a TikTok-only post never gets an IG media id, and without a
  // connected account there is nothing to listen to. 'both' stays in -- it does
  // publish to Instagram.
  const enabled =
    features?.feature_instagram_automation === true &&
    post.tipo !== 'stories' &&
    (post.platform ?? 'instagram') !== 'tiktok' &&
    hasInstagramAccount &&
    post.id != null;

  // The media id is part of the key because the queryFn closes over it: a post
  // that publishes while the drawer is open would otherwise keep being served
  // the pre-publish list, which misses every automation aimed at the live media.
  const {
    data: automations = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['post-automations', post.id, post.instagram_media_id ?? null],
    queryFn: () => getAutomationsForPost(post.id as number, post.instagram_media_id ?? null),
    enabled,
  });

  const canManage = currentUserRole === 'owner' || currentUserRole === 'admin';

  // Which half of the dialog's target picker this post belongs to: once it has a
  // media id it is a live post, before that it is only an internal row. The
  // media id travels with `workflow_post_id` so the automation keeps showing up
  // here under either column.
  const initialTarget = useMemo<{ clientId: number; target: SelectedTarget }>(
    () => ({
      clientId: clienteId,
      target: post.instagram_media_id
        ? {
            kind: 'published',
            ig_media_id: post.instagram_media_id,
            media_permalink: post.instagram_permalink ?? null,
            // An empty caption is no caption: fall back to the titulo so the
            // listing has something to name the target with.
            media_caption: truncate(post.ig_caption || post.titulo, 300),
            workflow_post_id: post.id as number,
          }
        : { kind: 'production', workflow_post_id: post.id as number, titulo: post.titulo },
    }),
    [
      clienteId,
      post.id,
      post.titulo,
      post.ig_caption,
      post.instagram_media_id,
      post.instagram_permalink,
    ],
  );

  // Every hook above runs unconditionally; only the render is gated.
  if (!enabled) return null;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (a: InstagramCommentAutomation) => {
    setEditing(a);
    setDialogOpen(true);
  };

  const renderBadges = (a: InstagramCommentAutomation) => (
    <>
      <Badge variant={a.ativo ? 'success' : 'neutral'} size="sm">
        {a.ativo ? t('status.active') : t('status.inactive')}
      </Badge>
      {isAwaitingPublication(a) && (
        <Badge variant="info" size="sm">
          {t('pendingBadge')}
        </Badge>
      )}
    </>
  );

  return (
    <div
      className="mt-3 rounded-lg border-2 p-3 flex flex-col gap-2"
      style={{ borderColor: 'var(--border-color)', background: 'var(--surface-hover)' }}
    >
      <div
        className="flex items-center gap-1.5 text-xs font-semibold"
        style={{ color: 'var(--text-muted)' }}
      >
        <Zap className="h-3.5 w-3.5" style={{ flexShrink: 0 }} />
        {t('postSection.title')}
      </div>

      {isLoading ? (
        <p className="text-xs" style={{ color: 'var(--text-light)' }}>
          {t('postSection.loading')}
        </p>
      ) : isError ? (
        // Distinct from the empty hint on purpose: "we could not look" must never
        // read as "there is nothing armed for this post".
        <p className="text-xs" style={{ color: 'var(--danger-text)' }}>
          {t('postSection.loadError')}
        </p>
      ) : automations.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-light)' }}>
          {t('postSection.emptyHint')}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {automations.map((a) =>
            canManage ? (
              <button
                key={a.id}
                type="button"
                onClick={() => openEdit(a)}
                className="flex flex-wrap items-center gap-1.5 text-xs rounded-md px-2 py-1.5 text-left"
                style={{
                  border: '1px solid var(--border-color)',
                  background: 'var(--surface-main)',
                  color: 'var(--text-main)',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontWeight: 600 }}>{a.name}</span>
                {renderBadges(a)}
              </button>
            ) : (
              <div
                key={a.id}
                className="flex flex-wrap items-center gap-1.5 text-xs rounded-md px-2 py-1.5"
                style={{
                  border: '1px solid var(--border-color)',
                  background: 'var(--surface-main)',
                  color: 'var(--text-main)',
                }}
              >
                <span style={{ fontWeight: 600 }}>{a.name}</span>
                {renderBadges(a)}
              </div>
            ),
          )}
        </div>
      )}

      {canManage && (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={openCreate}>
            {t('postSection.createForPost')}
          </Button>
        </div>
      )}

      {dialogOpen && (
        <Suspense fallback={null}>
          <AutomationFormDialog
            open
            onOpenChange={setDialogOpen}
            editing={editing}
            // An edit carries its own target; only a creation gets seeded.
            initialTarget={editing ? null : initialTarget}
            onSaved={() => {
              setDialogOpen(false);
              // Prefix match: covers this post's key whatever media id it carries.
              qc.invalidateQueries({ queryKey: ['post-automations', post.id] });
              // AUTOMATIONS_KEY, spelled out rather than imported: pulling it
              // from AutomacoesPage would drag that whole page module into the
              // Entregas chunk, which is what the lazy import above avoids.
              qc.invalidateQueries({ queryKey: ['instagram-automations'] });
              qc.invalidateQueries({ queryKey: ['instagram-automations-count'] });
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
