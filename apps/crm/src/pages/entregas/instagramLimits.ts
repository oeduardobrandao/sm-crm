// Espelho de supabase/functions/_shared/instagram-limits.ts para o preflight
// do front. O teste de paridade em __tests__/instagramLimits.test.ts importa
// os dois arquivos e falha se divergirem. Alterou lá? Altere aqui.

export interface PostMediaLike {
  id: number;
  kind: "image" | "video";
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
}

export interface ValidationError {
  file_id: number;
  message: string;
}

export const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const ALLOWED_VIDEO_MIMES = new Set(["video/mp4", "video/quicktime"]);
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 250 * 1024 * 1024;
export const IMAGE_MIN_DIM = 320;
export const IMAGE_AR_MIN = 3 / 4;
export const STORY_IMAGE_AR_MIN = 9 / 16;
export const IMAGE_AR_MAX = 1.91;
export const VIDEO_AR_MIN = 9 / 16;
export const VIDEO_AR_MAX = 1.25;
export const VIDEO_MIN_DURATION = 3;
export const VIDEO_MAX_DURATION = 90;
export const STORY_VIDEO_MAX_DURATION = 60;

/** Instagram Content Publishing API caps carousels at 10 items.
 *  (The native app allows 20, but the Graph API does not.) Stories are exempt
 *  — they publish as sequential segments, not a single carousel container. */
export const CAROUSEL_MAX_ITEMS = 10;

export function validateMedia(
  files: PostMediaLike[],
  opts?: { forStories?: boolean },
): ValidationError[] {
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

/** Preflight do front: retorna as mensagens em PT prontas para exibir. */
export function validatePostMedia(
  media: PostMediaLike[],
  opts?: { forStories?: boolean },
): string[] {
  return validateMedia(media, opts).map((e) => e.message);
}
