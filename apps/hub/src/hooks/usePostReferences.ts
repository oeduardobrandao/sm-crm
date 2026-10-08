import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MAX_REFERENCES_PER_POST,
  PostReferenceError,
  addPostReferenceLink,
  fetchPostReferences,
  isAbortError,
  referenceFileKind,
  removePostReference,
  updatePostReferenceNote,
  uploadPostReference,
  validateReferenceFile,
} from '../services/postReferences';
import type { ReferenceErrorCode, ReferenceFileKind, ReferenceItem } from '../types/postReferences';

/** Per post, no token: the contract key. The Hub serves one token per tab. */
export const postReferencesKey = (postId: number) => ['hub-post-references', postId] as const;

const MAX_CONCURRENT_UPLOADS = 2;

/** Where an upload started: the correction composer lists only its own. */
export type UploadSource = 'composer' | 'tab';

export interface UploadEntry {
  localId: string;
  source: UploadSource;
  name: string;
  fileKind: ReferenceFileKind;
  loaded: number;
  total: number;
  status: 'uploading' | 'error';
  error?: ReferenceErrorCode;
}

export interface AddReferenceLinkInput {
  url: string;
  title?: string;
  note?: string;
}

type ReferencesData = { can_add: boolean; items: ReferenceItem[] };

interface Job {
  localId: string;
  file: File;
  settle: (item: ReferenceItem | null) => void;
  onUploaded?: (item: ReferenceItem) => void;
}

let localSeq = 0;
const nextLocalId = () => `reference-upload-${++localSeq}`;

function codeOf(err: unknown): ReferenceErrorCode {
  return err instanceof PostReferenceError ? err.code : 'internal';
}

/**
 * The post's references and every write the Hub makes to them. Called once per post card
 * (PostDetailContent) and passed down to the Referências tab, the correction composer, the
 * history tiles and the footer. Uploads run two at a time; unmounting aborts them.
 *
 * Per-post state (queue, uploads, refs) lives in this instance, so the host must remount it when
 * the post changes: PostDetailDialog does, through `<CardSlot key={post.id}>`.
 */
