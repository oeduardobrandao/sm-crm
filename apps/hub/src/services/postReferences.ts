import { trackUnsavedWork } from '@mesaas/app-lifecycle';
import type { ReferenceErrorCode, ReferenceFileKind, ReferenceItem } from '../types/postReferences';
import { prepareReferenceMedia, type ReferenceMedia } from './referenceMedia';

const BASE = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const FN = 'hub-post-references';
const MB = 1024 * 1024;

/** Mirrors REFERENCE_MIME in supabase/functions/_shared/post-references.ts (the server decides). */
export const REFERENCE_MIME: Readonly<
  Record<string, { kind: ReferenceFileKind; maxBytes: number }>
> = {
  'image/jpeg': { kind: 'image', maxBytes: 25 * MB },
  'image/png': { kind: 'image', maxBytes: 25 * MB },
  'image/webp': { kind: 'image', maxBytes: 25 * MB },
  'image/gif': { kind: 'image', maxBytes: 25 * MB },
  'application/pdf': { kind: 'document', maxBytes: 25 * MB },
  'video/mp4': { kind: 'video', maxBytes: 200 * MB },
  'video/quicktime': { kind: 'video', maxBytes: 200 * MB },
  'video/webm': { kind: 'video', maxBytes: 200 * MB },
};

/** Some Android pickers hand over an empty File.type: fall back to the extension. */
const EXTENSION_MIME: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

export const REFERENCE_ACCEPT = Object.keys(REFERENCE_MIME).join(',');
export const MAX_REFERENCES_PER_POST = 10;
export const MAX_REFERENCE_NOTE = 500;
export const MAX_REFERENCE_LINK_TITLE = 120;
export const MAX_REFERENCE_URL = 2048;
/** 200 MB at 1 Mbps is about 27 minutes: past trackUnsavedWork's 30-minute default ceiling. */
const VIDEO_UPLOAD_HOLD_MS = 60 * 60_000;

const ERROR_CODES: ReadonlySet<string> = new Set<ReferenceErrorCode>([
  'unsupported_type',
  'too_large',
  'thumbnail_invalid',
  'reference_limit',
  'quota_exceeded',
  'post_not_pending',
  'invalid_url',
  'invalid_note',
  'not_found',
  'locked',
  'rate_limited',
  'upload_mismatch',
  'internal',
]);

export class PostReferenceError extends Error {
  readonly code: ReferenceErrorCode;
  constructor(code: ReferenceErrorCode) {
    super(code);
    this.name = 'PostReferenceError';
    this.code = code;
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
  );
}

function abortError(): DOMException {
  return new DOMException('Upload cancelled', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

/** The MIME the server will see for this file, or null when it is not an accepted type. */
export function referenceMime(file: File): string | null {
  if (file.type) return REFERENCE_MIME[file.type] ? file.type : null;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MIME[ext] ?? null;
}

export function referenceFileKind(file: File): ReferenceFileKind | null {
  const mime = referenceMime(file);
  return mime ? REFERENCE_MIME[mime].kind : null;
}

/** Client-side mirror of the server's type and size checks. */
export function validateReferenceFile(file: File): ReferenceErrorCode | null {
  const mime = referenceMime(file);
  if (!mime || file.size <= 0) return 'unsupported_type';
  return file.size > REFERENCE_MIME[mime].maxBytes ? 'too_large' : null;
}

function hasControlOrSpace(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || /\s/u.test(ch)) return true;
  }
  return false;
}

/**
 * Same policy as hub-post-references POST /links (the server is authoritative): trim, add
 * https:// when there is no scheme, no whitespace or control characters, absolute http(s) URL,
 * no credentials, non-empty host, at most 2048 characters.
 */
export function normalizeReferenceUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || hasControlOrSpace(trimmed)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (candidate.length > MAX_REFERENCE_URL) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || !url.hostname) return null;
  // Same value the server stores (url.href), so the preview matches the saved link.
  return url.href;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** One request to hub-post-references. Errors are always PostReferenceError (or an AbortError). */
