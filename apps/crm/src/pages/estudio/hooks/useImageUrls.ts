// Resolves a design doc's referenced `file_id`s to browser-displayable signed URLs, for
// satori's `resolveImageSrc` callback (§6.3) — background images + image layers. Two round
// trips: `files` table (RLS-scoped, same as every other CRM page that reads r2_key) for the
// tenant's own r2_key per id, then the existing `sign-r2-urls` edge function (already used
// elsewhere in the app) to turn those keys into 1h-signed URLs in one batched call.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { collectDocFileIds } from '../lib/imageResolution';
import type { DesignDoc } from '../types';

export async function resolveImageUrls(fileIds: number[]): Promise<Map<number, string>> {
  if (fileIds.length === 0) return new Map();

  const { data: files, error } = await supabase
    .from('files')
    .select('id, r2_key')
    .in('id', fileIds);
  if (error) throw error;
  if (!files || files.length === 0) return new Map();

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('not authenticated');

  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const res = await fetch(`${url}/functions/v1/sign-r2-urls`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ keys: files.map((f) => f.r2_key) }),
  });
  if (!res.ok) throw new Error(`sign-r2-urls failed: ${res.status}`);
  const { urls } = (await res.json()) as { urls: Record<string, string> };

  const map = new Map<number, string>();
  for (const file of files) {
    const signed = urls[file.r2_key];
    if (signed) map.set(file.id, signed);
  }
  return map;
}

/** Signed display URL for ONE file id (e.g. the brand-logo thumbnail) — same two-step
 * resolution as the doc-wide hook below, same expiry-safe staleTime. */
export function useFileUrl(fileId: number | null | undefined) {
  return useQuery({
    queryKey: ['estudio-file-url', fileId],
    queryFn: async () => (await resolveImageUrls([fileId!])).get(fileId!) ?? null,
    enabled: typeof fileId === 'number',
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
}

export function useImageUrls(doc: DesignDoc | undefined) {
  const fileIds = doc ? collectDocFileIds(doc) : [];
  const queryKey = [...fileIds].sort((a, b) => a - b).join(',');

  return useQuery({
    queryKey: ['estudio-image-urls', queryKey],
    queryFn: () => resolveImageUrls(fileIds),
    enabled: !!doc,
    staleTime: 30 * 60 * 1000, // well under the 1h signed-URL expiry
    retry: false,
  });
}
