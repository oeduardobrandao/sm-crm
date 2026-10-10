// TikTok scheduling validation matrix + Content Posting API payload builders.
// Mirrors the STRUCTURE of instagram-publish-utils.ts::validateForScheduling (load post ->
// load linked media -> load account (via the post's own cliente_id) -> accumulate PT-BR
// errors -> return { ok, errors, ... }).
//
// Post-type -> TikTok content-type mapping (design doc "Post-type mapping & validation"):
//   tipo 'reels'      -> video direct post   (POST /v2/post/publish/video/init/)
//   tipo 'feed'       -> photo post, 1 image (POST /v2/post/publish/content/init/)
//   tipo 'carrossel'  -> photo post, N images (same endpoint)
//   tipo 'stories'    -> not supported by the TikTok API; rejected outright

import {
  decryptTikTokToken,
  FIELD_PUBLIC_POST_ID,
  RETRYABLE_FAIL_REASONS,
  STATUS_FAILED,
  STATUS_PROCESSING_DOWNLOAD,
  STATUS_PROCESSING_UPLOAD,
  STATUS_PUBLISH_COMPLETE,
  STATUS_SEND_TO_USER_INBOX,
} from "./tiktok.ts";
import { TIKTOK_MSG } from "./tiktok-messages.ts";

// --- Shared types ---

type DbClient = { from: (table: string) => any };

export interface TikTokSettings {
  privacy_level?: string;
  disable_comment?: boolean;
  disable_duet?: boolean;
  disable_stitch?: boolean;
  brand_organic_toggle?: boolean;
  brand_content_toggle?: boolean;
  auto_add_music?: boolean;
  photo_cover_index?: number;
  is_aigc?: boolean;
  video_cover_timestamp_ms?: number;
}

interface TikTokMediaFile {
  id: number;
  kind: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  r2_key: string;
  media_lost_at: string | null;
  sort_order: number;
}

export interface TikTokValidationResult {
  ok: boolean;
  errors: string[];
  media?: TikTokMediaFile[];
  account?: {
    id: string;
    encrypted_access_token: string;
    encrypted_refresh_token: string;
    tiktok_open_id: string;
  };
}

// --- Constants (validation) ---

const CAPTION_VIDEO_MAX = 2200; // UTF-16 code units. JS string.length already counts
// UTF-16 code units, which is exactly what TikTok calls "runes" in their docs — no
// separate counting utility needed.
const CAPTION_PHOTO_MAX = 4000;
const TITLE_PHOTO_MAX = 90;

const TIKTOK_CARROSSEL_MAX_TIKTOK_ONLY = 20; // app attachment cap; TikTok's own max is 35
const TIKTOK_CARROSSEL_MAX_BOTH = 10; // intersected with Instagram's Graph API carousel cap

// TikTok's Content Posting API photo constraints (design doc: "JPEG/WebP, ≤20 MB, ≤1080p").
// This is narrower than (and additional to) the general image/kind classification mirrored
// from instagram-publish-utils.ts — that file's ALLOWED_IMAGE_MIMES also allows PNG, which
// TikTok's photo endpoint does not accept.
const TIKTOK_PHOTO_MIMES = new Set(["image/jpeg", "image/webp"]);
const TIKTOK_PHOTO_MAX_BYTES = 20 * 1024 * 1024;

const VALID_PRIVACY_LEVELS = new Set([
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
]);

// --- Validation ---

function applyTikTokPhotoChecks(file: TikTokMediaFile, errors: string[]) {
  if (!TIKTOK_PHOTO_MIMES.has(file.mime_type)) {
    errors.push("Imagem do TikTok deve estar em formato JPEG ou WebP.");
  }
  if (file.size_bytes > TIKTOK_PHOTO_MAX_BYTES) {
    errors.push("Imagem do TikTok excede 20 MB (limite da API do TikTok).");
  }
}

function validateCaptionAndTitle(
  errors: string[],
  tipo: string,
  caption: string,
  tiktokTitle: string | null | undefined,
) {
  const isVideo = tipo === "reels";
  if (isVideo) {
    if (caption.length > CAPTION_VIDEO_MAX) {
      errors.push(`Legenda do TikTok excede ${CAPTION_VIDEO_MAX} caracteres (limite para vídeos).`);
    }
    if (tiktokTitle != null && tiktokTitle !== "") {
      errors.push(
        "O campo título do TikTok é exclusivo para posts de fotos e não pode ser definido em posts de vídeo.",
      );
    }
  } else {
    if (caption.length > CAPTION_PHOTO_MAX) {
      errors.push(`Descrição do TikTok excede ${CAPTION_PHOTO_MAX} caracteres (limite para fotos).`);
    }
    if (tiktokTitle != null && tiktokTitle.length > TITLE_PHOTO_MAX) {
      errors.push(`Título do TikTok excede ${TITLE_PHOTO_MAX} caracteres.`);
    }
  }
}

