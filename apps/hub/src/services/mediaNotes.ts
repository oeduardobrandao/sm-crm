import { trackUnsavedWork } from '@mesaas/app-lifecycle';
import { post } from '../api';

const FN = 'hub-media-notes';

export interface CreateMediaNoteInput {
  post_id: number;
  /** The `HubPostMedia.id` (post_file_links.id) the client is looking at. */
  link_id: number;
  /** Video moment, in seconds. */
  t_seconds?: number;
  /** Spot on the media, both or neither, each 0..1. */
  x?: number;
  y?: number;
  body: string;
}

/**
 * Writes hold the unsaved-work registry for the whole round trip: a silent version swap
 * must not reload the Hub between the client pressing send and the server answering.
 */
export function createMediaNote(
  token: string,
  input: CreateMediaNoteInput,
): Promise<{ ok: true; note_id: number }> {
  return trackUnsavedWork(
    post<{ ok: true; note_id: number }>(FN, { token, op: 'create', ...input }),
  );
}

export function replyMediaNote(
  token: string,
  note_id: number,
  body: string,
): Promise<{ ok: true; reply_id: number }> {
  return trackUnsavedWork(
    post<{ ok: true; reply_id: number }>(FN, { token, op: 'reply', note_id, body }),
  );
}
