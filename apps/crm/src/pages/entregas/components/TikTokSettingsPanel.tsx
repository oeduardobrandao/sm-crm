import { useEffect, useRef, useState } from 'react';
import { Music2 } from 'lucide-react';
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

// =============================================================================
// TikTok settings panel — audit-mandated creator_info compliance UI
// (design doc §"Frontend (CRM)" → "TikTok settings panel", 2026-07-17).
// =============================================================================
//
// ── Completeness contract for C3's ScheduleButton ──────────────────────────
// `onCompletenessChange(complete: boolean)` fires whenever either gating input
// changes:
//   1. `tiktok_settings.privacy_level` chosen — PERSISTED, derivable by anyone
//      reading the post row (post.tiktok_settings?.privacy_level != null).
//   2. The music-usage confirmation checkbox is ticked — EPHEMERAL, intentionally
//      never written to tiktok_settings or any column. The audit requires an
//      affirmative re-confirmation every time this panel is opened, so this bit
//      cannot be derived from the post row. C3's ScheduleButton MUST hold the
//      latest value this callback reports (keyed by post id) for as long as the
//      panel stays mounted, and AND it with any other TikTok readiness it
//      computes (media, account) before enabling the Schedule action for
//      platform 'tiktok'/'both'. `complete = privacyChosen && musicConfirmed`.
//
// ── Test-mode banner ─────────────────────────────────────────────────────
// Server-authoritative (design doc "Unaudited-mode gate"): this component never
// reads TIKTOK_APP_AUDITED or any client-side env var. The parent controls
// `showTestModeBanner`, flipping it to true only after a schedule attempt's
// response indicates the app is still unaudited (the 422 from tiktok-publish's
// /schedule route). C3 wires that catch-block signal in; until then this stays
// false and the banner never renders.
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

const MUSIC_USAGE_CONFIRMATION_URL =
  'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en';

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
  post: Pick<WorkflowPost, 'id' | 'tipo' | 'tiktok_settings' | 'tiktok_caption' | 'tiktok_title'>;
  /** Same optimistic-write path `tipo`/`platform`/`ig_caption` already use
   * (WorkflowDrawer's onFieldChange -> updateWorkflowPost). */
  onFieldChange: (field: keyof WorkflowPost, value: unknown) => void;
  /** See the module-level "Completeness contract for C3's ScheduleButton" comment above. */
  onCompletenessChange?: (complete: boolean) => void;
  /** See the module-level "Test-mode banner" comment above. Defaults to false. */
  showTestModeBanner?: boolean;
}

