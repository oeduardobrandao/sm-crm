/**
 * Deterministic colour assignment for initials avatars (people, not clients —
 * clients carry their own `cor` column).
 *
 * Returns a class name; the actual colours live in `.avatar--c*` in style.css so
 * that light and dark themes are defined in one place instead of being inlined
 * at every call site. Pair it with the `.avatar` class:
 *
 *   <div className={`avatar ${avatarColorClass(membro.id ?? membro.nome)}`}>JE</div>
 *
 * Seeding by id keeps a person's colour stable even if they are renamed; passing
 * a name still works for the places that have no id to hand.
 */
export const AVATAR_COLOR_COUNT = 8;

export function avatarColorClass(seed: string | number | null | undefined): string {
  const key = seed === null || seed === undefined ? '' : String(seed);
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return `avatar--c${(hash % AVATAR_COLOR_COUNT) + 1}`;
}
