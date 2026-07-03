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

/** Strips the two normalization-OUTPUT keys (`canvas`, `fileIds`) the authoring schema's
 * `.strict()` rejects as unknown input — a doc read from GET (or the local state built from it)
 * always carries both, so PUTting it back verbatim would 400 with `unrecognized_keys`. */
export function toPutPayloadDoc(doc: DesignDoc): Omit<DesignDoc, 'canvas' | 'fileIds'> {
  const { canvas: _canvas, fileIds: _fileIds, ...payload } = doc;
  return payload;
}

/** PUT the doc with optimistic concurrency (§5.4). Resolves with the server-normalized doc, the
 * new rev, and non-fatal validation warnings. Rejects with PostDesignError — notably
 * `rev_conflict` (409, `.detail.current_rev`) when another writer (MCP agent, second tab) saved
 * first; the autosave protocol pauses on that one instead of retrying. */
export async function savePostDesign(
  postId: number,
  doc: DesignDoc,
  expectedRev: number,
): Promise<{ design: DesignDoc; rev: number; warnings: unknown[] }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new PostDesignError('unauthorized', 401, null);

  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const res = await fetch(`${url}/functions/v1/post-design-manage`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ post_id: postId, doc: toPutPayloadDoc(doc), expected_rev: expectedRev }),
  });

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : 'unknown_error';
    throw new PostDesignError(code, res.status, body);
  }
  return body as { design: DesignDoc; rev: number; warnings: unknown[] };
}

/** POST /brand-logo (§5.4, T3.2): server-side, SSRF-hardened import of the client's
 * hub_brand.logo_url into a real `files` row. Idempotent — an already-materialized logo returns
 * its id. A `reason` (never both) means the import couldn't happen for an EXPECTED cause
 * (no/invalid URL, blocked address, too large, quota, …) — the caller translates it; hard
 * failures reject with PostDesignError like every other route. */
export async function importBrandLogo(
  clienteId: number,
): Promise<{ logo_file_id: number | null; reason?: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new PostDesignError('unauthorized', 401, null);

  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const res = await fetch(`${url}/functions/v1/post-design-manage/brand-logo`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ cliente_id: clienteId }),
  });

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : 'unknown_error';
    throw new PostDesignError(code, res.status, body);
  }
  return body as { logo_file_id: number | null; reason?: string };
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