export function TikTokSettingsPanel({
  clientId,
  post,
  onFieldChange,
  onCompletenessChange,
  showTestModeBanner = false,
}: TikTokSettingsPanelProps) {
  const [creatorInfo, setCreatorInfo] = useState<TikTokCreatorInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Ephemeral — see module comment. Never persisted, never seeded from props.
  const [musicConfirmed, setMusicConfirmed] = useState(false);

  // Local optimistic echo of tiktok_settings (mirrors InstagramCaptionField's `local`
  // pattern): updates immediately on interaction so checkbox/select state and the
  // completeness callback reflect a change in the same tick, while `onFieldChange`
  // fires the actual persistence write.
  const [draft, setDraft] = useState<TikTokSettingsDraft>(() =>
    draftFromSettings(post.tiktok_settings),
  );
  useEffect(() => {
    setDraft(draftFromSettings(post.tiktok_settings));
  }, [post.tiktok_settings]);

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

  const privacyChosen = !!draft.privacy_level;
  useEffect(() => {
    onCompletenessChange?.(privacyChosen && musicConfirmed);
    // onCompletenessChange is a parent-supplied callback; re-running only when the two
    // actual gating inputs change is the point (avoids re-firing on unrelated re-renders).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privacyChosen, musicConfirmed]);

  // Defensive — PlatformSelector already prevents platform from being 'tiktok'/'both'
  // while tipo is 'stories' (TikTok has no Stories API), so WorkflowDrawer should never
  // mount this panel for a stories post. Placed after every hook above so hook order
  // never changes across renders.
  if (post.tipo === 'stories') return null;

  const isVideoTipo = post.tipo === 'reels';
  const isPhotoTipo = post.tipo === 'feed' || post.tipo === 'carrossel';
  const captionMax = isVideoTipo ? CAPTION_MAX_VIDEO : CAPTION_MAX_PHOTO;
  const isBrandedContent = draft.brand_organic_toggle || draft.brand_content_toggle;

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
      {showTestModeBanner && (
        <div
          role="status"
          className="text-xs rounded-md px-2 py-1.5"
          style={{ color: 'var(--warning)', background: 'rgba(245, 163, 66, 0.1)' }}
        >
          App em modo de teste: publicações TikTok saem como privadas
        </div>
      )}

      {/* Creator header */}
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
            {loading
              ? 'Carregando informações do criador…'
              : (creatorInfo?.creator_nickname ?? '—')}
          </span>
          {isVideoTipo && creatorInfo?.max_video_post_duration_sec != null && (
            <span className="text-xs" style={{ color: 'var(--text-light)' }}>
              Duração máxima de vídeo permitida: {creatorInfo.max_video_post_duration_sec}s
            </span>
          )}
        </div>
      </div>

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
            {(creatorInfo?.privacy_level_options ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {PRIVACY_LABELS[opt] ?? opt}
              </SelectItem>
            ))}
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

      {/* Commercial content */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`tt-brand-organic-${post.id}`}>
            Seu conteúdo promove você ou seu negócio
          </Label>
          <Switch
            id={`tt-brand-organic-${post.id}`}
            checked={draft.brand_organic_toggle}
            onCheckedChange={(checked) => persist({ brand_organic_toggle: checked === true })}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`tt-brand-content-${post.id}`}>Conteúdo de marca — parceria paga</Label>
          <Switch
            id={`tt-brand-content-${post.id}`}
            checked={draft.brand_content_toggle}
            onCheckedChange={(checked) => persist({ brand_content_toggle: checked === true })}
          />
        </div>
        {draft.brand_content_toggle && (
          <p className="text-xs" style={{ color: 'var(--text-light)' }}>
            Este post exibirá o rótulo <strong>Parceria paga</strong> no TikTok.
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

      {/* Music-usage confirmation — audit requirement, must be ticked before scheduling */}
      <div
        className="flex flex-col gap-1.5 rounded-md p-2"
        style={{ background: 'var(--surface-light)' }}
      >
        <p className="text-xs flex items-start gap-1.5" style={{ color: 'var(--text-light)' }}>
          <Music2 className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span>
            {isBrandedContent
              ? 'Este conteúdo promove uma marca ou é uma parceria paga. Confirmo que tenho os direitos de uso da música utilizada e que este conteúdo está de acordo com as políticas de conteúdo de marca do TikTok, incluindo a '
              : 'Confirmo que tenho os direitos de uso da música utilizada neste conteúdo, conforme a '}
            <a
              href={MUSIC_USAGE_CONFIRMATION_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--primary-color)' }}
            >
              Confirmação de Uso de Música do TikTok
            </a>
            .
          </span>
        </p>
        <div className="flex items-center gap-2">
          <Checkbox
            id={`tt-music-confirm-${post.id}`}
            checked={musicConfirmed}
            onCheckedChange={(checked) => setMusicConfirmed(checked === true)}
          />
          <Label htmlFor={`tt-music-confirm-${post.id}`}>
            Confirmo que tenho os direitos de uso da música
          </Label>
        </div>
      </div>

      {/* Caption override */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Label htmlFor={`tt-caption-${post.id}`}>
            Legenda do TikTok (opcional — usa a legenda do Instagram se vazia)
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
