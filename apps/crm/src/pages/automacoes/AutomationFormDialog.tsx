import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, Check, ExternalLink, Instagram, X } from 'lucide-react';
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { sanitizeUrl } from '@/utils/security';
import { useAuth } from '../../context/AuthContext';
import { handleEntitlementMutationError } from '../../lib/entitlement-toast';
import { getInstagramPosts, type InstagramPostSummary } from '../../services/instagram';
import { getPostCovers } from '../../services/postMedia';
import { TIPO_LABELS } from '../entregas/postLabels';
import {
  createInstagramAutomation,
  updateInstagramAutomation,
  getClientes,
  getClientePosts,
  getInstagramAccountStatuses,
  type ClientePost,
  type InstagramCommentAutomation,
  type IgAccountStatus,
} from '../../store';

/**
 * Stacking for the copy opened from inside the Entregas drawer. The default
 * `z-50` of DialogContent/DialogOverlay leaves the dialog buried under
 * `.drawer-panel` (z-index 9001) and `.drawer-overlay` (9000): it opens, it is
 * focused, and the user sees nothing.
 *
 * 9005 and not the AlertDialog layer's 9010/9011: this dialog renders its own
 * unsaved-changes AlertDialog, which lives at exactly those two values. Sitting
 * at 9011 would put the form above the guard's own overlay. Same value, same
 * reason, as ThumbnailPickerDialog and PostMediaLightbox.
 */
const DRAWER_ELEVATED_Z = 'z-[9005]';

const POSTS_PAGE_SIZE = 10;
/** The production list arrives unpaginated, so it is chunked client-side. */
const PRODUCTION_PAGE_SIZE = 12;
const MAX_KEYWORD_LENGTH = 40;

// Stable identity for the "no data yet" fallback -- `?? new Map()` would
// otherwise mint a fresh Map every render, defeating the useMemo below that
// depends on it (react-hooks/exhaustive-deps caught this).
const EMPTY_STATUSES: Map<number, IgAccountStatus> = new Map();

/** 'deleted' is not a choice the user makes: it is the seeded state of an
 * automation whose production post was deleted before publishing. No radio is
 * checked, and submitting is blocked until a real target replaces it. */
type TargetMode = 'todos' | 'post' | 'deleted';

/** Which grid the "post específico" panel is showing. */
type TargetSource = 'production' | 'published';

export type SelectedTarget =
  | {
      kind: 'published';
      ig_media_id: string;
      media_permalink: string | null;
      media_caption: string | null;
      /** Preserva o vínculo com o post interno no estado "ligado" (ambos setados). */
      workflow_post_id: number | null;
    }
  | { kind: 'production'; workflow_post_id: number; titulo: string };

/** A production post is a valid target only while it can still publish to
 * Instagram: already-published posts belong to the "Publicados" grid, Stories
 * expire, and TikTok-only posts never get an IG media id. `falha_publicacao`
 * stays eligible because it is still going to publish. */
