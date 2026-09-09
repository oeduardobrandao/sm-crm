import { supabase } from '../lib/supabase';
import type { PostMedia } from '../store/posts';
import { uploadFile, type UploadProgress } from './fileService';

/** Upload a separate file, preserving both the original and its links in other posts. */
export async function replacePostMedia(
  media: PostMedia,
  file: File,
  thumbnail: File | undefined,
  onProgress?: (progress: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Sua sessão expirou. Entre novamente para salvar o ajuste.');

  const uploaded = await uploadFile({
    file,
    folderId: null,
    thumbnail,
    onProgress,
    ...(signal ? { signal } : {}),
  });
  signal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/post-media-manage/${media.id}/replace`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file_id: uploaded.id, expected_r2_key: media.r2_key }),
        signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
      },
    );
  } catch {
    // A lost response can follow a committed transaction. Deleting the uploaded file
    // here could delete the post's new media; keep it and let a reload reconcile.
    throw new Error(
      'Não foi possível confirmar o ajuste. Recarregue o post antes de tentar novamente.',
    );
  }
  if (response.status === 409) {
    throw new Error('A mídia mudou ou o post não permite mais ajustes. Recarregue o post.');
  }
  if (!response.ok) throw new Error('Não foi possível salvar o ajuste.');
  const result = await response.json().catch(() => null);
  if (result?.ok !== true) {
    throw new Error(
      'Não foi possível confirmar o ajuste. Recarregue o post antes de tentar novamente.',
    );
  }
}
