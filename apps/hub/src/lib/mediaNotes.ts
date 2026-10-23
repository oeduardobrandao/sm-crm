import type { TFunction } from 'i18next';
import type { HubMediaNote, HubPost } from '../types';

/** Mirrors hub-approve's HUB_VISIBLE_STATUSES: the statuses a client can see (and so write on). */
const NOTE_WRITABLE_STATUSES: ReadonlySet<HubPost['status']> = new Set([
  'enviado_cliente',
  'aprovado_cliente',
  'correcao_cliente',
  'agendado',
  'postado',
  'falha_publicacao',
]);

export function notesForPost(all: HubMediaNote[], postId: number): HubMediaNote[] {
  return all.filter((n) => n.post_id === postId);
}

/** Every open note, previous versions included: they still await the team's answer. */
export function openNoteCount(notes: HubMediaNote[]): number {
  return notes.filter((n) => n.status === 'open').length;
}

/** Open notes per current link id. Previous-version notes have no link and are left out. */
export function openCountByLink(notes: HubMediaNote[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const n of notes) {
    if (n.status !== 'open' || n.is_previous_version || n.link_id === null) continue;
    counts.set(n.link_id, (counts.get(n.link_id) ?? 0) + 1);
  }
  return counts;
}

/** The client may comment only on a post it can see that is not back with the agency. */
export function canWriteNotes(post: HubPost): boolean {
  return NOTE_WRITABLE_STATUSES.has(post.status) && !post.em_producao;
}

// TODO(fem): switch to formatMoment from @mesaas/ui/mediaPins/geometry once it lands.
function formatMoment(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * "Slide 3 · ponto 1", "0:42 · ponto na cena", "Slide 2 (versão anterior)".
 * `pointNumber` is the pin's 1-based position among the slide's pinned notes: the note
 * alone cannot know it, so without it a pinned image note falls back to the slide label.
 */
export function anchorLabel(
  note: HubMediaNote,
  t: TFunction<'hubPosts'>,
  pointNumber?: number,
): string {
  const pinned = note.x !== null && note.y !== null;
  const parts: string[] = [];
  if (note.t_seconds !== null) {
    parts.push(formatMoment(note.t_seconds));
    if (pinned) parts.push(t('mediaNotes.pointInScene'));
  } else {
    parts.push(t('mediaNotes.slide', { n: note.slide_index + 1 }));
    if (pinned && pointNumber !== undefined) parts.push(t('mediaNotes.point', { n: pointNumber }));
  }
  const label = parts.join(' · ');
  return note.is_previous_version ? `${label} (${t('mediaNotes.previousVersion')})` : label;
}
