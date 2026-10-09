import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { TIKTOK_MSG } from '@mesaas/tiktok-messages';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { sanitizeUrl } from '@/utils/security';
import { getTikTokCreatorInfo, type TikTokCreatorInfo } from '../../../services/tiktok';
import type { WorkflowPost } from '../../../store';
import type { PostMedia } from '../../../store/posts';
import {
  brandedCheckboxState,
  cannotPostMessage,
  computeTikTokReadiness,
  disclosureLabel,
  DISCLOSURE_INCOMPLETE_MSG,
  isAppAudited,
  isPublicAccountInTestMode,
  longestVideoSeconds,
  privacyOptionState,
  type TikTokReadiness,
} from '../tiktokComposerRules';

// =============================================================================
// TikTok settings panel — audit-mandated creator_info compliance UI
// (design doc §"Frontend (CRM)" → "TikTok settings panel", 2026-07-17).
// =============================================================================
//
// ── Readiness contract (spec 2026-10-08-tiktok-audit-readiness A0) ───────────
// The panel reports `computeTikTokReadiness` (tiktokComposerRules.ts) through
// `onReadinessChange({ complete, reason })` whenever the result changes. Every
// input is either persisted (tiktok_settings), server-fetched (creator_info) or
// passed in by the parent (media, mediaError); there is no ephemeral state any
// more (the music-usage confirmation moved to TikTokPostingDeclaration). The
// parent holds the latest value and hands it to ScheduleButton, which uses
// `reason` as the blocking explanation.
//
// ── Test-mode banner ─────────────────────────────────────────────────────
// Server-authoritative: this component never reads TIKTOK_APP_AUDITED or any
// client-side env var. It shows whenever creator_info says `app_audited: false`,
// OR when the parent sets `showTestModeBanner` (a schedule attempt hit the
// unaudited-mode 422 from tiktok-publish, the fallback for an older deploy that
// doesn't send `app_audited`).
//
// ── Persistence ──────────────────────────────────────────────────────────
// All writes go through the same `onFieldChange` callback WorkflowDrawer already
// passes down for `tipo`/`platform`/etc. (handleFieldChange -> updateWorkflowPost).
// `tiktok_settings` is a jsonb column with no partial-update semantics on the
// client — every write sends the FULL settings object, never a diff.
//
// ── Out of scope (noted, not a gap) ────────────────────────────────────────
// `video_cover_timestamp_ms` and `photo_cover_index` are valid tiktok_settings
// keys (cron/publish payload builders already read them) but neither gets a UI
// control here — cover-frame/cover-image picking needs a dedicated media-picker
// component this task doesn't build. `photo_cover_index` defaults to 0 (first
// image), matching buildPhotoInitPayload's own `s.photo_cover_index ?? 0` fallback.

const CAPTION_MAX_VIDEO = 2200; // UTF-16 code units == TikTok's "runes"; JS .length
const CAPTION_MAX_PHOTO = 4000; // already counts UTF-16 code units, no extra lib needed.
const TITLE_MAX = 90;
const CAPTION_DEBOUNCE_MS = 1500;

const TEST_MODE_BANNER =
  'App em modo de teste: até a aprovação do TikTok, as publicações saem como privadas.';

