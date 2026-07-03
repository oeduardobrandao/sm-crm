// GET get-or-create (docs/estudio-design.md §5.4) — TanStack Query wrapper around
// `post-design-manage`. This is the ONLY read path for a design doc; `store/postDesigns.ts`'s
// direct RLS select (slice 4, T4.3) is a separate, cheaper "does a design exist" summary query,
// not a substitute for this one.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { DesignDoc } from '../types';

export interface RenderPageInfo {
  page_id: string;
  file_id: number;
  preview_url: string;
  w: number;
  h: number;
}

export interface PostDesignQueryResult {
  design: DesignDoc;
  rev: number;
  render: { status: string; pages: RenderPageInfo[] };
}

/** Structured error mirroring post-design-manage's JSON error envelope, so callers can branch on
 * `.code` (e.g. `post_not_editable`, `unsupported_post_tipo`, `feature_disabled`) instead of
 * parsing message strings. */
export class PostDesignError extends Error {
  code: string;
  status: number;
  detail: unknown;

  constructor(code: string, status: number, detail: unknown) {
    super(code);
    this.name = 'PostDesignError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

async function fetchPostDesign(postId: number): Promise<PostDesignQueryResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new PostDesignError('unauthorized', 401, null);

  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const res = await fetch(`${url}/functions/v1/post-design-manage?post_id=${postId}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : 'unknown_error';
    throw new PostDesignError(code, res.status, body);
  }
  return body as PostDesignQueryResult;
}

export function postDesignQueryKey(postId: number | undefined) {
  return ['post-design', postId] as const;
}

export function usePostDesignQuery(postId: number | undefined) {
  return useQuery({
    queryKey: postDesignQueryKey(postId),
    queryFn: () => fetchPostDesign(postId!),
    enabled: postId !== undefined && !Number.isNaN(postId),
    staleTime: 0, // rev-guarded saves need a fresh rev; this hook's own cache is not the source of truth for edits
    retry: false, // structured 4xx errors (post_not_editable, unsupported_post_tipo, ...) are not transient
  });
}
