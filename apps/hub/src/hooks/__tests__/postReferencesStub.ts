import { vi } from 'vitest';
import type { PostReferencesState } from '../usePostReferences';
import type { ReferenceItem } from '../../types/postReferences';

export function makeReferenceItem(id: number, over: Partial<ReferenceItem> = {}): ReferenceItem {
  return {
    id,
    kind: 'file',
    file_kind: 'image',
    name: `f${id}.jpg`,
    mime_type: 'image/jpeg',
    size_bytes: 2_516_582,
    duration_seconds: null,
    width: 1080,
    height: 1350,
    url: `https://r2/get/${id}`,
    thumbnail_url: `https://r2/thumb/${id}`,
    blur_data_url: null,
    download_url: null,
    link_url: null,
    link_title: null,
    link_domain: null,
    note: null,
    post_approval_id: null,
    created_at: '2026-10-08T12:00:00.000Z',
    can_remove: true,
    ...over,
  };
}

/** A settled usePostReferences result; override any field. Defaults: nothing to add, empty. */
export function makePostReferencesStub(
  over: Partial<PostReferencesState> = {},
): PostReferencesState {
  const items = over.items ?? [];
  const canAdd = over.canAdd ?? false;
  return {
    data: { can_add: canAdd, items },
    isLoading: false,
    canAdd,
    items,
    uploads: [],
    uploadsInFlight: false,
    freshIds: [],
    startUploads: vi.fn(async () => []),
    cancelUpload: vi.fn(),
    retryUpload: vi.fn(),
    addLink: vi.fn(),
    updateNote: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    refresh: vi.fn(),
    ...over,
  };
}
