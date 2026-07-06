// Blob-URL resolution for file ids (brand-logo thumbnails etc.). Extracted from the v1
// Estúdio editor's useImageUrls when the editor UI was removed (Estúdio v2) — HubTab's brand
// kit still needs exactly this: files-table lookup -> sign-r2-urls -> blob URL with the
// byte-proxy fallback (R2 bucket CORS only covers prod origins).
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// file bytes are immutable per file_id, so a blob URL made once is valid all session.
const blobUrls = new Map<number, string>();

// Module-scope seed of file_id → freshly-signed URL. A just-generated AI image (T6.4) or any
// upload that already carries a valid signed URL primes this so the very next render skips
// the files-table + sign-r2-urls round trip (no flash). Seeds are only a *candidate* fast
// path: if fetching one fails (CORS, expiry), resolution falls through to the normal route.
const seededUrls = new Map<number, string>();

/** Seed a file's signed URL so the doc-wide render finds it immediately (see above). */
export function seedImageUrl(fileId: number, url: string): void {
  seededUrls.set(fileId, url);
}

/** Test-only: module caches survive between tests otherwise. */
export function clearImageUrlCachesForTest(): void {
  blobUrls.clear();
  seededUrls.clear();
}

async function fetchAsBlobUrl(url: string, init?: RequestInit): Promise<string | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    return URL.createObjectURL(await res.blob());
  } catch {
    // TypeError here is the CORS/offline case — the caller decides the fallback.
    return null;
  }
}

export async function resolveImageUrls(fileIds: number[]): Promise<Map<number, string>> {
  if (fileIds.length === 0) return new Map();

  const map = new Map<number, string>();
  let pending: number[] = [];
  for (const id of fileIds) {
    const cached = blobUrls.get(id);
    if (cached) map.set(id, cached);
    else pending.push(id);
  }
  if (pending.length === 0) return map;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('not authenticated');
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;

  // Seeded fast path: one direct fetch, no table/sign round trips. Failures fall through.
  const seeded = pending.filter((id) => seededUrls.has(id));
  if (seeded.length > 0) {
    await Promise.all(
      seeded.map(async (id) => {
        const blobUrl = await fetchAsBlobUrl(seededUrls.get(id)!);
        if (blobUrl) {
          blobUrls.set(id, blobUrl);
          map.set(id, blobUrl);
        }
      }),
    );
    pending = pending.filter((id) => !map.has(id));
    if (pending.length === 0) return map;
  }

  const { data: files, error } = await supabase
    .from('files')
    .select('id, r2_key')
    .in('id', pending);
  if (error) throw error;
  if (!files || files.length === 0) return map;

  const res = await fetch(`${supabaseUrl}/functions/v1/sign-r2-urls`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ keys: files.map((f) => f.r2_key) }),
  });
  if (!res.ok) throw new Error(`sign-r2-urls failed: ${res.status}`);
  const { urls } = (await res.json()) as { urls: Record<string, string> };

  await Promise.all(
    files.map(async (file: { id: number; r2_key: string }) => {
      const signed = urls[file.r2_key];
      // Direct first (free on origins the bucket allows), byte-proxy as the universal fallback.
      let blobUrl = signed ? await fetchAsBlobUrl(signed) : null;
      if (!blobUrl) {
        blobUrl = await fetchAsBlobUrl(
          `${supabaseUrl}/functions/v1/sign-r2-urls?key=${encodeURIComponent(file.r2_key)}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        );
      }
      if (blobUrl) {
        blobUrls.set(file.id, blobUrl);
        map.set(file.id, blobUrl);
      }
    }),
  );
  return map;
}

/** Display URL for ONE file id (e.g. the brand-logo thumbnail) — same resolution as the
 * doc-wide hook below. Blob URLs never expire, hence the infinite staleTime. */
export function useFileUrl(fileId: number | null | undefined) {
  return useQuery({
    queryKey: ['estudio-file-url', fileId],
    queryFn: async () => (await resolveImageUrls([fileId!])).get(fileId!) ?? null,
    enabled: typeof fileId === 'number',
    staleTime: Infinity,
    retry: false,
  });
}
