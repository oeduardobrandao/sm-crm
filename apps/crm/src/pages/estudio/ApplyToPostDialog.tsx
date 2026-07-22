import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  attachDesign,
  getClientes,
  getWorkflows,
  getWorkflowPosts,
  type DesignSummary,
} from '@/store';
import { supabase } from '@/lib/supabase';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { postEligibility, type IneligibleReason } from './applyEligibility';

// Walks client → workflow → post. Per-post eligibility data comes from two batched RLS
// reads (attached designs + video media) so ineligible posts render disabled WITH a reason
// instead of surfacing a 403 after the fact.

async function fetchEligibilityData(postIds: number[]) {
  if (postIds.length === 0) {
    return { designedPostIds: new Set<number>(), videoPostIds: new Set<number>() };
  }
  const inList = `(${postIds.join(',')})`;
  const [designed, videos] = await Promise.all([
    supabase
      .from('designs')
      .select('post_id')
      .not('post_id', 'is', null)
      .filter('post_id', 'in', inList),
    supabase
      .from('post_file_links')
      .select('post_id, files!inner(kind)')
      .filter('post_id', 'in', inList)
      .eq('files.kind', 'video'),
  ]);
  if (designed.error) throw designed.error;
  if (videos.error) throw videos.error;
  return {
    designedPostIds: new Set((designed.data ?? []).map((r) => r.post_id as number)),
    videoPostIds: new Set((videos.data ?? []).map((r) => r.post_id as number)),
  };
}

export function ApplyToPostDialog({
  design,
  onClose,
  onApplied,
}: {
  design: DesignSummary | null;
  onClose: () => void;
  onApplied: (design: DesignSummary) => void;
}) {
  const { t } = useTranslation('estudio');
  const [clienteId, setClienteId] = useState<number | undefined>(undefined);
  const [workflowId, setWorkflowId] = useState<number | undefined>(undefined);
  const [postId, setPostId] = useState<number | undefined>(undefined);

  const open = design !== null;
  const reset = () => {
    setClienteId(undefined);
    setWorkflowId(undefined);
    setPostId(undefined);
  };

  const clientesQuery = useQuery({ queryKey: ['clientes'], queryFn: getClientes, enabled: open });
  const workflowsQuery = useQuery({
    queryKey: ['workflows'],
    queryFn: getWorkflows,
    enabled: open,
  });
  const workflows = (workflowsQuery.data ?? []).filter(
    (w) => w.status === 'ativo' && (clienteId === undefined || w.cliente_id === clienteId),
  );

  const postsQuery = useQuery({
    queryKey: ['apply-posts', workflowId],
    enabled: open && workflowId !== undefined,
    queryFn: async () => {
      const posts = await getWorkflowPosts(workflowId!);
      const withIds = posts.filter((p) => p.id !== undefined);
      const data = await fetchEligibilityData(withIds.map((p) => p.id!));
      return withIds.map((p) => ({
        post: p,
        reason: postEligibility(
          { id: p.id!, tipo: p.tipo, status: p.status },
          data.designedPostIds,
          data.videoPostIds,
        ) as IneligibleReason,
      }));
    },
  });

  const attachMutation = useMutation({
    mutationFn: () => attachDesign(design!.id, postId!),
    onSuccess: ({ post_tipo }) => {
      toast.success(t('apply.success', { tipo: post_tipo }));
      reset();
      onApplied(design!);
    },
    onError: (err: Error) => {
      const known = [
        'post_already_designed',
        'post_not_editable',
        'post_has_video',
        'post_tipo_unsupported',
        'design_already_attached',
      ];
      toast.error(known.includes(err.message) ? t(`apply.errors.${err.message}`) : err.message);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent style={{ maxWidth: 460 }}>
        <DialogHeader>
          <DialogTitle>{t('apply.title', { name: design?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('apply.subtitle')}</DialogDescription>
        </DialogHeader>

        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <div>
            <label
              style={{
                fontSize: '0.7rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}
            >
              {t('apply.clientLabel')}
            </label>
            <Select
              value={clienteId === undefined ? '' : String(clienteId)}
              onValueChange={(v) => {
                setClienteId(parseInt(v, 10));
                setWorkflowId(undefined);
                setPostId(undefined);
              }}
            >
              <SelectTrigger data-testid="apply-client">
                <SelectValue placeholder={t('apply.clientPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {(clientesQuery.data ?? [])
                  .filter((c) => c.id !== undefined)
                  .map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {clienteId !== undefined && (
            <div>
              <label
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}
              >
                {t('apply.workflowLabel')}
              </label>
              <Select
                value={workflowId === undefined ? '' : String(workflowId)}
                onValueChange={(v) => {
                  setWorkflowId(parseInt(v, 10));
                  setPostId(undefined);
                }}
              >
                <SelectTrigger data-testid="apply-workflow">
                  <SelectValue
                    placeholder={
                      workflows.length === 0
                        ? t('apply.noWorkflows')
                        : t('apply.workflowPlaceholder')
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {workflows
                    .filter((w) => w.id !== undefined)
                    .map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>
                        {w.titulo}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {workflowId !== undefined && (
            <div>
              <label
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}
              >
                {t('apply.postLabel')}
              </label>
              {postsQuery.isLoading ? (
                <div style={{ display: 'grid', placeItems: 'center', padding: '1rem' }}>
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    style={{ color: 'var(--text-muted)' }}
                  />
                </div>
              ) : (postsQuery.data ?? []).length === 0 ? (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0.5rem 0' }}>
                  {t('apply.noPosts')}
                </p>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gap: '0.35rem',
                    maxHeight: 220,
                    overflowY: 'auto',
                    paddingRight: 4,
                  }}
                >
                  {(postsQuery.data ?? []).map(({ post, reason }) => {
                    const disabled = reason !== null;
                    const selected = postId === post.id;
                    return (
                      <button
                        key={post.id}
                        type="button"
                        disabled={disabled}
                        data-testid={`apply-post-${post.id}`}
                        onClick={() => setPostId(post.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '0.5rem',
                          padding: '0.5rem 0.7rem',
                          borderRadius: 8,
                          textAlign: 'left',
                          border: selected
                            ? '2px solid var(--primary-color)'
                            : '1px solid var(--border-color)',
                          background: selected ? 'rgba(234,179,8,0.08)' : 'transparent',
                          opacity: disabled ? 0.55 : 1,
                          cursor: disabled ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <span style={{ minWidth: 0 }}>
                          <span
                            style={{
                              display: 'block',
                              fontSize: '0.8rem',
                              fontWeight: 600,
                              color: 'var(--text-main)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {post.titulo || `Post #${post.id}`}
                          </span>
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-light)' }}>
                            {post.tipo} · {post.status}
                          </span>
                        </span>
                        {disabled && (
                          <span className="badge badge-neutral badge--sm" style={{ flexShrink: 0 }}>
                            {t(`apply.reasons.${reason}`)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <p
            style={{
              display: 'flex',
              gap: '0.4rem',
              fontSize: '0.7rem',
              color: 'var(--text-light)',
              alignItems: 'flex-start',
            }}
          >
            <Info className="h-3.5 w-3.5" style={{ flexShrink: 0, marginTop: 1 }} />
            {t('apply.info')}
          </p>
        </div>

        <DialogFooter>
          <Button
            disabled={postId === undefined || attachMutation.isPending}
            onClick={() => attachMutation.mutate()}
            data-testid="apply-confirm"
          >
            {attachMutation.isPending ? t('apply.applying') : t('apply.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