async function call<T>(
  method: Method,
  path: string,
  opts: { query?: Record<string, string>; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const url = new URL(`${BASE}/functions/v1/${FN}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers:
        opts.body === undefined
          ? { apikey: ANON }
          : { 'Content-Type': 'application/json', apikey: ANON },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new PostReferenceError('internal');
  }
  if (res.ok) return (await res.json()) as T;
  if (res.status === 429) throw new PostReferenceError('rate_limited');
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  const code =
    typeof body.error === 'string' && ERROR_CODES.has(body.error)
      ? (body.error as ReferenceErrorCode)
      : 'internal';
  throw new PostReferenceError(code);
}

export function fetchPostReferences(
  token: string,
  postId: number,
): Promise<{ can_add: boolean; items: ReferenceItem[] }> {
  return call('GET', '', { query: { token, post_id: String(postId) } });
}

/** XHR PUT straight to R2 with upload progress and abort. */
function putWithProgress(
  url: string,
  body: Blob,
  contentType: string,
  opts: { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const { onProgress, signal } = opts;
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const settle = (fn: () => void) => {
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
    }
    xhr.onload = () =>
      settle(() =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new PostReferenceError('internal')),
      );
    xhr.onerror = () => settle(() => reject(new PostReferenceError('internal')));
    xhr.onabort = () => settle(() => reject(abortError()));
    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.send(body);
  });
}

interface PresignResponse {
  upload_url: string;
  r2_key: string;
  thumbnail_upload_url: string | null;
  thumbnail_r2_key: string | null;
}

interface UploadOptions {
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
  note?: string;
}

/**
 * Validate, build the poster/thumbnail, presign, PUT (with progress, abortable), finalize.
 * Every call presigns afresh, so a retry after a failed PUT never reuses an expired URL.
 * The promise holds the unsaved-work registry: a silent version swap must not cut an upload.
 */
export function uploadPostReference(
  token: string,
  postId: number,
  file: File,
  opts: UploadOptions = {},
): Promise<ReferenceItem> {
  const isVideo = referenceFileKind(file) === 'video';
  return trackUnsavedWork(
    uploadUnguarded(token, postId, file, opts),
    isVideo ? VIDEO_UPLOAD_HOLD_MS : undefined,
  );
}

async function uploadUnguarded(
  token: string,
  postId: number,
  file: File,
  { onProgress, signal, note }: UploadOptions,
): Promise<ReferenceItem> {
  const invalid = validateReferenceFile(file);
  if (invalid) throw new PostReferenceError(invalid);
  const mime = referenceMime(file) as string;
  const kind = REFERENCE_MIME[mime].kind;
  throwIfAborted(signal);

  let media: ReferenceMedia;
  try {
    media = await prepareReferenceMedia(file, kind);
  } catch {
    throw new PostReferenceError('internal');
  }
  throwIfAborted(signal);

  const thumb = media.thumbnail;
  const signed = await call<PresignResponse>('POST', '/upload-url', {
    body: {
      token,
      post_id: postId,
      filename: file.name,
      mime_type: mime,
      size_bytes: file.size,
      ...(thumb ? { thumbnail: { mime_type: 'image/webp', size_bytes: thumb.size } } : {}),
    },
    signal,
  });
  if (thumb && (!signed.thumbnail_upload_url || !signed.thumbnail_r2_key)) {
    throw new PostReferenceError('internal');
  }

  onProgress?.(0, file.size);
  await Promise.all([
    putWithProgress(signed.upload_url, file, mime, { onProgress, signal }),
    thumb && signed.thumbnail_upload_url
      ? putWithProgress(signed.thumbnail_upload_url, thumb, 'image/webp', { signal })
      : Promise.resolve(),
  ]);
  throwIfAborted(signal);

  // R2 keys go back exactly as /upload-url returned them (the server checks their shape). PDFs
  // send no thumbnail fields at all: any value there, even 0, is 400 thumbnail_invalid.
  // Finalize answers 201 {item}; `call` checks res.ok, never a literal 200.
  // Finalize is not abortable: once the objects are in R2, a half-sent finalize could still
  // create the row, so a cancel from here on lets it finish (the hook keeps the item).
  const trimmedNote = note?.trim();
  const { item } = await call<{ item: ReferenceItem }>('POST', '/files', {
    body: {
      token,
      post_id: postId,
      r2_key: signed.r2_key,
      ...(thumb && signed.thumbnail_r2_key
        ? { thumbnail_r2_key: signed.thumbnail_r2_key, thumbnail_bytes: thumb.size }
        : {}),
      mime_type: mime,
      size_bytes: file.size,
      name: file.name,
      // The server takes JSON null for every absent optional field.
      width: media.width ?? null,
      height: media.height ?? null,
      duration_seconds: media.durationSeconds ?? null,
      blur_data_url: media.blurDataUrl ?? null,
      note: trimmedNote || null,
    },
  });
  return item;
}

export function addPostReferenceLink(
  token: string,
  postId: number,
  input: { url: string; title?: string; note?: string },
): Promise<ReferenceItem> {
  const url = normalizeReferenceUrl(input.url);
  if (!url) return Promise.reject(new PostReferenceError('invalid_url'));
  const title = input.title?.trim().slice(0, MAX_REFERENCE_LINK_TITLE);
  const note = input.note?.trim();
  if (note && note.length > MAX_REFERENCE_NOTE) {
    return Promise.reject(new PostReferenceError('invalid_note'));
  }
  return trackUnsavedWork(
    call<{ item: ReferenceItem }>('POST', '/links', {
      body: {
        token,
        post_id: postId,
        url,
        ...(title ? { title } : {}),
        ...(note ? { note } : {}),
      },
    }).then((r) => r.item),
  );
}

/** An empty note clears it (the server stores NULL). */
export function updatePostReferenceNote(
  token: string,
  id: number,
  note: string,
): Promise<ReferenceItem> {
  const trimmed = note.trim();
  if (trimmed.length > MAX_REFERENCE_NOTE) {
    return Promise.reject(new PostReferenceError('invalid_note'));
  }
  return trackUnsavedWork(
    call<{ item: ReferenceItem }>('PATCH', `/${id}`, { body: { token, note: trimmed } }).then(
      (r) => r.item,
    ),
  );
}

export async function removePostReference(token: string, id: number): Promise<void> {
  await trackUnsavedWork(call<{ ok: true }>('DELETE', `/${id}`, { query: { token } }));
}
