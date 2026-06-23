// =============================================
// Pure helpers for reordering briefing sections & questions.
//
// "Sections" are not an entity — they are the `section` string on each question.
// Section order is the first-appearance order of questions, with the unsectioned
// ('') block pinned first (mirroring the CRM editor render). These helpers take a
// briefing's questions in current array order, apply a move, and return the new
// full order of question ids (or null for a no-op). They tolerate non-contiguous
// `display_order` input and heal it: the persisted order is always 0..n-1.
// =============================================

interface ReorderQuestion {
  id: string;
  section: string | null;
}

interface OrderedQuestion {
  id: string;
  display_order: number;
}

function move<T>(arr: T[], from: number, to: number): T[] {
  const copy = arr.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/** Group questions by section in first-appearance order ('' = unsectioned). */
function groupBySection<T extends ReorderQuestion>(questions: T[]): { key: string; items: T[] }[] {
  const groups: { key: string; items: T[] }[] = [];
  for (const q of questions) {
    const key = q.section ?? '';
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, items: [] };
      groups.push(group);
    }
    group.items.push(q);
  }
  return groups;
}

/** Flatten groups into the canonical order: unsectioned first, then named. */
function flatten<T extends ReorderQuestion>(groups: { key: string; items: T[] }[]): T[] {
  const unsectioned = groups.find((g) => g.key === '');
  const named = groups.filter((g) => g.key !== '');
  return [...(unsectioned?.items ?? []), ...named.flatMap((g) => g.items)];
}

/**
 * Reorder a single question within its own section. `sectionKey` is '' for the
 * unsectioned block. Returns the briefing's new full order of ids, or null for a
 * no-op (same id, or from/to not both in `sectionKey` — the cross-section guard).
 */
export function reorderQuestionWithinSection<T extends ReorderQuestion>(
  questions: T[],
  sectionKey: string,
  fromId: string,
  toId: string,
): string[] | null {
  if (fromId === toId) return null;
  const groups = groupBySection(questions);
  const group = groups.find((g) => g.key === sectionKey);
  if (!group) return null;
  const ids = group.items.map((q) => q.id);
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from === -1 || to === -1) return null;
  group.items = move(group.items, from, to);
  return flatten(groups).map((q) => q.id);
}

/**
 * Reorder whole named-section blocks. `fromSection`/`toSection` are raw section
 * names; current order is derived by first-appearance. Returns the briefing's new
 * full order of ids, or null for a no-op.
 */
export function reorderSections<T extends ReorderQuestion>(
  questions: T[],
  fromSection: string,
  toSection: string,
): string[] | null {
  if (fromSection === toSection) return null;
  const groups = groupBySection(questions);
  const named = groups.filter((g) => g.key !== '');
  const from = named.findIndex((g) => g.key === fromSection);
  const to = named.findIndex((g) => g.key === toSection);
  if (from === -1 || to === -1) return null;
  const reorderedNamed = move(named, from, to);
  const unsectioned = groups.find((g) => g.key === '');
  const newOrder = [...(unsectioned?.items ?? []), ...reorderedNamed.flatMap((g) => g.items)];
  return newOrder.map((q) => q.id);
}

/**
 * Minimal persist set: given the briefing's questions and the new ordered ids,
 * return only the rows whose `display_order` differs from their new index.
 */
export function toDisplayOrderUpdates<T extends OrderedQuestion>(
  questions: T[],
  orderedIds: string[],
): { id: string; display_order: number }[] {
  const current = new Map(questions.map((q) => [q.id, q.display_order]));
  const updates: { id: string; display_order: number }[] = [];
  orderedIds.forEach((id, index) => {
    if (current.get(id) !== index) updates.push({ id, display_order: index });
  });
  return updates;
}

/**
 * Optimistic cache rewrite: reorder the questions named in `orderedIds` into that
 * order (and set their `display_order` to match), leaving every other question —
 * including those of other briefings — exactly where it was. Keyed purely by the
 * id set, so legacy `briefing_id: null` questions are handled correctly.
 */
export function applyReorderToCache<T extends OrderedQuestion>(
  list: T[],
  orderedIds: string[],
): T[] {
  const idSet = new Set(orderedIds);
  const byId = new Map(list.filter((q) => idSet.has(q.id)).map((q) => [q.id, q]));
  let ptr = 0;
  return list.map((q) => {
    if (!idSet.has(q.id)) return q;
    const target = byId.get(orderedIds[ptr])!;
    return { ...target, display_order: ptr++ };
  });
}
