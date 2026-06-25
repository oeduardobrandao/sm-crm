import { signGetUrl } from "./r2.ts";

// --- Token Decryption (duplicated across functions; centralized here) ---

function getTokenEncryptionKey(): string {
  const key = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY required");
  return key;
}

async function getEncryptionKey(purpose: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw", enc.encode(getTokenEncryptionKey()), { name: "HKDF" }, false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(purpose) },
    baseKey, { name: "AES-GCM", length: 256 }, false, usage
  );
}

async function getLegacyKey(usage: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(getTokenEncryptionKey().padEnd(32, "0").slice(0, 32)),
    { name: "AES-GCM" }, false, usage
  );
}

export async function decryptToken(encryptedBase64: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  try {
    const key = await getEncryptionKey("instagram-access-token", ["decrypt"]);
    return new TextDecoder().decode(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data)
    );
  } catch {
    const legacyKey = await getLegacyKey(["decrypt"]);
    return new TextDecoder().decode(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv }, legacyKey, data)
    );
  }
}

// --- Media Validation ---

interface MediaFile {
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

interface ValidationError {
  file_id: number;
  message: string;
}

const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_VIDEO_MIMES = new Set(["video/mp4", "video/quicktime"]);
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const VIDEO_MAX_BYTES = 250 * 1024 * 1024;
const IMAGE_MIN_DIM = 320;
const IMAGE_AR_MIN = 3 / 4;
const STORY_IMAGE_AR_MIN = 9 / 16;
const IMAGE_AR_MAX = 1.91;
const VIDEO_AR_MIN = 9 / 16;
const VIDEO_AR_MAX = 1.25;
const VIDEO_MIN_DURATION = 3;
const VIDEO_MAX_DURATION = 90;
const STORY_VIDEO_MAX_DURATION = 60;

/** Instagram Content Publishing API caps carousels at 10 items.
 *  (The native app allows 20, but the Graph API does not.) Stories are exempt
 *  — they publish as sequential segments, not a single carousel container. */
export const CAROUSEL_MAX_ITEMS = 10;

export function validateMedia(files: MediaFile[], opts?: { forStories?: boolean }): ValidationError[] {
  const errors: ValidationError[] = [];
  const imageArMin = opts?.forStories ? STORY_IMAGE_AR_MIN : IMAGE_AR_MIN;
  const imageArLabel = opts?.forStories ? "9:16 a 1.91:1" : "3:4 a 1.91:1";
  const videoMaxDuration = opts?.forStories ? STORY_VIDEO_MAX_DURATION : VIDEO_MAX_DURATION;
  const videoDurationLabel = opts?.forStories ? "3–60 segundos" : "3–90 segundos";
  for (const f of files) {
    if (f.kind === "image") {
      if (!ALLOWED_IMAGE_MIMES.has(f.mime_type)) {
        errors.push({ file_id: f.id, message: "Imagens devem estar em formato JPEG" });
        continue;
      }
      if (f.size_bytes > IMAGE_MAX_BYTES) {
        errors.push({ file_id: f.id, message: "Imagem excede 8 MB (limite do Instagram)" });
      }
      if (f.width && f.height) {
        if (f.width < IMAGE_MIN_DIM || f.height < IMAGE_MIN_DIM) {
          errors.push({ file_id: f.id, message: "Imagem muito pequena (mínimo 320×320)" });
        }
        const ar = f.width / f.height;
        if (ar < imageArMin || ar > IMAGE_AR_MAX) {
          errors.push({ file_id: f.id, message: `Proporção da imagem fora do permitido (${imageArLabel})` });
        }
      }
    } else if (f.kind === "video") {
      if (!ALLOWED_VIDEO_MIMES.has(f.mime_type)) {
        errors.push({ file_id: f.id, message: "Vídeos devem estar em formato MP4 ou MOV" });
        continue;
      }
      if (f.size_bytes > VIDEO_MAX_BYTES) {
        errors.push({ file_id: f.id, message: "Vídeo excede 250 MB (limite do Instagram)" });
      }
      if (f.duration_seconds != null) {
        if (f.duration_seconds < VIDEO_MIN_DURATION || f.duration_seconds > videoMaxDuration) {
          errors.push({ file_id: f.id, message: `Duração do vídeo fora do permitido (${videoDurationLabel})` });
        }
      }
      if (f.width && f.height) {
        const ar = f.width / f.height;
        if (ar < VIDEO_AR_MIN || ar > VIDEO_AR_MAX) {
          errors.push({ file_id: f.id, message: "Proporção do vídeo fora do permitido" });
        }
      }
    }
  }
  return errors;
}

// --- Schedule Validation ---

type DbClient = { from: (table: string) => any };

export interface ScheduleValidationResult {
  ok: boolean;
  errors: string[];
  media?: MediaFile[];
  account?: { encrypted_access_token: string; instagram_user_id: string };
}

export async function validateForScheduling(
  db: DbClient,
  postId: number,
  opts?: { skipDateCheck?: boolean },
): Promise<ScheduleValidationResult> {
  const errors: string[] = [];

  const { data: post } = await db
    .from("workflow_posts")
    .select("id, scheduled_at, ig_caption, workflow_id, tipo")
    .eq("id", postId)
    .single();
  if (!post) return { ok: false, errors: ["Post não encontrado."] };
  const isStory = post.tipo === "stories";

  if (!opts?.skipDateCheck) {
    if (!post.scheduled_at) {
      errors.push("Data de publicação não definida.");
    } else if (new Date(post.scheduled_at).getTime() < Date.now() + 10 * 60 * 1000) {
      errors.push("Data de publicação deve ser pelo menos 10 minutos no futuro.");
    }
  }
  if (!isStory && !post.ig_caption?.trim()) errors.push("Legenda do Instagram não definida.");

  const { data: links } = await db
    .from("post_file_links")
    .select("sort_order, files!inner(id, kind, mime_type, size_bytes, width, height, duration_seconds, r2_key)")
    .eq("post_id", postId)
    .order("sort_order", { ascending: true });

  const mediaFiles: MediaFile[] = (links ?? []).map((l: any) => ({
    ...l.files,
    sort_order: l.sort_order,
  }));

  if (mediaFiles.length === 0) {
    errors.push("Post precisa de pelo menos uma mídia.");
  } else {
    if (!isStory && mediaFiles.length > CAROUSEL_MAX_ITEMS) {
      errors.push(
        `Carrossel do Instagram aceita no máximo ${CAROUSEL_MAX_ITEMS} itens ` +
          `(este post tem ${mediaFiles.length}). Reduza para ${CAROUSEL_MAX_ITEMS} ou menos. ` +
          `O app do Instagram permite 20, mas a publicação via API é limitada a ${CAROUSEL_MAX_ITEMS}.`,
      );
    }
    const mediaErrors = validateMedia(mediaFiles, { forStories: isStory });
    for (const e of mediaErrors) errors.push(e.message);
  }

  const { data: workflow } = await db
    .from("workflows")
    .select("cliente_id")
    .eq("id", post.workflow_id)
    .single();

  if (!workflow) return { ok: false, errors: ["Workflow não encontrado."] };

  const { data: account } = await db
    .from("instagram_accounts")
    .select("encrypted_access_token, instagram_user_id, token_expires_at, authorization_status")
    .eq("client_id", workflow.cliente_id)
    .maybeSingle();

  if (!account) {
    errors.push("Cliente não tem conta Instagram conectada.");
  } else {
    if (account.authorization_status === "revoked" || account.authorization_status === "disconnected" || account.authorization_status === "expired") {
      errors.push("Token do Instagram foi revogado ou expirou. Reconecte a conta.");
    }
    if (account.token_expires_at && new Date(account.token_expires_at) < new Date()) {
      errors.push("Token do Instagram expirou. Reconecte a conta.");
    }
    if (errors.length === 0 && account.encrypted_access_token) {
      try {
        await decryptToken(account.encrypted_access_token);
      } catch {
        errors.push("Erro ao decifrar token do Instagram. Reconecte a conta.");
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    media: mediaFiles,
    account: account ? {
      encrypted_access_token: account.encrypted_access_token,
      instagram_user_id: account.instagram_user_id,
    } : undefined,
  };
}

// --- Graph API Helpers ---

const GRAPH_BASE = "https://graph.instagram.com/v22.0";

function throwGraphError(data: any): never {
  const err: any = new Error(data.error.message);
  if (data.error.code === 190) err.code = 'TOKEN_EXPIRED';
  throw err;
}

export async function createSingleImageContainer(
  igUserId: string,
  token: string,
  imageUrl: string,
  caption: string,
): Promise<{ id: string }> {
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: token }),
  });
  const data = await res.json();
  if (data.error) {
    console.error(`[IG-PUBLISH] Graph API error (HTTP ${res.status}):`, JSON.stringify(data.error));
    throwGraphError(data);
  }
  console.log(`[IG-PUBLISH] Container created: ${data.id}`);
  return { id: data.id };
}

