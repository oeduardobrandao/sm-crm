import { signGetUrl } from "./r2.ts";

// --- Token Decryption (duplicated across functions; centralized here) ---

const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ??
  (() => { throw new Error("TOKEN_ENCRYPTION_KEY required"); })();

async function getEncryptionKey(purpose: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw", enc.encode(TOKEN_ENCRYPTION_KEY), { name: "HKDF" }, false, ["deriveKey"]
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
    enc.encode(TOKEN_ENCRYPTION_KEY.padEnd(32, "0").slice(0, 32)),
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

const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg"]);
const ALLOWED_VIDEO_MIMES = new Set(["video/mp4", "video/quicktime"]);
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const VIDEO_MAX_BYTES = 250 * 1024 * 1024;
const IMAGE_MIN_DIM = 320;
const IMAGE_AR_MIN = 4 / 5;
const IMAGE_AR_MAX = 1.91;
const VIDEO_AR_MIN = 9 / 16;
const VIDEO_AR_MAX = 1.25;
const VIDEO_MIN_DURATION = 3;
const VIDEO_MAX_DURATION = 90;

export function validateMedia(files: MediaFile[]): ValidationError[] {
  const errors: ValidationError[] = [];
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
        if (ar < IMAGE_AR_MIN || ar > IMAGE_AR_MAX) {
          errors.push({ file_id: f.id, message: "Proporção da imagem fora do permitido (4:5 a 1.91:1)" });
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
        if (f.duration_seconds < VIDEO_MIN_DURATION || f.duration_seconds > VIDEO_MAX_DURATION) {
          errors.push({ file_id: f.id, message: "Duração do vídeo fora do permitido (3–90 segundos)" });
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
): Promise<ScheduleValidationResult> {
  const errors: string[] = [];

  const { data: post } = await db
    .from("workflow_posts")
    .select("id, scheduled_at, ig_caption, workflow_id")
    .eq("id", postId)
    .single();
  if (!post) return { ok: false, errors: ["Post não encontrado."] };

  if (!post.scheduled_at) errors.push("Data de publicação não definida.");
  if (!post.ig_caption?.trim()) errors.push("Legenda do Instagram não definida.");

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
    const mediaErrors = validateMedia(mediaFiles);
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
    if (account.authorization_status === "revoked") {
      errors.push("Token do Instagram foi revogado. Reconecte a conta.");
    }
    if (account.token_expires_at && new Date(account.token_expires_at) < new Date()) {
      errors.push("Token do Instagram expirou. Reconecte a conta.");
    }
    if (errors.length === 0 && account.encrypted_access_token) {
      try {
        const token = await decryptToken(account.encrypted_access_token);
        const permRes = await fetch(
          `https://graph.instagram.com/me/permissions?access_token=${token}`,
        );
        const permData = await permRes.json();
        const granted = new Set(
          (permData.data ?? [])
            .filter((p: any) => p.status === "granted")
            .map((p: any) => p.permission),
        );
        if (!granted.has("instagram_business_content_publish")) {
          errors.push("Conta Instagram precisa ser reconectada com permissão de publicação.");
        }
      } catch {
        errors.push("Erro ao verificar permissões do Instagram.");
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

const GRAPH_BASE = "https://graph.instagram.com";

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
  if (data.error) throw new Error(data.error.message);
  return { id: data.id };
}

export async function createVideoContainer(
  igUserId: string,
  token: string,
  videoUrl: string,
  caption: string,
): Promise<{ id: string }> {
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      video_url: videoUrl, caption, media_type: "REELS", access_token: token,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
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
  if (data.error) throw new Error(data.error.message);
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
  if (data.error) throw new Error(data.error.message);
  return { id: data.id };
}

export async function checkContainerStatus(
  containerId: string,
  token: string,
): Promise<"FINISHED" | "IN_PROGRESS" | "ERROR"> {
  const res = await fetch(
    `${GRAPH_BASE}/${containerId}?fields=status_code&access_token=${token}`,
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
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
  if (data.error) throw new Error(data.error.message);
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
