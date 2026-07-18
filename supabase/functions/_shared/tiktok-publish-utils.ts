// TikTok scheduling validation matrix + Content Posting API payload builders.
// Mirrors the STRUCTURE of instagram-publish-utils.ts::validateForScheduling (load post ->
// load linked media -> Estúdio design gate -> load workflow -> load account -> accumulate
// PT-BR errors -> return { ok, errors, ... }). The Estúdio gate itself is imported from
// there (checkDesignReadiness is platform-agnostic — do not copy it).
//
// Post-type -> TikTok content-type mapping (design doc "Post-type mapping & validation"):
//   tipo 'reels'      -> video direct post   (POST /v2/post/publish/video/init/)
//   tipo 'feed'       -> photo post, 1 image (POST /v2/post/publish/content/init/)
//   tipo 'carrossel'  -> photo post, N images (same endpoint)
//   tipo 'stories'    -> not supported by the TikTok API; rejected outright

import { checkDesignReadiness, type DesignSummary } from "./instagram-publish-utils.ts";
import {
  decryptTikTokToken,
  FIELD_PUBLIC_POST_ID,
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
  /** Set when validation blocked on the Estúdio design — same shape/semantics as the
   * Instagram gate (T4.1); carries what a caller needs to fire the render re-trigger. */
  designBlocked?: DesignSummary;
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
    .single();
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

  // Estúdio gate (design doc: reused verbatim, platform-agnostic).
  let designBlocked: DesignSummary | undefined;
  const readiness = await checkDesignReadiness(db, postId);
  if (!readiness.ready && readiness.design) {
    designBlocked = readiness.design;
    errors.push(
      readiness.design.render_status === "failed"
        ? "A arte do Estúdio falhou ao renderizar. Abra o post no Estúdio e salve novamente para tentar outra vez."
        : "A arte do Estúdio ainda está sendo gerada. Aguarde alguns instantes e tente novamente.",
    );
  }

  const { data: workflow, error: workflowError } = await db
    .from("workflows")
    .select("cliente_id")
    .eq("id", post.workflow_id)
    .single();
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
    designBlocked,
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