function validateMediaForTipo(
  errors: string[],
  tipo: string,
  platform: string,
  files: TikTokMediaFile[],
) {
  if (files.length === 0) {
    errors.push("Post precisa de pelo menos uma mídia.");
    return;
  }

  if (tipo === "reels") {
    if (files.length !== 1 || files[0].kind !== "video") {
      errors.push("Vídeo do TikTok precisa ter exatamente um arquivo de vídeo.");
    }
    return;
  }

  // Photo route (feed | carrossel): every linked file must be an image — any video item
  // targeting TikTok is rejected outright.
  const hasVideo = files.some((f) => f.kind === "video");
  if (hasVideo) {
    errors.push("TikTok não aceita vídeos em posts de fotos; carrossel/feed deve conter apenas imagens.");
  } else {
    for (const f of files) {
      if (f.kind === "image") applyTikTokPhotoChecks(f, errors);
    }
  }

  if (tipo === "carrossel" && !hasVideo) {
    const cap = platform === "both" ? TIKTOK_CARROSSEL_MAX_BOTH : TIKTOK_CARROSSEL_MAX_TIKTOK_ONLY;
    if (files.length > cap) {
      errors.push(
        `Carrossel do TikTok aceita no máximo ${cap} imagens ` +
          `(este post tem ${files.length}). Reduza para ${cap} ou menos.`,
      );
    }
  }

  // Feed maps to a single-image TikTok photo post (design doc: "feed single image ->
  // Photo post (1 image)"). Only checked when no video item is present — the hasVideo
  // branch above already rejects a video-in-feed post with its own message.
  if (tipo === "feed" && !hasVideo && files.length !== 1) {
    errors.push("Posts de feed no TikTok devem ter exatamente 1 imagem.");
  }
}

function validatePrivacyLevel(errors: string[], settings: TikTokSettings) {
  const privacyLevel = settings.privacy_level;
  if (!privacyLevel) {
    errors.push("Configuração de privacidade do TikTok (privacy_level) não definida.");
    return;
  }
  if (!VALID_PRIVACY_LEVELS.has(privacyLevel)) {
    errors.push("Configuração de privacidade do TikTok inválida.");
    return;
  }

  // Unaudited-mode gate (scheduling-time, design doc "Unaudited-mode gate"): until the
  // Content Posting audit passes, every TikTok post must be SELF_ONLY. This makes
  // unaudited failures impossible by construction instead of a predictable cron error.
  const audited = Deno.env.get("TIKTOK_APP_AUDITED") === "true";
  if (!audited && privacyLevel !== "SELF_ONLY") {
    errors.push(
      "App TikTok em modo de teste: apenas publicação privada (SELF_ONLY) é permitida até a auditoria do TikTok",
    );
  }

  if (settings.brand_content_toggle === true && privacyLevel === "SELF_ONLY") {
    errors.push(TIKTOK_MSG.brandedPrivate);
  }
}

/** Validate a post for TikTok scheduling. Throws on infrastructure errors (DB read failures);
 * domain validation errors (missing fields, invalid values) are accumulated in result.errors
 * and never thrown. Note: thrown errors may embed raw DB error text — callers must catch
 * and return a generic PT-BR message to clients, never forward error.message directly
 * (security rule: never log or return raw error details to clients). */