export async function createVideoContainer(
  igUserId: string,
  token: string,
  videoUrl: string,
  caption: string,
  coverUrl?: string,
): Promise<{ id: string }> {
  const body: Record<string, string> = {
    video_url: videoUrl,
    caption,
    media_type: "REELS",
    access_token: token,
  };
  if (coverUrl) body.cover_url = coverUrl;
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throwGraphError(data);
  return { id: data.id };
}

export async function createStoryImageContainer(
  igUserId: string,
  token: string,
  imageUrl: string,
): Promise<{ id: string }> {
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "STORIES",
      image_url: imageUrl,
      access_token: token,
    }),
  });
  const data = await res.json();
  if (data.error) throwGraphError(data);
  return { id: data.id };
}

export async function createStoryVideoContainer(
  igUserId: string,
  token: string,
  videoUrl: string,
): Promise<{ id: string }> {
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "STORIES",
      video_url: videoUrl,
      access_token: token,
    }),
  });
  const data = await res.json();
  if (data.error) throwGraphError(data);
  return { id: data.id };
}

export async function createCarouselChildContainer(
  igUserId: string,
  token: string,
  mediaUrl: string,
  isVideo: boolean,
): Promise<{ id: string }> {
  const body: Record<string, string | boolean> = {
    is_carousel_item: true,
    access_token: token,
  };
  if (isVideo) {
    body.video_url = mediaUrl;
    body.media_type = "VIDEO";
  } else {
    body.image_url = mediaUrl;
  }
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throwGraphError(data);
  return { id: data.id };
}