export function usePostReferences(token: string, postId: number) {
  const qc = useQueryClient();
  const key = useMemo(() => postReferencesKey(postId), [postId]);
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchPostReferences(token, postId),
    staleTime: 30_000,
    enabled: token !== '' && postId > 0,
  });

  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [freshIds, setFreshIds] = useState<number[]>([]);
  const files = useRef(new Map<string, File>());
  /** onUploaded per entry, so a retried composer upload still reaches the composer. */
  const uploadedCallbacks = useRef(new Map<string, (item: ReferenceItem) => void>());
  const controllers = useRef(new Map<string, AbortController>());
  /** Cancelled while running: the entry stays (and counts as in flight) until the call settles. */
  const cancelled = useRef(new Set<string>());
  const queue = useRef<Job[]>([]);
  const active = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const ctl = controllers.current;
    const pending = queue.current;
    return () => {
      mounted.current = false;
      for (const c of ctl.values()) c.abort();
      ctl.clear();
      for (const job of pending.splice(0)) job.settle(null);
    };
  }, []);

  const patchUpload = useCallback((localId: string, patch: Partial<UploadEntry>) => {
    if (!mounted.current) return;
    setUploads((list) => list.map((u) => (u.localId === localId ? { ...u, ...patch } : u)));
  }, []);

  const dropUpload = useCallback((localId: string) => {
    files.current.delete(localId);
    uploadedCallbacks.current.delete(localId);
    controllers.current.delete(localId);
    cancelled.current.delete(localId);
    if (mounted.current) setUploads((list) => list.filter((u) => u.localId !== localId));
  }, []);

  const appendItem = useCallback(
    (item: ReferenceItem) => {
      const old = qc.getQueryData<ReferencesData>(key);
      if (!old) {
        void qc.invalidateQueries({ queryKey: key });
        return;
      }
      if (old.items.some((i) => i.id === item.id)) return;
      const items = [...old.items, item];
      qc.setQueryData<ReferencesData>(key, {
        ...old,
        items,
        can_add: old.can_add && items.length < MAX_REFERENCES_PER_POST,
      });
    },
    [qc, key],
  );

  const replaceItem = useCallback(
    (item: ReferenceItem) => {
      qc.setQueryData<ReferencesData>(key, (old) =>
        old ? { ...old, items: old.items.map((i) => (i.id === item.id ? item : i)) } : old,
      );
    },
    [qc, key],
  );

  // Re-assigned every render so the queue always runs with the current token/post/cache.
  const pump = useRef<() => void>(() => undefined);
  pump.current = () => {
    while (active.current < MAX_CONCURRENT_UPLOADS && queue.current.length > 0) {
      const job = queue.current.shift() as Job;
      const controller = new AbortController();
      controllers.current.set(job.localId, controller);
      active.current += 1;
      uploadPostReference(token, postId, job.file, {
        signal: controller.signal,
        onProgress: (loaded, total) => patchUpload(job.localId, { loaded, total }),
      })
        .then(
          (item) => {
            // Fresh first, so the row mounts with its note field already open.
            if (mounted.current) setFreshIds((ids) => [...ids, item.id]);
            appendItem(item);
            dropUpload(job.localId);
            try {
              job.onUploaded?.(item);
            } catch {
              // A throwing consumer callback must not strand the startUploads promise.
            } finally {
              job.settle(item);
            }
          },
          (err: unknown) => {
            controllers.current.delete(job.localId);
            if (isAbortError(err) || cancelled.current.has(job.localId)) {
              dropUpload(job.localId);
            } else {
              const code = codeOf(err);
              patchUpload(job.localId, { status: 'error', error: code });
              if (code === 'post_not_pending' || code === 'reference_limit') {
                void qc.invalidateQueries({ queryKey: key });
              }
            }
            job.settle(null);
          },
        )
        .finally(() => {
          active.current -= 1;
          pump.current();
        });
    }
  };

  const startUploads = useCallback(
    (
      list: File[],
      opts?: { onUploaded?: (item: ReferenceItem) => void; source?: UploadSource },
    ) => {
      const source = opts?.source ?? 'tab';
      const current = qc.getQueryData<ReferencesData>(key);
      let room =
        MAX_REFERENCES_PER_POST -
        (current?.items.length ?? 0) -
        queue.current.length -
        active.current;
      const entries: UploadEntry[] = [];
      const results: Array<Promise<ReferenceItem | null>> = [];
      for (const file of list) {
        const localId = nextLocalId();
        const fileKind = referenceFileKind(file) ?? 'document';
        const invalid = validateReferenceFile(file) ?? (room <= 0 ? 'reference_limit' : null);
        const base = { localId, source, name: file.name, fileKind, loaded: 0, total: file.size };
        if (invalid) {
          entries.push({ ...base, status: 'error', error: invalid });
          results.push(Promise.resolve(null));
          continue;
        }
        room -= 1;
        files.current.set(localId, file);
        if (opts?.onUploaded) uploadedCallbacks.current.set(localId, opts.onUploaded);
        entries.push({ ...base, status: 'uploading' });
        results.push(
          new Promise<ReferenceItem | null>((settle) =>
            queue.current.push({ localId, file, settle, onUploaded: opts?.onUploaded }),
          ),
        );
      }
      setUploads((prev) => [...prev, ...entries]);
      pump.current();
      return Promise.all(results).then((items) =>
        items.filter((i): i is ReferenceItem => i !== null),
      );
    },
    [qc, key],
  );

  const cancelUpload = useCallback(
    (localId: string) => {
      const queued = queue.current.findIndex((j) => j.localId === localId);
      if (queued >= 0) {
        queue.current.splice(queued, 1)[0].settle(null);
        dropUpload(localId);
        return;
      }
      const controller = controllers.current.get(localId);
      if (controller) {
        // Running: the finalize step is not abortable (an item may still land), so the entry
        // stays, counted in flight, until the call settles. Approve/send stay disabled meanwhile.
        cancelled.current.add(localId);
        controller.abort();
        return;
      }
      dropUpload(localId); // dismissing an error entry
    },
    [dropUpload],
  );

  const retryUpload = useCallback(
    (localId: string) => {
      const file = files.current.get(localId);
      // Only an error entry retries: a running or queued one would upload twice.
      if (!file || controllers.current.has(localId)) return;
      if (queue.current.some((j) => j.localId === localId)) return;
      patchUpload(localId, { status: 'uploading', error: undefined, loaded: 0 });
      queue.current.push({
        localId,
        file,
        settle: () => undefined,
        onUploaded: uploadedCallbacks.current.get(localId),
      });
      pump.current();
    },
    [patchUpload],
  );

  const addLink = useCallback(
    async (input: AddReferenceLinkInput) => {
      try {
        const item = await addPostReferenceLink(token, postId, input);
        appendItem(item);
        return item;
      } catch (err) {
        if (codeOf(err) === 'post_not_pending' || codeOf(err) === 'reference_limit') {
          void qc.invalidateQueries({ queryKey: key });
        }
        throw err;
      }
    },
    [token, postId, appendItem, qc, key],
  );

  const updateNote = useCallback(
    async (id: number, note: string) => {
      try {
        replaceItem(await updatePostReferenceNote(token, id, note));
        if (mounted.current) setFreshIds((ids) => ids.filter((x) => x !== id));
      } catch (err) {
        if (codeOf(err) === 'locked' || codeOf(err) === 'not_found') {
          void qc.invalidateQueries({ queryKey: key });
        }
        throw err;
      }
    },
    [token, replaceItem, qc, key],
  );

  const remove = useCallback(
    async (id: number) => {
      try {
        await removePostReference(token, id);
        qc.setQueryData<ReferencesData>(key, (old) =>
          old ? { ...old, items: old.items.filter((i) => i.id !== id) } : old,
        );
      } finally {
        // can_add depends on the count and the post status: let the server say.
        void qc.invalidateQueries({ queryKey: key });
      }
    },
    [token, qc, key],
  );

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: key });
  }, [qc, key]);

  const data = query.data;
  return {
    data,
    isLoading: query.isLoading,
    canAdd: data?.can_add ?? false,
    items: data?.items ?? [],
    uploads,
    uploadsInFlight: uploads.some((u) => u.status === 'uploading'),
    freshIds,
    startUploads,
    cancelUpload,
    retryUpload,
    addLink,
    updateNote,
    remove,
    refresh,
  };
}

export type PostReferencesState = ReturnType<typeof usePostReferences>;
