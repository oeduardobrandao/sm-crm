/** `primary` first (its copy wins on a duplicate id), then the unseen items of `extra` in order. */
export function mergeById<T extends { id: number }>(primary: T[], extra: T[]): T[] {
  if (extra.length === 0) return primary;
  const seen = new Set(primary.map((item) => item.id));
  const out = [...primary];
  for (const item of extra) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