export async function validateForTikTokScheduling(
  db: DbClient,
  postId: number,
  opts?: { skipDateCheck?: boolean },
): Promise<TikTokValidationResult> {
  const errors: string[] = [];

  const { data: post, error: postError } = await db
    .from("workflow_posts")
    .select(
      "id, platform, tipo, tiktok_caption, tiktok_title, tiktok_settings, ig_caption, scheduled_at, workflow_id, cliente_id",
    )
    .eq("id", postId)
    .maybeSingle();
  if (postError) {
    throw new Error(`validateForTikTokScheduling: workflow_posts read failed: ${postError.message}`);
  }
  if (!post) return { ok: false, errors: ["Post não encontrado."] };

  // TikTok Stories are not in the API (design doc, permanently out of scope). Nothing else
  // about the TikTok content-type mapping applies to a stories post, so short-circuit.
  if (post.tipo === "stories") {
    return { ok: false, errors: ["Stories não são suportados no TikTok."] };
  }

  if (!opts?.skipDateCheck) {
    if (!post.scheduled_at) {
      errors.push("Data de publicação não definida.");
    } else if (new Date(post.scheduled_at).getTime() < Date.now() + 10 * 60 * 1000) {
      errors.push("Data de publicação deve ser pelo menos 10 minutos no futuro.");
    }
  }

  const caption: string = post.tiktok_caption ?? post.ig_caption ?? "";
  validateCaptionAndTitle(errors, post.tipo, caption, post.tiktok_title);

  const { data: links, error: linksError } = await db
    .from("post_file_links")
    .select("sort_order, files!inner(id, kind, mime_type, size_bytes, width, height, duration_seconds, r2_key, media_lost_at)")
    .eq("post_id", postId)
    .order("sort_order", { ascending: true });
  if (linksError) {
    throw new Error(`validateForTikTokScheduling: post_file_links read failed: ${linksError.message}`);
  }

  const mediaFiles: TikTokMediaFile[] = (links ?? []).map((l: any) => ({
    ...l.files,
    sort_order: l.sort_order,
  }));

  validateMediaForTipo(errors, post.tipo, post.platform, mediaFiles);
  if (mediaFiles.some((f) => f.media_lost_at != null)) errors.push(TIKTOK_MSG.mediaLost);

  const settings: TikTokSettings = post.tiktok_settings ?? {};
  validatePrivacyLevel(errors, settings);

  const { data: account, error: accountError } = await db
    .from("tiktok_accounts")
    .select("id, encrypted_access_token, encrypted_refresh_token, tiktok_open_id, authorization_status")
    .eq("client_id", post.cliente_id)
    .maybeSingle();
  if (accountError) {
    throw new Error(`validateForTikTokScheduling: tiktok_accounts read failed: ${accountError.message}`);
  }

  if (!account) {
    errors.push("Cliente não tem conta TikTok conectada.");
  } else {
    if (account.authorization_status !== "active") {
      errors.push("Conta do TikTok não está ativa. Reconecte a conta.");
    } else {
      try {
        await decryptTikTokToken(account.encrypted_access_token, "access");
        await decryptTikTokToken(account.encrypted_refresh_token, "refresh");
      } catch {
        errors.push("Erro ao decifrar token do TikTok. Reconecte a conta.");
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    media: mediaFiles,
    account: account
      ? {
          id: account.id,
          encrypted_access_token: account.encrypted_access_token,
          encrypted_refresh_token: account.encrypted_refresh_token,
          tiktok_open_id: account.tiktok_open_id,
        }
      : undefined,
  };
}

// --- Payload builders ---

/** Subset of claim_tiktok_targets_for_publishing's row shape needed to build an init payload.
 * `caption` is already tipo-fallback-resolved (tiktok_caption ?? ig_caption ?? '') by the
 * caller/RPC — this module does not re-resolve it here. */
export interface ClaimedTikTokPost {
  tipo: string;
  caption: string;
  tiktok_title?: string | null;
  tiktok_settings: TikTokSettings;
}

/** Builds the POST /v2/post/publish/video/init/ body. Omits every optional key whose
 * setting is undefined/null entirely — TikTok rejects explicit nulls — and never emits a
 * photo-only field (auto_add_music, photo_cover_index, photo_images, post_mode, media_type). */
export function buildVideoInitPayload(post: ClaimedTikTokPost, videoUrl: string): object {
  const s = post.tiktok_settings ?? {};
  const postInfo: Record<string, unknown> = {
    title: post.caption,
  };
  if (s.privacy_level !== undefined && s.privacy_level !== null) {
    postInfo.privacy_level = s.privacy_level;
  }
  if (s.disable_comment !== undefined && s.disable_comment !== null) {
    postInfo.disable_comment = s.disable_comment;
  }
  if (s.disable_duet !== undefined && s.disable_duet !== null) {
    postInfo.disable_duet = s.disable_duet;
  }
  if (s.disable_stitch !== undefined && s.disable_stitch !== null) {
    postInfo.disable_stitch = s.disable_stitch;
  }
  if (s.brand_organic_toggle !== undefined && s.brand_organic_toggle !== null) {
    postInfo.brand_organic_toggle = s.brand_organic_toggle;
  }
  if (s.brand_content_toggle !== undefined && s.brand_content_toggle !== null) {
    postInfo.brand_content_toggle = s.brand_content_toggle;
  }
  if (s.is_aigc !== undefined && s.is_aigc !== null) {
    postInfo.is_aigc = s.is_aigc;
  }
  if (s.video_cover_timestamp_ms !== undefined && s.video_cover_timestamp_ms !== null) {
    postInfo.video_cover_timestamp_ms = s.video_cover_timestamp_ms;
  }

  return {
    post_info: postInfo,
    source_info: {
      source: "PULL_FROM_URL",
      video_url: videoUrl,
    },
  };
}

/** Builds the POST /v2/post/publish/content/init/ body for a photo post (single image or
 * carousel). Omits every optional key whose setting is undefined/null entirely, and never
 * emits a video-only field (disable_duet, disable_stitch, is_aigc, video_cover_timestamp_ms). */
export function buildPhotoInitPayload(post: ClaimedTikTokPost, imageUrls: string[]): object {
  const s = post.tiktok_settings ?? {};
  const postInfo: Record<string, unknown> = {};
  if (post.tiktok_title !== undefined && post.tiktok_title !== null && post.tiktok_title !== "") {
    postInfo.title = post.tiktok_title;
  }
  postInfo.description = post.caption;
  if (s.privacy_level !== undefined && s.privacy_level !== null) {
    postInfo.privacy_level = s.privacy_level;
  }
  if (s.disable_comment !== undefined && s.disable_comment !== null) {
    postInfo.disable_comment = s.disable_comment;
  }
  if (s.auto_add_music !== undefined && s.auto_add_music !== null) {
    postInfo.auto_add_music = s.auto_add_music;
  }
  if (s.brand_organic_toggle !== undefined && s.brand_organic_toggle !== null) {
    postInfo.brand_organic_toggle = s.brand_organic_toggle;
  }
  if (s.brand_content_toggle !== undefined && s.brand_content_toggle !== null) {
    postInfo.brand_content_toggle = s.brand_content_toggle;
  }

  return {
    post_info: postInfo,
    source_info: {
      source: "PULL_FROM_URL",
      photo_images: imageUrls,
      photo_cover_index: s.photo_cover_index ?? 0,
    },
    post_mode: "DIRECT_POST",
    media_type: "PHOTO",
  };
}

// --- Status-fetch mapping ---

export interface StatusFetchResult {
  state: "processing" | "published" | "failed";
  publicPostId?: string;
  failReason?: string;
}

/** Maps a POST /v2/post/publish/status/fetch/ response (the envelope's already-unwrapped
 * `data` field — see tiktokFetch in _shared/tiktok.ts) to a normalized result. Uses the wire
 * status/field constants from _shared/tiktok.ts exclusively — including FIELD_PUBLIC_POST_ID's
 * sic misspelling — so the exact TikTok string never needs to be retyped here. */
export function mapStatusFetch(json: any): StatusFetchResult {
  const status = json?.status;

  if (status === STATUS_PUBLISH_COMPLETE) {
    const ids = json?.[FIELD_PUBLIC_POST_ID];
    const publicPostId = Array.isArray(ids) ? ids[0] : typeof ids === "string" ? ids : undefined;
    return publicPostId !== undefined ? { state: "published", publicPostId } : { state: "published" };
  }

  if (status === STATUS_FAILED) {
    const failReason = json?.fail_reason;
    return failReason ? { state: "failed", failReason } : { state: "failed" };
  }

  if (
    status === STATUS_PROCESSING_UPLOAD ||
    status === STATUS_PROCESSING_DOWNLOAD ||
    // SEND_TO_USER_INBOX only occurs in TikTok's "inbox" draft-posting mode (video.upload
    // scope), which this integration never uses (direct-post only) — mapped to "processing"
    // defensively in case a stray response ever reports it.
    status === STATUS_SEND_TO_USER_INBOX
  ) {
    return { state: "processing" };
  }

  // Unknown/future status: treat conservatively as still processing rather than silently
  // marking a post failed or published on a status TikTok hasn't documented yet.
  return { state: "processing" };
}

// --- Shared status-resolution step (Task B6) ---
//
// "Confirm via status fetch, then apply" — this is the exact per-post body that used to live
// inline in tiktok-publish-cron/core.ts's processStatusPhase (Task B5). Extracted here so
// tiktok-webhook (Task B6) can re-confirm a post.publish.complete/failed webhook delivery
// against the same POST /v2/post/publish/status/fetch/ call and apply the SAME outcome logic —
// webhook deliveries are hints, never mutated on directly (design doc, "tiktok-webhook").
//
// Deliberately takes an already-obtained `accessToken` rather than an accountId + fetching its
// own token: tiktok-publish-cron's module comment documents that getFreshTikTokToken MUST be
// called once per account per run (posts grouped by account, token fetched outside the per-post
// loop) — folding a token fetch into this per-post function would silently break that invariant
// the first time an account has >1 post in the same status-phase batch. The cron fetches once
// per account and passes the token in; tiktok-webhook (always exactly one post per call) fetches
// its own token immediately beforehand via the same getFreshTikTokToken.
//
// deno-lint-ignore no-explicit-any
type SvcClient = any;

/** Generic error-message extraction — shared by the cron and this module so callers of
 * confirmAndApplyPublishStatus/markTikTokPublishFailed don't need their own copy. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (
    err && typeof err === "object" && "message" in err &&
    typeof (err as { message?: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return "unknown";
}

/** Releases a TikTok destination's `processing_at` lock WITHOUT touching its status — used by
 * tiktok-publish-cron when a claimed destination is deferred (per-account overflow) or when
 * requeue_target declines (the post left publication), so the next claim can pick it back up. */
export async function clearLock(
  svc: SvcClient,
  targetId: number,
  now: () => Date = () => new Date(),
): Promise<void> {
  const { error } = await svc
    .from("post_targets")
    .update({ processing_at: null, updated_at: now().toISOString() })
    .eq("id", targetId);
  if (error) {
    console.error(`[tiktok-publish] failed to clear lock for target ${targetId}:`, error.message);
  }
}

export interface MarkTikTokPublishFailedOpts {
  /** TikTok wire fail_reason; persisted as post_targets.error_code. A reason outside
   * RETRYABLE_FAIL_REASONS exhausts the destination (retry_count = 3). */
  failReason?: string;
  /** Precheck failures and mapped (curated pt-BR) errors: exhaust immediately (spec A10). */
  nonRetryable?: boolean;
  source?: "system" | "workspace_user";
  actorId?: string | null;
}

/**
 * Marks the post's TikTok destination failed through mark_target_failed (P4): the destination
 * write, the retry count and the post status recompute (-> falha_publicacao) happen in ONE
 * transaction, so the old two-write compensation dance is gone. The RPC is idempotent: a
 * destination already in `falha` (the same publish reported by both the cron's status phase and
 * a webhook) or already `publicado` is left alone and the call resolves `false`.
 *
 * Never throws. An RPC error is logged and resolves `false`; the destination keeps its claim
 * lock, so the claim's 10-minute stale window hands it back to the same phase.
 */
export async function markTikTokPublishFailed(
  svc: SvcClient,
  postId: number,
  message: string,
  opts?: MarkTikTokPublishFailedOpts,
): Promise<boolean> {
  const nonRetryable = opts?.nonRetryable === true ||
    (opts?.failReason !== undefined && !RETRYABLE_FAIL_REASONS.includes(opts.failReason));

  const { data, error } = await svc.rpc("mark_target_failed", {
    p_post_id: postId,
    p_platform: "tiktok",
    p_error: message.slice(0, 500),
    p_error_code: opts?.failReason ?? null,
    p_retryable: !nonRetryable,
    p_source: opts?.source ?? "system",
    p_actor: opts?.actorId ?? null,
  });
  if (error) {
    console.error(`[tiktok-publish] mark_target_failed failed for post ${postId}:`, error.message);
    return false;
  }
  return data === true;
}

const TIKTOK_PHOTO_TIPOS = new Set(["feed", "carrossel"]);

/** Public TikTok URL for a published post. Photo posts live under /photo/ (spec B5; verify on
 * a real photo post at rollout, revert this one line if TikTok serves them under /video/). */
export function buildTikTokPostUrl(username: string, postId: string, tipo: string | null | undefined): string {
  const segment = tipo && TIKTOK_PHOTO_TIPOS.has(tipo) ? "photo" : "video";
  return `https://www.tiktok.com/@${username}/${segment}/${postId}`;
}

export interface ConfirmAndApplyPublishStatusPost {
  post_id: number;
  /** post_targets.id of the TikTok destination (the lock the caller holds). */
  target_id: number;
  /** TikTok's temporary publish_id, stored on the destination. */
  publish_ref: string | null;
  tiktok_username: string | null;
  tipo: string | null;
}

export interface ConfirmAndApplyPublishStatusDeps {
  svc: SvcClient;
  tiktokFetch: (path: string, init: RequestInit & { accessToken: string }) => Promise<unknown>;
  /** Already-fresh access token — see the module comment above for why this function never
   * calls getFreshTikTokToken itself. */
  accessToken: string;
  now?: () => Date;
}

export type ConfirmAndApplyPublishStatusOutcome = "published" | "processing" | "failed";

/**
 * The ONE place that turns a TikTok publish_id into applied `post_targets` state — "confirm
 * via status fetch, then apply" (design doc, tiktok-webhook section). Shared by
 * tiktok-publish-cron's status phase (Task B5) and tiktok-webhook's post.publish.complete/failed
 * handling (Task B6, always re-confirming rather than trusting the webhook payload directly).
 *
 * Never throws: every failure path (missing publish_id, a thrown tiktokFetch/RPC/update error, a
 * FAILED status) funnels into markTikTokPublishFailed and resolves to "failed" — callers just
 * tally/branch on the returned outcome, they never need their own try/catch around this call.
 *
 * Note on `post_targets.processing_at`: the "published" (via mark_target_published, whose SQL
 * unconditionally clears this column), "processing", and "failed" outcomes all clear this lock as
 * part of their write, same as before extraction. tiktok-webhook (_shared use, Task B6) claims
 * this exact same lock itself immediately before calling this function (handler.ts's
 * claimPublishLock, which takes the same post_targets.processing_at lock as
 * claim_tiktok_targets_for_publishing) — so a webhook
 * re-confirmation and a concurrently running cron status-fetch on the same destination always serialize
 * on that claim rather than racing to write this column. Without that claim, a cron status-fetch
 * still in flight against the PRIOR TikTok state could commit its (stale) outcome AFTER this
 * function already applied the fresher one, transiently regressing the row — routine, not a rare
 * corner case, since the webhook and the per-minute cron are both normal, active paths to the
 * same row.
 */
export async function confirmAndApplyPublishStatus(
  deps: ConfirmAndApplyPublishStatusDeps,
  post: ConfirmAndApplyPublishStatusPost,
): Promise<ConfirmAndApplyPublishStatusOutcome> {
  const { svc, tiktokFetch, accessToken } = deps;
  const now = deps.now ?? (() => new Date());

  try {
    if (!post.publish_ref) {
      throw new Error("Destino sem publish_id do TikTok para consultar status.");
    }

    const statusData = await tiktokFetch("/post/publish/status/fetch/", {
      method: "POST",
      accessToken,
      body: JSON.stringify({ publish_id: post.publish_ref }),
    });
    const result = mapStatusFetch(statusData);

    if (result.state === "published") {
      const permalink = result.publicPostId && post.tiktok_username
        ? buildTikTokPostUrl(post.tiktok_username, result.publicPostId, post.tipo)
        : undefined;

      const { error: markErr } = await svc.rpc("mark_target_published", {
        p_post_id: post.post_id,
        p_platform: "tiktok",
        p_fields: {
          ...(result.publicPostId ? { external_id: result.publicPostId } : {}),
          ...(permalink ? { permalink } : {}),
          published_at: now().toISOString(),
        },
        p_source: "system",
        p_actor: null,
      });
      if (markErr) throw new Error(`mark_target_published falhou: ${markErr.message}`);
      return "published";
    }

    if (result.state === "processing") {
      const { error: updErr } = await svc
        .from("post_targets")
        .update({ processing_at: null, updated_at: now().toISOString() })
        .eq("id", post.target_id);
      if (updErr) throw new Error(`Falha ao liberar a trava do destino TikTok: ${updErr.message}`);
      return "processing";
    }

    const failReason = result.failReason;
    const message = failReason
      ? `Falha ao publicar no TikTok: ${failReason}`
      : "Falha ao publicar no TikTok.";
    await markTikTokPublishFailed(svc, post.post_id, message, { failReason });
    return "failed";
  } catch (err) {
    await markTikTokPublishFailed(svc, post.post_id, errorMessage(err));
    return "failed";
  }
}
