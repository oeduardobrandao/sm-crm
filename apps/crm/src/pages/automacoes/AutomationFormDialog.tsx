import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, Check, Instagram, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import {
  Dialog,
  DialogContent,
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
import { useAuth } from '../../context/AuthContext';
import { handleEntitlementMutationError } from '../../lib/entitlement-toast';
import { getInstagramPosts, type InstagramPostSummary } from '../../services/instagram';
import {
  createInstagramAutomation,
  updateInstagramAutomation,
  getClientes,
  getInstagramAccountStatuses,
  type InstagramCommentAutomation,
  type IgAccountStatus,
} from '../../store';

const POSTS_PAGE_SIZE = 10;
const MAX_KEYWORD_LENGTH = 40;

// Stable identity for the "no data yet" fallback -- `?? new Map()` would
// otherwise mint a fresh Map every render, defeating the useMemo below that
// depends on it (react-hooks/exhaustive-deps caught this).
const EMPTY_STATUSES: Map<number, IgAccountStatus> = new Map();

type TargetMode = 'todos' | 'post';

interface SelectedPost {
  ig_media_id: string;
  media_permalink: string | null;
  media_caption: string | null;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function emptyState() {
  return {
    name: '',
    clientId: '' as number | '',
    targetMode: 'todos' as TargetMode,
    selectedPost: null as SelectedPost | null,
    keywords: [] as string[],
    keywordInput: '',
    dmMessage: '',
    publicReply: '',
  };
}

export default function AutomationFormDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: InstagramCommentAutomation | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation('automations');
  const { profile } = useAuth();
  const qc = useQueryClient();

  const [form, setForm] = useState(emptyState);
  const [postsPage, setPostsPage] = useState(1);

  // Re-seed the form only when the dialog transitions to open, from
  // `editing` (edit) or a blank slate (create) -- not on every render, or
  // typing would get clobbered by the next parent re-render.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        name: editing.name,
        clientId: editing.client_id,
        targetMode: editing.ig_media_id ? 'post' : 'todos',
        selectedPost: editing.ig_media_id
          ? {
              ig_media_id: editing.ig_media_id,
              media_permalink: editing.media_permalink,
              media_caption: editing.media_caption,
            }
          : null,
        keywords: editing.keywords,
        keywordInput: '',
        dmMessage: editing.dm_message,
        publicReply: editing.public_reply ?? '',
      });
    } else {
      setForm(emptyState());
    }
    setPostsPage(1);
  }, [open, editing]);

  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const clientIds = useMemo(
    () => clientes.filter((c) => c.id != null).map((c) => c.id as number),
    [clientes],
  );
  const { data: accountStatuses } = useQuery({
    queryKey: ['instagram-account-statuses', clientIds],
    queryFn: () => getInstagramAccountStatuses(clientIds),
    enabled: open && clientIds.length > 0,
  });
  const statuses: Map<number, IgAccountStatus> = accountStatuses ?? EMPTY_STATUSES;

  // Only clients with an Instagram connection can be picked -- but if we're
  // editing an automation for a client that has since disconnected, keep it
  // selectable so an existing automation always shows its own client.
  const selectableClientes = useMemo(() => {
    const withIg = clientes.filter((c) => c.id != null && statuses.has(c.id));
    if (editing && !withIg.some((c) => c.id === editing.client_id)) {
      const editingClient = clientes.find((c) => c.id === editing.client_id);
      if (editingClient) withIg.push(editingClient);
    }
    return withIg;
  }, [clientes, statuses, editing]);

  const selectedStatus =
    typeof form.clientId === 'number' ? statuses.get(form.clientId) : undefined;
  const canAutomate = selectedStatus?.canAutomate ?? false;

  const postsQuery = useQuery({
    queryKey: ['instagram-posts-for-automation', form.clientId, postsPage],
    queryFn: () => getInstagramPosts(form.clientId as number, postsPage),
    enabled: open && form.targetMode === 'post' && typeof form.clientId === 'number',
  });
  const hasMorePosts = postsPage * POSTS_PAGE_SIZE < (postsQuery.data?.total ?? 0);

  const onMutationError = (err: unknown, fallback: string) => {
    if (!handleEntitlementMutationError(err, profile?.conta_id ?? null)) toast.error(fallback);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        client_id: form.clientId as number,
        name: form.name.trim(),
        ig_media_id: form.targetMode === 'post' ? (form.selectedPost?.ig_media_id ?? null) : null,
        media_permalink:
          form.targetMode === 'post' ? (form.selectedPost?.media_permalink ?? null) : null,
        media_caption:
          form.targetMode === 'post' ? (form.selectedPost?.media_caption ?? null) : null,
        keywords: form.keywords,
        dm_message: form.dmMessage.trim(),
        public_reply: form.publicReply.trim() || null,
      };
      return editing
        ? updateInstagramAutomation(editing.id, payload)
        : createInstagramAutomation(payload);
    },
    onSuccess: () => {
      toast.success(editing ? t('toastUpdated') : t('toastCreated'));
      qc.invalidateQueries({ queryKey: ['instagram-automations'] });
      qc.invalidateQueries({ queryKey: ['instagram-automations-count'] });
      onSaved();
    },
    // The plan gate raises feature_disabled from a DB trigger on the direct
    // PostgREST insert -- this catch is the observation point (same pattern
    // as StatusTab's AutomationsSection).
    onError: (err) => onMutationError(err, editing ? t('toastUpdateError') : t('toastCreateError')),
  });

  const addKeyword = () => {
    const trimmed = form.keywordInput.trim().toLowerCase().slice(0, MAX_KEYWORD_LENGTH);
    if (!trimmed) return;
    setForm((f) =>
      f.keywords.includes(trimmed)
        ? { ...f, keywordInput: '' }
        : { ...f, keywords: [...f.keywords, trimmed], keywordInput: '' },
    );
  };
  const removeKeyword = (k: string) =>
    setForm((f) => ({ ...f, keywords: f.keywords.filter((x) => x !== k) }));

  const selectPost = (post: InstagramPostSummary) =>
    setForm((f) => ({
      ...f,
      selectedPost: {
        ig_media_id: post.instagram_post_id,
        media_permalink: post.permalink,
        media_caption: post.caption ? truncate(post.caption, 300) : null,
      },
    }));

  const submit = () => {
    if (form.clientId === '') {
      toast.error(t('form.validationClient'));
      return;
    }
    if (!form.name.trim()) {
      toast.error(t('form.validationName'));
      return;
    }
    if (form.targetMode === 'post' && !form.selectedPost) {
      toast.error(t('form.validationPost'));
      return;
    }
    if (form.keywords.length === 0) {
      toast.error(t('form.validationKeyword'));
      return;
    }
    if (!form.dmMessage.trim()) {
      toast.error(t('form.validationDm'));
      return;
    }
    saveMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl"
        onConfirmClose={() => onOpenChange(false)}
        confirmClose={
          form.name.trim() !== '' || form.keywords.length > 0 || form.dmMessage.trim() !== ''
        }
      >
        <DialogHeader>
          <DialogTitle>{editing ? t('form.editTitle') : t('form.createTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium" htmlFor="automacao-nome">
              {t('form.nameLabel')}
            </label>
            <Input
              id="automacao-nome"
              value={form.name}
              maxLength={80}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={t('form.namePlaceholder')}
            />
          </div>

          <div>
            <label className="text-sm font-medium">{t('form.clientLabel')}</label>
            <Select
              value={form.clientId === '' ? '' : String(form.clientId)}
              onValueChange={(v) =>
                setForm((f) => ({
                  ...f,
                  clientId: Number(v),
                  targetMode: 'todos',
                  selectedPost: null,
                }))
              }
            >
              <SelectTrigger aria-label={t('form.clientAria')}>
                <SelectValue placeholder={t('form.clientPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {selectableClientes.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.clientId !== '' && !canAutomate && (
              <div
                className="flex items-center gap-2"
                style={{
                  marginTop: 8,
                  padding: '0.5rem 0.75rem',
                  borderRadius: 8,
                  background: 'rgba(245, 163, 66, 0.12)',
                  color: 'var(--text-main)',
                  fontSize: '0.8rem',
                }}
              >
                <AlertTriangle
                  className="h-4 w-4"
                  style={{ color: 'var(--warning)', flexShrink: 0 }}
                />
                <span style={{ flex: 1 }}>{t('form.reconnectWarning')}</span>
                <Button asChild size="sm" variant="outline">
                  <Link to={`/clientes/${form.clientId}/redes-sociais`}>
                    {t('form.reconnectCta')}
                  </Link>
                </Button>
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium">{t('form.targetLabel')}</label>
            <div
              role="radiogroup"
              aria-label={t('form.targetAria')}
              className="flex gap-4"
              style={{ marginTop: 6 }}
            >
              <label className="flex items-center gap-2 text-sm" style={{ cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="automacao-alvo"
                  value="todos"
                  checked={form.targetMode === 'todos'}
                  onChange={() =>
                    setForm((f) => ({ ...f, targetMode: 'todos', selectedPost: null }))
                  }
                />
                {t('form.targetAll')}
              </label>
              <label className="flex items-center gap-2 text-sm" style={{ cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="automacao-alvo"
                  value="post"
                  checked={form.targetMode === 'post'}
                  onChange={() => setForm((f) => ({ ...f, targetMode: 'post' }))}
                />
                {t('form.targetPost')}
              </label>
            </div>

            {form.targetMode === 'post' &&
              (form.clientId === '' ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 6 }}>
                  {t('form.selectClientForPosts')}
                </p>
              ) : (
                <div style={{ marginTop: 8 }}>
                  {postsQuery.isLoading ? (
                    <div className="flex justify-center p-4">
                      <Spinner size="sm" />
                    </div>
                  ) : (
                    <>
                      <div
                        className="grid grid-cols-4 gap-2"
                        style={{ maxHeight: 220, overflowY: 'auto' }}
                      >
                        {(postsQuery.data?.posts ?? []).map((post) => {
                          const selected =
                            form.selectedPost?.ig_media_id === post.instagram_post_id;
                          return (
                            <button
                              key={post.id}
                              type="button"
                              onClick={() => selectPost(post)}
                              aria-pressed={selected}
                              style={{
                                position: 'relative',
                                aspectRatio: '1',
                                borderRadius: 8,
                                overflow: 'hidden',
                                border: selected
                                  ? '2px solid var(--primary-color)'
                                  : '1px solid var(--border-color)',
                                padding: 0,
                                cursor: 'pointer',
                                background: 'var(--surface-1)',
                              }}
                            >
                              {post.thumbnail_url ? (
                                <img
                                  src={post.thumbnail_url}
                                  alt=""
                                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                              ) : (
                                <div className="flex items-center justify-center h-full">
                                  <Instagram
                                    className="h-4 w-4"
                                    style={{ color: 'var(--text-muted)' }}
                                  />
                                </div>
                              )}
                              {selected && (
                                <span
                                  style={{
                                    position: 'absolute',
                                    top: 3,
                                    right: 3,
                                    background: 'var(--primary-color)',
                                    borderRadius: '50%',
                                    width: 16,
                                    height: 16,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  }}
                                >
                                  <Check className="h-2.5 w-2.5" style={{ color: '#fff' }} />
                                </span>
                              )}
                            </button>
                          );
                        })}
                        {postsQuery.data?.posts.length === 0 && (
                          <p
                            style={{
                              gridColumn: '1 / -1',
                              color: 'var(--text-muted)',
                              fontSize: '0.8rem',
                            }}
                          >
                            {t('form.noPostsSynced')}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center justify-between" style={{ marginTop: 6 }}>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={postsPage <= 1}
                          onClick={() => setPostsPage((p) => p - 1)}
                        >
                          {t('form.previous')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!hasMorePosts}
                          onClick={() => setPostsPage((p) => p + 1)}
                        >
                          {t('form.next')}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
          </div>

          <div>
            <label className="text-sm font-medium">{t('form.keywordsLabel')}</label>
            <div className="flex flex-wrap gap-1.5" style={{ marginTop: 6, marginBottom: 6 }}>
              {form.keywords.map((k) => (
                <Badge key={k} variant="outline" size="sm" className="flex items-center gap-1">
                  {k}
                  <button
                    type="button"
                    onClick={() => removeKeyword(k)}
                    aria-label={t('form.keywordRemove', { keyword: k })}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <Input
              value={form.keywordInput}
              onChange={(e) => setForm((f) => ({ ...f, keywordInput: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addKeyword();
                }
              }}
              placeholder={t('form.keywordPlaceholder')}
            />
          </div>

          <div>
            <label className="text-sm font-medium" htmlFor="automacao-dm">
              {t('form.dmLabel')}
            </label>
            <Textarea
              id="automacao-dm"
              value={form.dmMessage}
              maxLength={1000}
              rows={4}
              onChange={(e) => setForm((f) => ({ ...f, dmMessage: e.target.value }))}
              placeholder={t('form.dmPlaceholder')}
            />
            <div style={{ textAlign: 'right', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {form.dmMessage.length}/1000
            </div>
          </div>

          <div>
            <label className="text-sm font-medium" htmlFor="automacao-reply">
              {t('form.replyLabel')}
            </label>
            <Textarea
              id="automacao-reply"
              value={form.publicReply}
              maxLength={500}
              rows={2}
              onChange={(e) => setForm((f) => ({ ...f, publicReply: e.target.value }))}
              placeholder={t('form.replyPlaceholder')}
            />
            <div style={{ textAlign: 'right', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {form.publicReply.length}/500
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('form.cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={saveMutation.isPending}>
            {saveMutation.isPending && <Spinner size="sm" />} {t('form.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