export async function createCarouselParentContainer(
  igUserId: string,
  token: string,
  childIds: string[],
  caption: string,
): Promise<{ id: string }> {
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption,
      access_token: token,
    }),
  });
  const data = await res.json();
  if (data.error) throwGraphError(data);
  return { id: data.id };
}

// --- Container creation for a post (shared by schedule / publish-now / cron) ---

interface PostMediaRow {
  id: number;
  kind: string;
  r2_key: string;
  thumbnail_r2_key: string | null;
  sort_order: number;
}

/** Media files linked to a post, ordered for carousel assembly. */
export async function fetchPostMedia(db: DbClient, postId: number): Promise<PostMediaRow[]> {
  const { data } = await db
    .from("post_file_links")
    .select("sort_order, files!inner(id, kind, r2_key, thumbnail_r2_key)")
    .eq("post_id", postId)
    .order("sort_order", { ascending: true });

  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((l: any) => ({
    id: l.files.id,
    kind: l.files.kind,
    r2_key: l.files.r2_key,
    thumbnail_r2_key: l.files.thumbnail_r2_key,
    sort_order: l.sort_order,
  }));
}

export interface StorySegment {
  file_id: number;
  container_id: string | null;
  media_id: string | null;
}

/**
 * Idempotently ensure a story post has a `story_segments` array (one entry per
 * media, ordered). Returns the existing array unchanged if already present,
 * preserving any persisted container_id/media_id. Only the single-writer holding
 * the publish_processing_at lock should call this.
 */
export async function ensureStorySegments(db: DbClient, postId: number): Promise<StorySegment[]> {
  const { data: post } = await db
    .from("workflow_posts")
    .select("story_segments")
    .eq("id", postId)
    .single();

  const existing = (post?.story_segments ?? null) as StorySegment[] | null;
  if (existing && existing.length > 0) return existing;

  const media = await fetchPostMedia(db, postId);
  const segments: StorySegment[] = media.map((m) => ({
    file_id: m.id,
    container_id: null,
    media_id: null,
  }));

  await db.from("workflow_posts").update({ story_segments: segments }).eq("id", postId);
  return segments;
}

