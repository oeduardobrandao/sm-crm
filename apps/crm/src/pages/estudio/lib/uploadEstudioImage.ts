// T2.9 (docs/estudio-plan.md lines 141-158): thin wrapper around the existing
// `uploadFile()` 3-step flow (presign -> PUT to R2 -> finalize) from
// `@/services/fileService`, scoped for Estúdio's canvas-image inserts.
//
// Estúdio uploads are workspace-level, NOT post-scoped: we always pass `folderId: null`
// (lands the file at the workspace's file-tree root — confirmed via
// file-upload-finalize/handler.ts's `let folderId = body.folder_id ?? null`, there is no
// other default folder) and NEVER a `postId`.
//
// The 20MB / MIME allowlist below is fast-fail client-side UX only, not a security
// boundary — file-upload-url/handler.ts re-validates MIME + a much larger 400MB cap
// server-side regardless. A design-canvas image has no legitimate business being anywhere
// near 400MB, so we fail fast with a friendlier Portuguese message instead of making the
// user wait through a slow upload that the server would reject anyway.
import { uploadFile } from '@/services/fileService';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB — see module doc comment above.

// Fallback used when the resolved FileRecord comes back with null width/height (rare
// legacy-file edge case per T2.9's spec) — an arbitrary but documented square default so
// callers always get usable numeric dimensions instead of having to null-check downstream.
const FALLBACK_IMAGE_DIMENSION = 800;

export interface UploadedEstudioImage {
  file_id: number;
  width: number;
  height: number;
}

function validateImageFile(file: File): void {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(`Tipo de arquivo não suportado: ${file.type || 'desconhecido'}`);
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error('Imagem maior que 20 MB');
  }
}

/** Uploads a single image file for use as an Estúdio canvas layer (or page background).
 * Validates MIME + size client-side, then delegates to the shared `uploadFile()` flow with
 * `folderId: null` and no `postId`. Resolves to the numeric `file_id` design-doc layers use,
 * plus width/height (falling back to a square default if the server returned nulls). */
export async function uploadEstudioImage(file: File): Promise<UploadedEstudioImage> {
  validateImageFile(file);

  const record = await uploadFile({ file, folderId: null });

  return {
    file_id: record.id,
    width: record.width ?? FALLBACK_IMAGE_DIMENSION,
    height: record.height ?? FALLBACK_IMAGE_DIMENSION,
  };
}