function formatDuration(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const PRIVACY_LABELS: Record<string, string> = {
  PUBLIC_TO_EVERYONE: 'Todos',
  MUTUAL_FOLLOW_FRIENDS: 'Amigos que se seguem',
  FOLLOWER_OF_CREATOR: 'Seguidores',
  SELF_ONLY: 'Somente eu (privado)',
};

interface TikTokSettingsDraft {
  privacy_level?: string;
  disable_comment: boolean;
  disable_duet: boolean;
  disable_stitch: boolean;
  brand_organic_toggle: boolean;
  brand_content_toggle: boolean;
  auto_add_music: boolean;
  is_aigc: boolean;
  photo_cover_index: number;
}

// Audit-mandated defaults: the comment/duet/stitch UI checkboxes are POSITIVE
// ("Permitir X") and unchecked by default. Because TikTok's own fields are the
// inverse (disable_comment/disable_duet/disable_stitch), "unchecked by default"
// means the persisted default must be `true` (not allowed) — never left
// `undefined`. An undefined key is omitted entirely from the publish payload
// (see _shared/tiktok-publish-utils.ts's buildVideoInitPayload), letting
// TikTok's own platform default apply instead of the audit-mandated
// deny-until-opt-in behavior. Every other toggle here already has positive
// semantics (brand_organic_toggle, brand_content_toggle, auto_add_music,
// is_aigc), so their natural `false` default needs no inversion.
const DEFAULT_DRAFT: TikTokSettingsDraft = {
  privacy_level: undefined,
  disable_comment: true,
  disable_duet: true,
  disable_stitch: true,
  brand_organic_toggle: false,
  brand_content_toggle: false,
  auto_add_music: false,
  is_aigc: false,
  photo_cover_index: 0,
};

function draftFromSettings(
  settings: Record<string, unknown> | null | undefined,
): TikTokSettingsDraft {
  const s = settings ?? {};
  return {
    privacy_level: typeof s.privacy_level === 'string' ? s.privacy_level : undefined,
    disable_comment:
      typeof s.disable_comment === 'boolean' ? s.disable_comment : DEFAULT_DRAFT.disable_comment,
    disable_duet: typeof s.disable_duet === 'boolean' ? s.disable_duet : DEFAULT_DRAFT.disable_duet,
    disable_stitch:
      typeof s.disable_stitch === 'boolean' ? s.disable_stitch : DEFAULT_DRAFT.disable_stitch,
    brand_organic_toggle:
      typeof s.brand_organic_toggle === 'boolean'
        ? s.brand_organic_toggle
        : DEFAULT_DRAFT.brand_organic_toggle,
    brand_content_toggle:
      typeof s.brand_content_toggle === 'boolean'
        ? s.brand_content_toggle
        : DEFAULT_DRAFT.brand_content_toggle,
    auto_add_music:
      typeof s.auto_add_music === 'boolean' ? s.auto_add_music : DEFAULT_DRAFT.auto_add_music,
    is_aigc: typeof s.is_aigc === 'boolean' ? s.is_aigc : DEFAULT_DRAFT.is_aigc,
    photo_cover_index:
      typeof s.photo_cover_index === 'number'
        ? s.photo_cover_index
        : DEFAULT_DRAFT.photo_cover_index,
  };
}

export interface TikTokSettingsPanelProps {
  clientId: number;
  post: Pick<
    WorkflowPost,
    'id' | 'tipo' | 'tiktok_settings' | 'tiktok_caption' | 'tiktok_title' | 'ig_caption'
  >;
  /** Same optimistic-write path `tipo`/`platform`/`ig_caption` already use
   * (WorkflowDrawer's onFieldChange -> updateWorkflowPost). */
  onFieldChange: (field: keyof WorkflowPost, value: unknown) => void;
  /** See the module-level "Readiness contract" comment above. */
  onReadinessChange?: (readiness: TikTokReadiness) => void;
  /** The post's media; `undefined` while the query is still loading. */
  media: PostMedia[] | undefined;
  /** The media query failed: readiness blocks instead of reading as "still loading". */
  mediaError?: boolean;
  /** See the module-level "Test-mode banner" comment above. OR-ed with `!app_audited`. */
  showTestModeBanner?: boolean;
  /** Com feature_multiplatform a legenda do TikTok mora na aba do TikTok
   *  (DestinationCaptionTabs); o painel fica só com as configurações. */
  hideCaption?: boolean;
}

export function TikTokSettingsPanel({
  clientId,
  post,
  onFieldChange,
  onReadinessChange,
  media,
  mediaError = false,
  showTestModeBanner = false,
  hideCaption = false,
}: TikTokSettingsPanelProps) {
  const [creatorInfo, setCreatorInfo] = useState<TikTokCreatorInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Local optimistic echo of tiktok_settings (mirrors InstagramCaptionField's `local`
  // pattern): updates immediately on interaction so checkbox/select state and the
  // readiness callback reflect a change in the same tick, while `onFieldChange`
  // fires the actual persistence write.
  const [draft, setDraft] = useState<TikTokSettingsDraft>(() =>
    draftFromSettings(post.tiktok_settings),
  );
  useEffect(() => {
    setDraft(draftFromSettings(post.tiktok_settings));
  }, [post.tiktok_settings]);

  // Commercial content disclosure master switch (spec A1). Local UI state: turning it on
  // persists nothing until one of its checkboxes is ticked; a saved toggle opens it on mount.
  const [disclosureOn, setDisclosureOn] = useState(
    () =>
      !!(post.tiktok_settings?.brand_organic_toggle || post.tiktok_settings?.brand_content_toggle),
  );
  // Re-sync when a saved toggle arrives after mount (the post prop changes under an open
  // panel): a ticked toggle means disclosure is on. Never forces the switch off, so turning
  // it on with nothing ticked yet survives re-renders.
  const draftHasDisclosure = draft.brand_organic_toggle || draft.brand_content_toggle;
  useEffect(() => {
    if (draftHasDisclosure) setDisclosureOn(true);
  }, [draftHasDisclosure]);

  const [captionLocal, setCaptionLocal] = useState(post.tiktok_caption ?? '');
  useEffect(() => {
    setCaptionLocal(post.tiktok_caption ?? '');
  }, [post.tiktok_caption]);
  const captionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [titleLocal, setTitleLocal] = useState(post.tiktok_title ?? '');
  useEffect(() => {
    setTitleLocal(post.tiktok_title ?? '');
  }, [post.tiktok_title]);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (captionTimer.current) clearTimeout(captionTimer.current);
      if (titleTimer.current) clearTimeout(titleTimer.current);
    },
    [],
  );

  // Fresh fetch every time this panel mounts — audit requirement (creator_info must
  // reflect live TikTok state on every open, never cached; see services/tiktok.ts's
  // getTikTokCreatorInfo, which deliberately has no cache entry, unlike the rest of
  // that module). Mounting is entirely controlled by the parent (WorkflowDrawer only
  // renders this panel while the post row is expanded AND platform targets TikTok),
  // so expand -> collapse -> expand already yields one fetch per open with no extra
  // wiring needed here.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getTikTokCreatorInfo(clientId)
      .then((info) => {
        if (!cancelled) setCreatorInfo(info);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setLoadError(err.message || 'Erro ao consultar informações do criador no TikTok');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const readiness = computeTikTokReadiness({
    loading,
    loadError,
    creator: creatorInfo,
    tipo: post.tipo,
    privacyLevel: draft.privacy_level,
    disclosureOn,
    brandOrganic: draft.brand_organic_toggle,
    brandContent: draft.brand_content_toggle,
    media: media?.map((m) => ({
      kind: m.kind,
      duration_seconds: m.duration_seconds,
      media_lost_at: m.media_lost_at ?? null,
    })),
    mediaError,
  });
  const readinessKey = `${readiness.complete}|${readiness.reason ?? ''}`;
  useEffect(() => {
    onReadinessChange?.(readiness);
    // onReadinessChange is a parent-supplied callback; re-firing only when the result
    // changes is the point (avoids re-reporting on unrelated re-renders).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readinessKey]);

  // Defensive — PlatformSelector already prevents platform from being 'tiktok'/'both'
  // while tipo is 'stories' (TikTok has no Stories API), so WorkflowDrawer should never
  // mount this panel for a stories post. Placed after every hook above so hook order
  // never changes across renders.
  if (post.tipo === 'stories') return null;

  const isVideoTipo = post.tipo === 'reels';
  const isPhotoTipo = post.tipo === 'feed' || post.tipo === 'carrossel';
  const captionMax = isVideoTipo ? CAPTION_MAX_VIDEO : CAPTION_MAX_PHOTO;

  const audited = isAppAudited(creatorInfo);
  const brandedState = brandedCheckboxState({ audited, privacyLevel: draft.privacy_level });
  const label = disclosureLabel(draft.brand_organic_toggle, draft.brand_content_toggle);
  const cannotPost = cannotPostMessage(creatorInfo);
  const maxDur = creatorInfo?.max_video_post_duration_sec;
  const longest = longestVideoSeconds(media);
  const durationError =
    isVideoTipo && maxDur != null && longest != null && longest > maxDur
      ? TIKTOK_MSG.durationExceeded(longest, maxDur)
      : null;

  const persist = (patch: Partial<TikTokSettingsDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    onFieldChange('tiktok_settings', next);
  };

  const handleCaptionChange = (value: string) => {
    if (value.length > captionMax) return;
    setCaptionLocal(value);
    if (captionTimer.current) clearTimeout(captionTimer.current);
    captionTimer.current = setTimeout(() => {
      onFieldChange('tiktok_caption', value);
    }, CAPTION_DEBOUNCE_MS);
  };

  const handleTitleChange = (value: string) => {
    if (value.length > TITLE_MAX) return;
    setTitleLocal(value);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      onFieldChange('tiktok_title', value);
    }, CAPTION_DEBOUNCE_MS);
  };

  const commentLocked = creatorInfo?.comment_disabled === true;
  const duetLocked = creatorInfo?.duet_disabled === true;
  const stitchLocked = creatorInfo?.stitch_disabled === true;

  return (
    <div
      className="mt-3 rounded-lg border-2 p-3 flex flex-col gap-3"
      style={{ borderColor: 'var(--border-color)', background: 'var(--surface-hover)' }}
    >
      {(showTestModeBanner || (creatorInfo != null && !audited)) && (
        <div
          role="status"
          className="text-xs rounded-md px-2 py-1.5"
          style={{ color: 'var(--warning)', background: 'rgba(245, 163, 66, 0.1)' }}
        >
          {TEST_MODE_BANNER}
        </div>
      )}

      {isPublicAccountInTestMode(creatorInfo) && (
        <p
          role="alert"
          className="text-xs rounded-md px-2 py-1.5"
          style={{ color: 'var(--danger-text)', background: 'rgba(245, 90, 66, 0.08)' }}
        >
          {TIKTOK_MSG.publicAccountInTestMode}
        </p>
      )}

      {/* Creator header (spec A6: replaced by the can't-post notice when TikTok refuses) */}
      {cannotPost ? (
        <p
          role="alert"
          className="text-xs rounded-md px-2 py-1.5"
          style={{ color: 'var(--danger-text)', background: 'rgba(245, 90, 66, 0.08)' }}
        >
          {cannotPost}
        </p>
      ) : (
        <div className="flex items-center gap-2.5">
          {creatorInfo?.creator_avatar_url && (
            <img
              data-testid="tiktok-creator-avatar"
              src={sanitizeUrl(creatorInfo.creator_avatar_url)}
              alt="TikTok"
              className="h-9 w-9 rounded-full object-cover"
              style={{ border: '2px solid #000000' }}
            />
          )}
          <div className="flex flex-col">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-main)' }}>
              {loading ? (
                'Carregando informações do criador…'
              ) : creatorInfo?.creator_nickname ? (
                <>
                  Publicando como @<span>{creatorInfo.creator_nickname}</span>
                </>
              ) : (
                '—'
              )}
            </span>
            {isVideoTipo && maxDur != null && (
              <span className="text-xs" style={{ color: 'var(--text-light)' }}>
                Duração máxima de vídeo nesta conta: {maxDur}s
              </span>
            )}
          </div>
        </div>
      )}

      {/* Preview (spec A5): what will be sent */}
      <section aria-label="Prévia" className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          Prévia
        </span>
        {media === undefined ? null : media.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-light)' }}>
            {TIKTOK_MSG.mediaMissing}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2 items-start">
            <div className="flex flex-wrap gap-1.5 min-w-0">
              {media.slice(0, 5).map((m) => {
                const thumb = m.thumbnail_url || (m.kind === 'image' ? m.url : undefined);
                return (
                  <div
                    key={m.id}
                    className="relative h-28 w-16 overflow-hidden rounded-md flex-shrink-0"
                    style={{ background: 'var(--surface-3)' }}
                  >
                    {thumb && !m.media_lost_at && (
                      <img src={sanitizeUrl(thumb)} alt="" className="h-full w-full object-cover" />
                    )}
                    {m.kind === 'video' && m.duration_seconds != null && (
                      <span
                        className="absolute bottom-1 right-1 rounded px-1 text-[10px] font-semibold"
                        style={{ background: 'var(--dark)', color: '#fff' }}
                      >
                        {formatDuration(m.duration_seconds)}
                      </span>
                    )}
                  </div>
                );
              })}
              {media.length > 5 && (
                <span className="self-center text-xs" style={{ color: 'var(--text-muted)' }}>
                  +{media.length - 5}
                </span>
              )}
            </div>
            <p
              className="min-w-[10rem] flex-1 text-xs line-clamp-2"
              style={{ color: 'var(--text-muted)' }}
            >
              {post.tiktok_caption ?? post.ig_caption ?? ''}
            </p>
          </div>
        )}
        {media?.some((m) => m.media_lost_at) && (
          <p className="text-xs" style={{ color: 'var(--danger-text)' }}>
            {TIKTOK_MSG.mediaLost}
          </p>
        )}
        {durationError && (
          <p className="text-xs" style={{ color: 'var(--danger-text)' }}>
            {durationError}
          </p>
        )}
      </section>

      {loadError && (
        <p className="text-xs" style={{ color: 'var(--danger)' }}>
          {loadError}
        </p>
      )}

      {/* Privacy — audit requirement: no default preselected */}
      <div className="flex flex-col gap-1">
        <Label>Privacidade</Label>
        <Select
          value={draft.privacy_level}
          onValueChange={(value) => persist({ privacy_level: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione a privacidade" />
          </SelectTrigger>
          <SelectContent>
            {(creatorInfo?.privacy_level_options ?? []).map((opt) => {
              const st = privacyOptionState(opt, {
                audited,
                brandContent: draft.brand_content_toggle,
              });
              return (
                <SelectItem key={opt} value={opt} disabled={st.disabled}>
                  {PRIVACY_LABELS[opt] ?? opt}
                  {st.suffix ? ` ${st.suffix}` : ''}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Interaction toggles — unchecked (not allowed) by default */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id={`tt-comment-${post.id}`}
            checked={!draft.disable_comment}
            disabled={commentLocked}
            onCheckedChange={(checked) => persist({ disable_comment: checked !== true })}
          />
          <Label htmlFor={`tt-comment-${post.id}`}>Permitir comentários</Label>
        </div>
        {isVideoTipo && (
          <>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`tt-duet-${post.id}`}
                checked={!draft.disable_duet}
                disabled={duetLocked}
                onCheckedChange={(checked) => persist({ disable_duet: checked !== true })}
              />
              <Label htmlFor={`tt-duet-${post.id}`}>Permitir dueto</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`tt-stitch-${post.id}`}
                checked={!draft.disable_stitch}
                disabled={stitchLocked}
                onCheckedChange={(checked) => persist({ disable_stitch: checked !== true })}
              />
              <Label htmlFor={`tt-stitch-${post.id}`}>Permitir stitch</Label>
            </div>
          </>
        )}
      </div>

      {/* Commercial content disclosure (spec A1/A2) */}
      <div
        className="flex flex-col gap-2 pt-3"
        style={{ borderTop: '1px solid var(--border-color)' }}
      >
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`tt-disclosure-${post.id}`}>Divulgação de conteúdo comercial</Label>
          <Switch
            id={`tt-disclosure-${post.id}`}
            aria-label="Divulgação de conteúdo comercial"
            checked={disclosureOn}
            onCheckedChange={(checked) => {
              setDisclosureOn(checked === true);
              if (checked !== true) {
                persist({ brand_organic_toggle: false, brand_content_toggle: false });
              }
            }}
          />
        </div>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Indique se este conteúdo promove você, uma marca, um produto ou um serviço.
        </p>
        {disclosureOn && (
          <>
            <div className="flex items-start gap-2">
              <Checkbox
                id={`tt-brand-organic-${post.id}`}
                checked={draft.brand_organic_toggle}
                onCheckedChange={(c) => persist({ brand_organic_toggle: c === true })}
              />
              <div className="flex flex-col">
                <Label htmlFor={`tt-brand-organic-${post.id}`}>Sua marca</Label>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Você está promovendo a si mesmo ou o seu negócio.
                </span>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id={`tt-brand-content-${post.id}`}
                checked={draft.brand_content_toggle}
                // A legacy row with branded already on can still be unticked, to clear the conflict.
                disabled={brandedState.disabled && !draft.brand_content_toggle}
                onCheckedChange={(c) => persist({ brand_content_toggle: c === true })}
              />
              <div className="flex flex-col">
                <Label htmlFor={`tt-brand-content-${post.id}`}>
                  Conteúdo de marca{' '}
                  {brandedState.suffix && (
                    <span
                      data-testid="tt-branded-suffix"
                      className="text-xs"
                      style={{ color: 'var(--text-light)' }}
                    >
                      {brandedState.suffix}
                    </span>
                  )}
                </Label>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {brandedState.helper ?? 'Você está promovendo outra marca ou um terceiro.'}
                </span>
              </div>
            </div>
            {label ? (
              <p
                className="text-xs rounded-md px-2 py-1.5"
                style={{
                  background: 'var(--surface-main)',
                  border: '1px solid var(--border-color)',
                }}
              >
                Seu post será rotulado como <strong>{label}</strong>.
              </p>
            ) : (
              <p className="flex items-start gap-1.5 text-xs" style={{ color: 'var(--text-main)' }}>
                <AlertTriangle
                  aria-hidden="true"
                  className="mt-px h-3.5 w-3.5 shrink-0"
                  style={{ color: 'var(--warning)' }}
                />
                <span>{DISCLOSURE_INCOMPLETE_MSG}</span>
              </p>
            )}
          </>
        )}
        {draft.brand_content_toggle && draft.privacy_level === 'SELF_ONLY' && (
          <p className="text-xs" style={{ color: 'var(--danger-text)' }}>
            {TIKTOK_MSG.brandedPrivate}
          </p>
        )}
      </div>

      {isPhotoTipo && (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`tt-auto-music-${post.id}`}>Adicionar música automaticamente</Label>
          <Switch
            id={`tt-auto-music-${post.id}`}
            checked={draft.auto_add_music}
            onCheckedChange={(checked) => persist({ auto_add_music: checked === true })}
          />
        </div>
      )}

      {isVideoTipo && (
        <div className="flex items-center gap-2">
          <Checkbox
            id={`tt-aigc-${post.id}`}
            checked={draft.is_aigc}
            onCheckedChange={(checked) => persist({ is_aigc: checked === true })}
          />
          <Label htmlFor={`tt-aigc-${post.id}`}>Conteúdo gerado por IA</Label>
        </div>
      )}

      {/* Caption override */}
      {!hideCaption && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <Label htmlFor={`tt-caption-${post.id}`}>
              Legenda do TikTok (opcional: usa a legenda do Instagram se vazia)
            </Label>
            <span
              className="text-xs"
              style={{ color: 'var(--text-light)', fontFamily: 'var(--font-mono)' }}
            >
              {captionLocal.length} / {captionMax}
            </span>
          </div>
          <Textarea
            id={`tt-caption-${post.id}`}
            value={captionLocal}
            onChange={(e) => handleCaptionChange(e.target.value)}
            placeholder="Texto exato a publicar no TikTok. Deixe vazio para usar a legenda do Instagram."
            className="min-h-[70px] resize-y"
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
          />
        </div>
      )}

      {/* Title — photo tipos only */}
      {isPhotoTipo && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <Label htmlFor={`tt-title-${post.id}`}>Título do TikTok (opcional)</Label>
            <span
              className="text-xs"
              style={{ color: 'var(--text-light)', fontFamily: 'var(--font-mono)' }}
            >
              {titleLocal.length} / {TITLE_MAX}
            </span>
          </div>
          <Input
            id={`tt-title-${post.id}`}
            value={titleLocal}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Título do post de fotos"
          />
        </div>
      )}
    </div>
  );
}