async function setSegmentField(
  db: DbClient,
  postId: number,
  index: number,
  field: "container_id" | "media_id",
  value: string | null,
): Promise<void> {
  // deno-lint-ignore no-explicit-any
  const { error } = await (db as any).rpc("set_story_segment_field", {
    p_post_id: postId,
    p_index: index,
    p_field: field,
    p_value: value,
  });
  if (error) throw new Error(`Failed to persist story segment ${field}: ${error.message ?? error}`);
}

/** Create a STORIES container for every segment that lacks one; persist each id. */
export async function createMissingStorySegmentContainers(
  db: DbClient,
  opts: { postId: number; igUserId: string; token: string },
): Promise<StorySegment[]> {
  const { postId, igUserId, token } = opts;
  const segments = await ensureStorySegments(db, postId);
  const media = await fetchPostMedia(db, postId);
  const byFileId = new Map(media.map((m) => [m.id, m]));

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.container_id) continue;
    const file = byFileId.get(seg.file_id);
    if (!file) throw new Error(`Story segment ${i}: media file ${seg.file_id} not found`);
    const url = await signGetUrl(file.r2_key, 7200);
    const container = file.kind === "video"
      ? await createStoryVideoContainer(igUserId, token, url)
      : await createStoryImageContainer(igUserId, token, url);
    seg.container_id = container.id;
    await setSegmentField(db, postId, i, "container_id", container.id);
  }
  return segments;
}

/**
 * Publish any segment whose container is FINISHED. On ERROR, clear that segment's
 * container_id (so the next container phase recreates it) and throw. On IN_PROGRESS,
 * stop and leave the rest for the next cron cycle. allDone = all segments posted.
 */
export async function publishReadyStorySegments(
  db: DbClient,
  opts: { postId: number; igUserId: string; token: string; maxPolls?: number; intervalMs?: number },
): Promise<{ segments: StorySegment[]; allDone: boolean }> {
  const { postId, igUserId, token, maxPolls = 2, intervalMs = 3000 } = opts;
  const segments = await ensureStorySegments(db, postId);

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.media_id) continue;
    if (!seg.container_id) break; // a container is still missing; container phase first

    const containerId = seg.container_id; // narrowed: non-null past the guard above
    const status = await pollContainerReady(containerId, token, maxPolls, intervalMs);
    if (status === "IN_PROGRESS") break; // try again next cycle
    if (status === "ERROR") {
      seg.container_id = null;
      await setSegmentField(db, postId, i, "container_id", null);
      throw new Error(`Story segment ${i + 1} falhou no processamento do Instagram`);
    }
    const result = await publishContainer(igUserId, token, containerId);
    seg.media_id = result.id;
    await setSegmentField(db, postId, i, "media_id", result.id);
  }

  const allDone = segments.length > 0 && segments.every((s) => !!s.media_id);
  return { segments, allDone };
}

export interface ContainerCreationResult {
  containerId: string;
  /**
   * For a single-video post where a cover was applied, the *video* URL — so the
   * caller can rebuild the container WITHOUT the cover on ERROR (Instagram can
   * reject an unprocessable cover during async processing). Undefined otherwise.
   */
  coverVideoUrl?: string;
}

/**
 * Build the Instagram media container for a post and return its id. The caller
 * decides cover policy via `useCover` and owns persistence + any cover-retry:
 *   - publish-now passes useCover:true and does an IMMEDIATE coverless retry.
 *   - cron Phase 1 / schedule pass useCover:(retry_count === 0); the coverless
 *     retry is DEFERRED to a later cron cycle (where retry_count > 0).
 * Throws on no media or any Graph API error (callers mark the post failed).
 */
