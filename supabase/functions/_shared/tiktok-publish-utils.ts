// TikTok scheduling validation matrix + Content Posting API payload builders.
// Mirrors the STRUCTURE of instagram-publish-utils.ts::validateForScheduling (load post ->
// load linked media -> load workflow -> load account -> accumulate PT-BR errors ->
// return { ok, errors, ... }).
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
      "id, platform, tipo, tiktok_caption, tiktok_title, tiktok_settings, ig_caption, scheduled_at, workflow_id",
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
    .select("sort_order, files!inner(id, kind, mime_type, size_bytes, width, height, duration_seconds, r2_key)")
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

  const settings: TikTokSettings = post.tiktok_settings ?? {};
  validatePrivacyLevel(errors, settings);

  const { data: workflow, error: workflowError } = await db
    .from("workflows")
    .select("cliente_id")
    .eq("id", post.workflow_id)
    .maybeSingle();
  if (workflowError) {
    throw new Error(`validateForTikTokScheduling: workflows read failed: ${workflowError.message}`);
  }
  if (!workflow) return { ok: false, errors: [...errors, "Workflow não encontrado."] };

  const { data: account, error: accountError } = await db
    .from("tiktok_accounts")
    .select("id, encrypted_access_token, encrypted_refresh_token, tiktok_open_id, authorization_status")
    .eq("client_id", workflow.cliente_id)
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

/** Subset of claim_posts_for_tiktok_publishing's row shape needed to build an init payload.
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

/** Releases the tiktok_publish_processing_at lock WITHOUT touching tiktok_publish_status —
 * used by tiktok-publish-cron when a post is deferred (per-account overflow) rather than failed,
 * so the next run's claim can pick it straight back up. Also used as the best-effort lock
 * release inside markTikTokPublishFailed's self-healing paths. */
export async function clearLock(svc: SvcClient, postId: number): Promise<void> {
  const { error } = await svc
    .from("workflow_posts")
    .update({ tiktok_publish_processing_at: null })
    .eq("id", postId);
  if (error) {
    console.error(`[tiktok-publish] failed to clear lock for post ${postId}:`, error.message);
  }
}

/**
 * Marks a claimed/targeted post failed: `tiktok_publish_status='failed'`, a PT-BR-or-neutral
 * error message (≤500 chars), lock cleared, and the card moved to `falha_publicacao` via
 * record_post_status_change. `retryCount` is bumped by one UNLESS `failReason` is a TikTok wire
 * fail_reason string that is NOT in RETRYABLE_FAIL_REASONS (e.g. `spam_risk_too_many_posts`) —
 * those exhaust immediately (retry_count=3) since a retry can never succeed. Generic infra
 * failures (network, TikTok init/status errors with no documented fail_reason)
 * are always retryable and simply increment, relying on the claim RPC's `retry_count < 3`
 * cutoff to eventually stop them.
 *
 * Self-healing on partial failure: this function does TWO writes (the direct
 * tiktok_publish_status='failed' update, then the record_post_status_change RPC), and every
 * claim phase's WHERE clause only recognizes specific status+tiktok_publish_status PAIRS (see
 * claim_posts_for_tiktok_publishing). If either write fails outright, this function never lets
 * the two columns drift into an unrecognized pair — see the inline comments at each failure
 * branch below for exactly how each case converges back to a claimable state.
 *
 * Shared by tiktok-publish-cron (init/status phases, direct token-failure calls) and
 * tiktok-webhook (via confirmAndApplyPublishStatus below, on webhook-triggered re-confirmation).
 * A webhook-triggered call never held the claim RPC's processing lock in the first place, so
 * its `clearLock` write is a harmless no-op (the column is already NULL) rather than releasing
 * anything meaningful — see confirmAndApplyPublishStatus's module comment for the same point
 * about `tiktok_publish_processing_at` on the published/processing paths.
 */