function isEligibleProductionPost(post: ClientePost): boolean {
  return (
    post.status !== 'postado' &&
    post.tipo !== 'stories' &&
    (post.platform ?? 'instagram') !== 'tiktok'
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function emptyState() {
  return {
    name: '',
    clientId: '' as number | '',
    targetMode: 'todos' as TargetMode,
    targetSource: 'production' as TargetSource,
    selectedPost: null as SelectedTarget | null,
    keywords: [] as string[],
    keywordInput: '',
    dmMessage: '',
    publicReply: '',
  };
}

/** Maps an automation being edited onto the target half of the form state.
 * Order matters: the tombstone wins over everything, and `ig_media_id` wins over
 * `workflow_post_id` so the "linked" state (both set) shows the live post while
 * keeping the internal link intact. */
function seedTarget(editing: InstagramCommentAutomation): {
  targetMode: TargetMode;
  targetSource: TargetSource;
  selectedPost: SelectedTarget | null;
} {
  if (editing.pending_post_deleted_at != null) {
    return { targetMode: 'deleted', targetSource: 'production', selectedPost: null };
  }
  if (editing.ig_media_id) {
    return {
      targetMode: 'post',
      targetSource: 'published',
      selectedPost: {
        kind: 'published',
        ig_media_id: editing.ig_media_id,
        media_permalink: editing.media_permalink,
        media_caption: editing.media_caption,
        workflow_post_id: editing.workflow_post_id ?? null,
      },
    };
  }
  if (editing.workflow_post_id != null) {
    return {
      targetMode: 'post',
      targetSource: 'production',
      selectedPost: {
        kind: 'production',
        workflow_post_id: editing.workflow_post_id,
        // media_caption holds the titulo snapshot taken when the target was picked.
        titulo: editing.media_caption ?? '',
      },
    };
  }
  return { targetMode: 'todos', targetSource: 'production', selectedPost: null };
}

/** One tile of the "Em produção" grid. Shared by the live list and by the pinned
 * card that stands in for a target which has dropped out of that list, so the two
 * are visually identical by construction. */
function ProductionCard({
  titulo,
  tipoLabel,
  imageUrl,
  selected,
  onSelect,
}: {
  titulo: string;
  /** Omitted for the pinned card: the seed carries a titulo and nothing else. */
  tipoLabel: string | null;
  imageUrl: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      // The cover is decorative (alt=""), so the titulo has to carry the
      // accessible name either way.
      aria-label={titulo}
      style={{
        position: 'relative',
        aspectRatio: '1',
        borderRadius: 8,
        overflow: 'hidden',
        border: selected ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
        padding: 0,
        cursor: 'pointer',
        background: 'var(--surface-1)',
      }}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span
          className="flex flex-col justify-center h-full"
          style={{ padding: '0.375rem', gap: 2, textAlign: 'left', overflow: 'hidden' }}
        >
          <span
            style={{
              fontSize: '0.7rem',
              lineHeight: 1.2,
              color: 'var(--text-main)',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {titulo}
          </span>
          {tipoLabel && (
            <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>{tipoLabel}</span>
          )}
        </span>
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
}

/** One tile of the "Publicados" grid. Shared by the synced feed and by the
 * pinned card that stands in for a target the daily `instagram_posts` sync has
 * not landed yet, so the two are visually identical by construction. */
function PublishedCard({
  caption,
  thumbnailUrl,
  permalink,
  permalinkLabel,
  selected,
  onSelect,
}: {
  /** Accessible name. Null for the synced tiles, whose thumbnail is decorative
   * and which are identified by position; the pinned card names itself. */
  caption: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  permalinkLabel: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <span style={{ position: 'relative', display: 'block', aspectRatio: '1' }}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={caption ?? undefined}
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 8,
          overflow: 'hidden',
          border: selected ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
          padding: 0,
          cursor: 'pointer',
          background: 'var(--surface-1)',
        }}
      >
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : caption ? (
          <span
            className="flex flex-col justify-center h-full"
            style={{ padding: '0.375rem', textAlign: 'left', overflow: 'hidden' }}
          >
            <span
              style={{
                fontSize: '0.7rem',
                lineHeight: 1.2,
                color: 'var(--text-main)',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {caption}
            </span>
          </span>
        ) : (
          <span className="flex items-center justify-center h-full">
            <Instagram className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
          </span>
        )}
      </button>
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
            pointerEvents: 'none',
          }}
        >
          <Check className="h-2.5 w-2.5" style={{ color: '#fff' }} />
        </span>
      )}
      {/* Sibling of the button, never nested inside it: an anchor within a
          button is invalid markup and swallows the click. */}
      {permalink && (
        <a
          href={sanitizeUrl(permalink)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={permalinkLabel}
          style={{
            position: 'absolute',
            left: 3,
            bottom: 3,
            display: 'flex',
            padding: 2,
            borderRadius: 4,
            background: 'var(--surface-main)',
            color: 'var(--text-muted)',
          }}
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </span>
  );
}

export default function AutomationFormDialog({
  open,
  onOpenChange,
  editing,
  initialTarget,
  elevated,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: InstagramCommentAutomation | null;
  /** Pre-seeds a creation with the post it was opened from (the Entregas
   * editor's entry point). Ignored while `editing`, which carries its own
   * target. */
  initialTarget?: { clientId: number; target: SelectedTarget } | null;
  /** Set by callers that render inside the Entregas drawer, whose panel
   * out-stacks the dialog's default z-50. See DRAWER_ELEVATED_Z. */
  elevated?: boolean;
  onSaved: () => void;
}) {
  const { t } = useTranslation('automations');
  const { profile } = useAuth();
  const qc = useQueryClient();

  const [form, setForm] = useState(emptyState);
  const [postsPage, setPostsPage] = useState(1);
  const [productionPage, setProductionPage] = useState(1);
  /** One-shot: the production page is derived from the seeded target exactly
   * once per dialog opening, and never again -- a refetch must not yank the user
   * off the page they just paged to. */
  const productionPageSeededRef = useRef(false);

  // Read through a ref, never a dependency: callers build `initialTarget` inline,
  // so a fresh object identity every parent render would re-run the seed below
  // and clobber whatever the user had typed.
  const initialTargetRef = useRef(initialTarget);
  initialTargetRef.current = initialTarget;

  // Re-seed the form only when the dialog transitions to open, from
  // `editing` (edit) or a blank slate (create) -- not on every render, or
  // typing would get clobbered by the next parent re-render.
  useEffect(() => {
    if (!open) return;
    const seed = initialTargetRef.current;
    if (editing) {
      setForm({
        name: editing.name,
        clientId: editing.client_id,
        ...seedTarget(editing),
        keywords: editing.keywords,
        keywordInput: '',
        dmMessage: editing.dm_message,
        publicReply: editing.public_reply ?? '',
      });
    } else if (seed) {
      setForm({
        ...emptyState(),
        clientId: seed.clientId,
        targetMode: 'post',
        targetSource: seed.target.kind === 'production' ? 'production' : 'published',
        selectedPost: seed.target,
      });
    } else {
      setForm(emptyState());
    }
    setPostsPage(1);
    setProductionPage(1);
    productionPageSeededRef.current = false;
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

  const targetingPost = form.targetMode === 'post' && typeof form.clientId === 'number';

  /** A dialog opened from a post belongs to that post's client: letting the
   * Select move would silently strand the seeded target on another workspace's
   * grid. Editing keeps the Select free, as before. */
  const clientLocked = !editing && initialTarget != null;

  const postsQuery = useQuery({
    queryKey: ['instagram-posts-for-automation', form.clientId, postsPage],
    queryFn: () => getInstagramPosts(form.clientId as number, postsPage),
    enabled: open && targetingPost && form.targetSource === 'published',
  });
  const hasMorePosts = postsPage * POSTS_PAGE_SIZE < (postsQuery.data?.total ?? 0);

  // Shares ['clientePosts', clienteId] with the Entregas calendar/drawer, so an
  // already-warm cache renders the grid without a round trip.
  const productionQuery = useQuery({
    queryKey: ['clientePosts', form.clientId],
    queryFn: () => getClientePosts(form.clientId as number),
    enabled: open && targetingPost && form.targetSource === 'production',
  });
  const productionPosts = useMemo(
    () => (productionQuery.data ?? []).filter(isEligibleProductionPost),
    [productionQuery.data],
  );
  // Clamp rather than reset from an effect: the list can shrink under a stale
  // page (refetch, client switch) and an out-of-range page would render blank.
  const productionPageCount = Math.max(1, Math.ceil(productionPosts.length / PRODUCTION_PAGE_SIZE));
  const safeProductionPage = Math.min(productionPage, productionPageCount);
  const pagedProductionPosts = productionPosts.slice(
    (safeProductionPage - 1) * PRODUCTION_PAGE_SIZE,
    safeProductionPage * PRODUCTION_PAGE_SIZE,
  );

  const seededTarget = form.selectedPost?.kind === 'production' ? form.selectedPost : null;

  // The seeded target can sit on any block of the client-side pagination, so
  // jump to the one that holds it the first time the list lands. Without this the
  // dialog opens on page 1 with nothing highlighted, which reads as "no target"
  // and invites an accidental retarget on the next click.
  useEffect(() => {
    if (productionPageSeededRef.current || !productionQuery.isSuccess) return;
    // Spend the seed on the first list we see, whether or not it contains the
    // target -- from here on the page is the user's to choose.
    productionPageSeededRef.current = true;
    if (!seededTarget) return;
    const index = productionPosts.findIndex((p) => p.id === seededTarget.workflow_post_id);
    if (index >= 0) setProductionPage(Math.floor(index / PRODUCTION_PAGE_SIZE) + 1);
  }, [productionQuery.isSuccess, productionPosts, seededTarget]);

  // A seeded target can be missing from the eligible list entirely: the post may
  // have derived into stories/tiktok, or its workflow left 'ativo' (getClientePosts
  // only returns active workflows). Rebuild a card from the seed alone -- no extra
  // request -- so the current target stays visible instead of reading as "none".
  const orphanTarget =
    seededTarget &&
    productionQuery.isSuccess &&
    !productionPosts.some((p) => p.id === seededTarget.workflow_post_id)
      ? seededTarget
      : null;

  // Same idea for the published grid, with two differences that rule out the
  // production tab's "jump to the right page" trick: this list is paginated
  // SERVER-side, and it comes from `instagram_posts`, which a DAILY sync fills.
  // A post published in the last 24h is not on any page yet, so there is nothing
  // to jump to. Pin the target whenever it is absent from the page in view --
  // built from the seed alone, no extra request.
  const publishedSelected = form.selectedPost?.kind === 'published' ? form.selectedPost : null;
  const publishedPagePosts = postsQuery.data?.posts ?? [];
  const publishedOrphanTarget =
    publishedSelected &&
    !publishedPagePosts.some((p) => p.instagram_post_id === publishedSelected.ig_media_id)
      ? publishedSelected
      : null;

  // react-query hashes the key structurally, so a fresh array each render is fine.
  const productionIds = pagedProductionPosts.map((p) => p.id);
  const coversQuery = useQuery({
    queryKey: ['automation-production-covers', productionIds],
    queryFn: () => getPostCovers(productionIds),
    // The tab check matters: ['clientePosts', id] is shared with Entregas, so a
    // warm cache would otherwise fetch covers for a grid nobody is looking at.
    enabled:
      open && targetingPost && form.targetSource === 'production' && productionIds.length > 0,
  });
  const covers = coversQuery.data;

  const onMutationError = (err: unknown, fallback: string) => {
    if (!handleEntitlementMutationError(err, profile?.conta_id ?? null)) toast.error(fallback);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const sel = form.targetMode === 'post' ? form.selectedPost : null;
      const target =
        sel === null
          ? {
              ig_media_id: null,
              media_permalink: null,
              media_caption: null,
              workflow_post_id: null,
            }
          : sel.kind === 'published'
            ? {
                ig_media_id: sel.ig_media_id,
                media_permalink: sel.media_permalink,
                media_caption: sel.media_caption,
                workflow_post_id: sel.workflow_post_id,
              }
            : {
                ig_media_id: null,
                media_permalink: null,
                // Snapshot of the titulo, so the listing can name the target
                // before the post exists on Instagram.
                media_caption: truncate(sel.titulo, 300),
                workflow_post_id: sel.workflow_post_id,
              };

      const payload = {
        client_id: form.clientId as number,
        name: form.name.trim(),
        ...target,
        keywords: form.keywords,
        dm_message: form.dmMessage.trim(),
        public_reply: form.publicReply.trim() || null,
      };
      if (!editing) return createInstagramAutomation(payload);

      // Clearing the tombstone is the ONLY case where pending_post_deleted_at
      // belongs in a patch, and it always travels with a fresh target. `ativo`
      // is never sent: the DB parked this automation, and un-parking it stays a
      // deliberate act on the listing toggle.
      const patch =
        editing.pending_post_deleted_at != null && form.targetMode !== 'deleted'
          ? { ...payload, pending_post_deleted_at: null }
          : payload;
      return updateInstagramAutomation(editing.id, patch);
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
        kind: 'published',
        ig_media_id: post.instagram_post_id,
        media_permalink: post.permalink,
        media_caption: post.caption ? truncate(post.caption, 300) : null,
        // A freshly picked live post has no internal counterpart; the "linked"
        // state only ever arrives pre-seeded from `editing`.
        workflow_post_id: null,
      },
    }));

  const selectProductionPost = (post: ClientePost) =>
    setForm((f) => ({
      ...f,
      selectedPost: { kind: 'production', workflow_post_id: post.id, titulo: post.titulo },
    }));

  /** Re-asserts the pinned target. Idempotent: it is already the selection, so
   * clicking its card is a no-op, while clicking any other card retargets. */
  const selectSeededTarget = (target: SelectedTarget) =>
    setForm((f) => ({ ...f, selectedPost: target }));

  /** Paging by hand also spends the seed, in case the list only lands afterwards. */
  const goToProductionPage = (page: number) => {
    productionPageSeededRef.current = true;
    setProductionPage(page);
  };

  const submit = () => {
    if (form.clientId === '') {
      toast.error(t('form.validationClient'));
      return;
    }
    if (!form.name.trim()) {
      toast.error(t('form.validationName'));
      return;
    }
    if (form.targetMode === 'deleted') {
      toast.error(t('form.validationDeletedTarget'));
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
        className={cn('max-w-xl', elevated && DRAWER_ELEVATED_Z)}
        overlayClassName={elevated ? DRAWER_ELEVATED_Z : undefined}
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
              disabled={clientLocked}
              value={form.clientId === '' ? '' : String(form.clientId)}
              onValueChange={(v) => {
                setForm((f) => ({
                  ...f,
                  clientId: Number(v),
                  targetMode: 'todos',
                  targetSource: 'production',
                  selectedPost: null,
                }));
                setPostsPage(1);
                setProductionPage(1);
                // A different client means a different list; the (now cleared)
                // target has nothing left to seed.
                productionPageSeededRef.current = true;
              }}
            >
              {/* Radix mirrors the root's `disabled` onto the trigger, but
                  saying it here too keeps the button's own disabled attribute
                  independent of that plumbing. */}
              <SelectTrigger aria-label={t('form.clientAria')} disabled={clientLocked}>
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

            {form.targetMode === 'deleted' && (
              <div
                className="flex items-start gap-2"
                style={{
                  marginTop: 8,
                  padding: '0.625rem 0.75rem',
                  borderRadius: 8,
                  background: 'rgba(245, 163, 66, 0.12)',
                  color: 'var(--text-main)',
                  fontSize: '0.8rem',
                }}
              >
                <AlertTriangle
                  className="h-4 w-4"
                  style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }}
                />
                <span>{t('form.deletedTargetHint')}</span>
              </div>
            )}

            {form.targetMode === 'post' &&
              (form.clientId === '' ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 6 }}>
                  {t('form.selectClientForPosts')}
                </p>
              ) : (
                <div style={{ marginTop: 8 }}>
                  <ToggleGroup
                    type="single"
                    aria-label={t('form.targetSourceLabel')}
                    value={form.targetSource}
                    onValueChange={(v) => {
                      if (!v || v === form.targetSource) return;
                      setForm((f) => ({ ...f, targetSource: v as TargetSource }));
                    }}
                    className="justify-start"
                    style={{ marginBottom: 8 }}
                  >
                    <ToggleGroupItem value="production" size="sm">
                      {t('form.targetSourceProduction')}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="published" size="sm">
                      {t('form.targetSourcePublished')}
                    </ToggleGroupItem>
                  </ToggleGroup>

                  {form.targetSource === 'production' ? (
                    productionQuery.isLoading ? (
                      <div className="flex justify-center p-4">
                        <Spinner size="sm" />
                      </div>
                    ) : (
                      <>
                        <div
                          className="grid grid-cols-4 gap-2"
                          style={{ maxHeight: 220, overflowY: 'auto' }}
                        >
                          {/* The pinned target only exists on page one, above the
                              live list, and only while it is missing from it. */}
                          {orphanTarget && safeProductionPage === 1 && (
                            <ProductionCard
                              titulo={orphanTarget.titulo}
                              tipoLabel={null}
                              imageUrl={null}
                              selected
                              onSelect={() => selectSeededTarget(orphanTarget)}
                            />
                          )}
                          {pagedProductionPosts.map((post) => {
                            const cover = covers?.get(post.id);
                            return (
                              <ProductionCard
                                key={post.id}
                                titulo={post.titulo}
                                tipoLabel={TIPO_LABELS[post.tipo]}
                                imageUrl={
                                  cover?.kind === 'video'
                                    ? (cover.thumbnail_url ?? null)
                                    : (cover?.url ?? cover?.thumbnail_url ?? null)
                                }
                                selected={
                                  form.selectedPost?.kind === 'production' &&
                                  form.selectedPost.workflow_post_id === post.id
                                }
                                onSelect={() => selectProductionPost(post)}
                              />
                            );
                          })}
                          {productionPosts.length === 0 && !orphanTarget && (
                            <p
                              style={{
                                gridColumn: '1 / -1',
                                color: 'var(--text-muted)',
                                fontSize: '0.8rem',
                              }}
                            >
                              {t('form.noProductionPosts')}
                            </p>
                          )}
                        </div>
                        {productionPageCount > 1 && (
                          <div
                            className="flex items-center justify-between"
                            style={{ marginTop: 6 }}
                          >
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={safeProductionPage <= 1}
                              onClick={() => goToProductionPage(safeProductionPage - 1)}
                            >
                              {t('form.previous')}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={safeProductionPage >= productionPageCount}
                              onClick={() => goToProductionPage(safeProductionPage + 1)}
                            >
                              {t('form.next')}
                            </Button>
                          </div>
                        )}
                        <p
                          style={{
                            color: 'var(--text-muted)',
                            fontSize: '0.75rem',
                            marginTop: 6,
                          }}
                        >
                          {t('form.productionHint')}
                        </p>
                      </>
                    )
                  ) : postsQuery.isLoading ? (
                    <div className="flex justify-center p-4">
                      <Spinner size="sm" />
                    </div>
                  ) : (
                    <>
                      <div
                        className="grid grid-cols-4 gap-2"
                        style={{ maxHeight: 220, overflowY: 'auto' }}
                      >
                        {/* The pinned target sits above the synced feed on
                            whatever page fails to show it. */}
                        {publishedOrphanTarget && (
                          <PublishedCard
                            caption={publishedOrphanTarget.media_caption ?? t('viewPost')}
                            thumbnailUrl={null}
                            permalink={publishedOrphanTarget.media_permalink}
                            permalinkLabel={t('viewPost')}
                            selected
                            onSelect={() => selectSeededTarget(publishedOrphanTarget)}
                          />
                        )}
                        {publishedPagePosts.map((post) => (
                          <PublishedCard
                            key={post.id}
                            caption={null}
                            thumbnailUrl={post.thumbnail_url ?? null}
                            permalink={null}
                            permalinkLabel={t('viewPost')}
                            selected={
                              form.selectedPost?.kind === 'published' &&
                              form.selectedPost.ig_media_id === post.instagram_post_id
                            }
                            onSelect={() => selectPost(post)}
                          />
                        ))}
                        {publishedPagePosts.length === 0 && !publishedOrphanTarget && (
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
