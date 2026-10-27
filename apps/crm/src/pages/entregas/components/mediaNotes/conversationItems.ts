import { i18n } from '@mesaas/i18n';
import type { PostApproval, PostMedia } from '@/store/posts';
import type { MediaNote } from '@/store/mediaNotes';

export type ConversationItem =
  | {
      kind: 'approval';
      key: string;
      at: string;
      approval: PostApproval;
      /** "2 comentários na mídia em aberto: slides 3, 4": read from the approval's snapshot. */
      noteSummary?: string;
      /** "Aprovado com 2 comentários em aberto": approval sent with a non-empty snapshot. */
      openCommentsLabel?: string;
    }
  | { kind: 'note'; key: string; at: string; note: MediaNote };

/** 0-based slide index the note points at: the live one, else the snapshot from creation. */
function slideIndexOf(note: MediaNote, media: PostMedia[]): number {
  if (note.current_slide_index != null) return note.current_slide_index;
  if (note.current_link_id != null) {
    const idx = media.findIndex((m) => m.id === note.current_link_id);
    if (idx >= 0) return idx;
  }
  return note.slide_index_at_creation;
}

export function formatMediaTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * "Slide 3 · ponto 1" | "0:42" | "Slide 3 (versão anterior)". Pins are numbered per
 * slide/file. A previous-version note has no pin on screen (here or in the Hub), so it
 * never gets a number: the team must not say "ponto 1" to a client who cannot see one.
 */
export function noteAnchorLabel(note: MediaNote, notes: MediaNote[], media: PostMedia[]): string {
  const parts: string[] = [];
  if (note.media_kind === 'video') {
    parts.push(
      note.t_seconds != null ? formatMediaTime(note.t_seconds) : i18n.t('posts:shared.video'),
    );
  } else {
    parts.push(i18n.t('posts:conversation.slide', { n: slideIndexOf(note, media) + 1 }));
  }
  if (note.x != null && note.y != null && !note.is_previous_version) {
    const sameTarget = notes
      .filter(
        (n) =>
          n.x != null &&
          n.y != null &&
          n.media_kind === note.media_kind &&
          !n.is_previous_version &&
          n.current_link_id === note.current_link_id,
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
    const pos = sameTarget.findIndex((n) => n.id === note.id);
    parts.push(i18n.t('posts:conversation.point', { n: (pos >= 0 ? pos : 0) + 1 }));
  }
  const label = parts.join(' · ');
  return note.is_previous_version ? i18n.t('posts:conversation.previousVersion', { label }) : label;
}

function summarize(approval: PostApproval, notes: MediaNote[], media: PostMedia[]): string {
  const ids = new Set(approval.media_note_ids);
  const snap = notes.filter((n) => ids.has(n.id));
  const count = approval.media_note_ids.length;
  const slides = [
    ...new Set(snap.filter((n) => n.media_kind === 'image').map((n) => slideIndexOf(n, media) + 1)),
  ].sort((a, b) => a - b);
  const videoTimes = snap
    .filter((n) => n.media_kind === 'video' && n.t_seconds != null)
    .map((n) => formatMediaTime(n.t_seconds as number));
  const where: string[] = [];
  if (slides.length > 0)
    where.push(
      i18n.t('posts:conversation.slidesList', { count: slides.length, list: slides.join(', ') }),
    );
  if (videoTimes.length > 0)
    where.push(
      i18n.t('posts:conversation.videoList', { list: [...new Set(videoTimes)].join(', ') }),
    );
  const head = i18n.t('posts:conversation.openOnMedia', { count });
  return where.length > 0
    ? i18n.t('posts:conversation.summary', { head, where: where.join('; ') })
    : head;
}

/**
 * Chronological conversation: approvals and client-visible media notes interleaved.
 * Internal notes never appear. An approval that carries a snapshot of open notes gets the
 * summary line, and an `aprovado` with a snapshot is flagged "Aprovado com N comentários em aberto".
 */
export function buildConversationItems(
  approvals: PostApproval[],
  notes: MediaNote[],
  media: PostMedia[],
): ConversationItem[] {
  const items: ConversationItem[] = [];
  for (const approval of approvals) {
    const snapshot = approval.media_note_ids ?? [];
    const item: ConversationItem = {
      kind: 'approval',
      key: `a-${approval.id}`,
      at: approval.created_at,
      approval,
    };
    if (snapshot.length > 0) {
      item.noteSummary = summarize(approval, notes, media);
      if (approval.action === 'aprovado') {
        item.openCommentsLabel = i18n.t('posts:mediaNotes.approvedWithOpen', {
          count: snapshot.length,
        });
      }
    }
    items.push(item);
  }
  for (const note of notes) {
    if (note.visibility !== 'client') continue;
    items.push({ kind: 'note', key: `n-${note.id}`, at: note.created_at, note });
  }
  const order = (i: ConversationItem) => (i.kind === 'approval' ? i.approval.id : i.note.id);
  return items.sort((a, b) => {
    const diff = new Date(a.at).getTime() - new Date(b.at).getTime();
    if (diff !== 0) return diff;
    if (a.kind !== b.kind) return a.kind === 'approval' ? -1 : 1;
    return order(a) - order(b);
  });
}
