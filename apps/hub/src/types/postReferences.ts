/**
 * Hub copy of the ReferenceItem contract (supabase/functions/_shared/post-references.ts).
 * The Hub cannot import Deno modules, so the shapes are re-declared; keep them in sync.
 * Lives under src/types/ next to src/types.ts: `'../types'` still resolves to types.ts.
 */
export type ReferenceFileKind = 'image' | 'video' | 'document';

export interface ReferenceItem {
  id: number;
  kind: 'file' | 'link';
  file_kind: ReferenceFileKind | null;
  name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  /** Signed GET URL of the file (1h). Null for links. */
  url: string | null;
  thumbnail_url: string | null;
  blur_data_url: string | null;
  /** CRM only; always null in the Hub. */
  download_url: string | null;
  link_url: string | null;
  link_title: string | null;
  link_domain: string | null;
  note: string | null;
  post_approval_id: number | null;
  created_at: string;
  can_remove: boolean;
}

export type ReferenceErrorCode =
  | 'unsupported_type'
  | 'too_large'
  | 'thumbnail_invalid'
  | 'reference_limit'
  | 'quota_exceeded'
  | 'post_not_pending'
  | 'invalid_url'
  | 'invalid_note'
  | 'not_found'
  | 'locked'
  | 'rate_limited'
  | 'upload_mismatch'
  | 'internal';