export async function markTikTokPublishFailed(
  svc: SvcClient,
  postId: number,
  retryCount: number,
  message: string,
  opts?: { failReason?: string },
): Promise<void> {
  const nonRetryable = opts?.failReason !== undefined && !RETRYABLE_FAIL_REASONS.includes(opts.failReason);
  const newRetryCount = nonRetryable ? 3 : retryCount + 1;

  const { error: updateErr } = await svc
    .from("workflow_posts")
    .update({
      tiktok_publish_status: "failed",
      tiktok_publish_error: message.slice(0, 500),
      tiktok_publish_retry_count: newRetryCount,
      tiktok_publish_processing_at: null,
    })
    .eq("id", postId);
  if (updateErr) {
    console.error(`[tiktok-publish] failed to persist failure state for post ${postId}:`, updateErr.message);
    // Write (1) itself failed: tiktok_publish_status was never set to 'failed', so the post is
    // left exactly as the claiming phase found it — status='agendado' paired with whatever
    // tiktok_publish_status that phase's own WHERE clause required (NULL for init, 'initiated'/
    // 'processing' for status; see claim_posts_for_tiktok_publishing). That pair is one the SAME
    // phase re-claims on its own once the lock's 10-minute stale window elapses — clearLock below
    // releases it immediately instead of making it wait — so this self-heals with no RPC needed.
    // Firing record_post_status_change anyway would flip status to 'falha_publicacao' while
    // tiktok_publish_status never became 'failed', producing a pair NO claim phase's WHERE clause
    // recognizes — permanently orphaning the post. So: log, best-effort clear the lock, and stop.
    await clearLock(svc, postId);
    return;
  }

  const { error: statusErr } = await svc.rpc("record_post_status_change", {
    p_post_id: postId,
    p_new_status: "falha_publicacao",
    p_source: "system",
    p_actor: null,
    p_fields: {},
  });
  if (statusErr) {
    console.error(`[tiktok-publish] record_post_status_change failed for post ${postId}:`, statusErr.message);
    // Write (1) already committed tiktok_publish_status='failed', but status is still 'agendado'
    // — a pair no claim phase's WHERE clause recognizes either (retry needs status=
    // 'falha_publicacao' AND tiktok_publish_status='failed' together). Compensate with a direct
    // status write so the retry phase can pick it back up next run. The status-capture trigger
    // (workflow_posts_status_event, migration 20260606000001) still records the transition off
    // this direct UPDATE; losing actor/source context on this backstop path is acceptable.
    const { error: compensateErr } = await svc
      .from("workflow_posts")
      .update({ status: "falha_publicacao" })
      .eq("id", postId);
    if (compensateErr) {
      // Both writes failed: the post is stuck as status='agendado' + tiktok_publish_status=
      // 'failed', a pair no claim phase recognizes — it will NOT self-heal on its own. The
      // caller's own failure-reporting path (reportCronFailure for the cron; processed_at simply
      // stays NULL for the webhook, per its own crash-leaves-unprocessed contract) is the human
      // signal that something needs attention; this loud marker is for whoever is reading logs
      // off that signal to find the specific orphaned post.
      console.error(
        `[TIKTOK-PUBLISH] ORPHAN RISK post ${postId}: failed+agendado state, manual fix needed`,
      );
    }
  }
}

export interface ConfirmAndApplyPublishStatusPost {
  post_id: number;
  tiktok_publish_id: string | null;
  tiktok_publish_retry_count: number;
  tiktok_username: string | null;
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
 * The ONE place that turns a TikTok publish_id into applied `workflow_posts` state — "confirm
 * via status fetch, then apply" (design doc, tiktok-webhook section). Shared by
 * tiktok-publish-cron's status phase (Task B5) and tiktok-webhook's post.publish.complete/failed
 * handling (Task B6, always re-confirming rather than trusting the webhook payload directly).
 *
 * Never throws: every failure path (missing publish_id, a thrown tiktokFetch/RPC/update error, a
 * FAILED status) funnels into markTikTokPublishFailed and resolves to "failed" — callers just
 * tally/branch on the returned outcome, they never need their own try/catch around this call.
 *
 * Note on `tiktok_publish_processing_at`: the "published" (via mark_platform_published, whose SQL
 * unconditionally clears this column), "processing", and "failed" outcomes all clear this lock as
 * part of their write, same as before extraction. tiktok-webhook (_shared use, Task B6) claims
 * this exact same lock itself immediately before calling this function (handler.ts's
 * claimPublishLock, same claim shape as claim_posts_for_tiktok_publishing) — so a webhook
 * re-confirmation and a concurrently running cron status-fetch on the same post always serialize
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
    if (!post.tiktok_publish_id) {
      throw new Error("Post sem publish_id do TikTok para consultar status.");
    }

    const statusData = await tiktokFetch("/post/publish/status/fetch/", {
      method: "POST",
      accessToken,
      body: JSON.stringify({ publish_id: post.tiktok_publish_id }),
    });
    const result = mapStatusFetch(statusData);

    if (result.state === "published") {
      const tiktokPostUrl = result.publicPostId && post.tiktok_username
        ? `https://www.tiktok.com/@${post.tiktok_username}/video/${result.publicPostId}`
        : undefined;

      const { error: markErr } = await svc.rpc("mark_platform_published", {
        p_post_id: post.post_id,
        p_platform: "tiktok",
        p_source: "system",
        p_actor: null,
        p_fields: {
          ...(result.publicPostId ? { tiktok_post_id: result.publicPostId } : {}),
          ...(tiktokPostUrl ? { tiktok_post_url: tiktokPostUrl } : {}),
          published_at: now().toISOString(),
        },
      });
      if (markErr) throw new Error(`mark_platform_published falhou: ${markErr.message}`);
      return "published";
    }

    if (result.state === "processing") {
      const { error: updErr } = await svc
        .from("workflow_posts")
        .update({ tiktok_publish_status: "processing", tiktok_publish_processing_at: null })
        .eq("id", post.post_id);
      if (updErr) throw new Error(`Falha ao atualizar status de processamento: ${updErr.message}`);
      return "processing";
    }

    const failReason = result.failReason;
    const message = failReason
      ? `Falha ao publicar no TikTok: ${failReason}`
      : "Falha ao publicar no TikTok.";
    await markTikTokPublishFailed(svc, post.post_id, post.tiktok_publish_retry_count, message, { failReason });
    return "failed";
  } catch (err) {
    await markTikTokPublishFailed(svc, post.post_id, post.tiktok_publish_retry_count, errorMessage(err));
    return "failed";
  }
}