export async function createContainerForPost(
  db: DbClient,
  opts: { igUserId: string; token: string; postId: number; caption: string; useCover: boolean; tipo?: string },
): Promise<ContainerCreationResult> {
  const { igUserId, token, postId, caption, useCover, tipo } = opts;
  const media = await fetchPostMedia(db, postId);

  if (tipo === "stories") {
    if (media.length !== 1) throw new Error("Stories require exactly one media file");

    const url = await signGetUrl(media[0].r2_key, 7200);
    const container = media[0].kind === "video"
      ? await createStoryVideoContainer(igUserId, token, url)
      : await createStoryImageContainer(igUserId, token, url);
    return { containerId: container.id };
  }

  if (media.length === 0) throw new Error("No media files found");
  if (media.length > CAROUSEL_MAX_ITEMS) {
    throw new Error(
      `Carrossel do Instagram aceita no máximo ${CAROUSEL_MAX_ITEMS} itens ` +
        `(este post tem ${media.length}). Reduza para ${CAROUSEL_MAX_ITEMS} ou menos. ` +
        `O app do Instagram permite 20, mas a publicação via API é limitada a ${CAROUSEL_MAX_ITEMS}.`,
    );
  }

  const isCarousel = media.length > 1;
  const isSingleVideo = media.length === 1 && media[0].kind === "video";

  if (isCarousel) {
    const childIds: string[] = [];
    for (const m of media) {
      const url = await signGetUrl(m.r2_key, 7200);
      const child = await createCarouselChildContainer(igUserId, token, url, m.kind === "video");
      childIds.push(child.id);
    }
    const parent = await createCarouselParentContainer(igUserId, token, childIds, caption);
    return { containerId: parent.id };
  }

  if (isSingleVideo) {
    const url = await signGetUrl(media[0].r2_key, 7200);
    const thumbKey = useCover ? media[0].thumbnail_r2_key : null;
    const coverUrl = thumbKey ? await signGetUrl(thumbKey, 7200) : undefined;
    const container = await createVideoContainer(igUserId, token, url, caption, coverUrl);
    return { containerId: container.id, coverVideoUrl: coverUrl ? url : undefined };
  }

  const url = await signGetUrl(media[0].r2_key, 7200);
  const container = await createSingleImageContainer(igUserId, token, url, caption);
  return { containerId: container.id };
}

export async function checkContainerStatus(
  containerId: string,
  token: string,
): Promise<"FINISHED" | "IN_PROGRESS" | "ERROR"> {
  const res = await fetch(
    `${GRAPH_BASE}/${containerId}?fields=status_code&access_token=${token}`,
  );
  const data = await res.json();
  if (data.error) throwGraphError(data);
  return data.status_code ?? "FINISHED";
}

export async function pollContainerReady(
  containerId: string,
  token: string,
  maxPolls = 25,
  intervalMs = 5000,
): Promise<"FINISHED" | "IN_PROGRESS" | "ERROR"> {
  for (let i = 0; i < maxPolls; i++) {
    const status = await checkContainerStatus(containerId, token);
    if (status !== "IN_PROGRESS") return status;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return "IN_PROGRESS";
}

export async function publishContainer(
  igUserId: string,
  token: string,
  containerId: string,
): Promise<{ id: string }> {
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: containerId, access_token: token }),
  });
  const data = await res.json();
  if (data.error) throwGraphError(data);
  return { id: data.id };
}

export async function fetchPermalink(
  mediaId: string,
  token: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${GRAPH_BASE}/${mediaId}?fields=permalink&access_token=${token}`,
    );
    const data = await res.json();
    return data.permalink ?? null;
  } catch {
    return null;
  }
}

// --- Presigned URL Generation ---

export async function generatePresignedUrls(
  media: MediaFile[],
): Promise<Map<number, string>> {
  const urls = new Map<number, string>();
  for (const f of media) {
    const url = await signGetUrl(f.r2_key, 7200);
    urls.set(f.id, url);
  }
  return urls;
}

// --- Batch Processor ---

export async function processBatch<T>(
  items: T[],
  batchSize: number,
  delayMs: number,
  fn: (item: T) => Promise<void>,
): Promise<{ succeeded: number; failed: number; errors: Array<{ item: T; error: string }> }> {
  let succeeded = 0;
  let failed = 0;
  const errors: Array<{ item: T; error: string }> = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(fn));
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === "fulfilled") {
        succeeded++;
      } else {
        failed++;
        errors.push({
          item: batch[j],
          error: (results[j] as PromiseRejectedResult).reason?.message ?? "Unknown error",
        });
      }
    }
    if (i + batchSize < items.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return { succeeded, failed, errors };
}
