/**
 * A TipTap document as a comparable string: keys sorted, and inline images' `src` dropped.
 * hub-posts signs `src` into both documents (appending the key), while a just-saved
 * suggestion comes back from hub-edit-suggestion with `src` stripped; the image identity is
 * its `r2Key` either way.
 */
export function canonicalDoc(value: unknown): string {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== 'object') return node;
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (key === 'src' && obj.r2Key !== undefined) continue;
      out[key] = walk(obj[key]);
    }
    return out;
  };
  return JSON.stringify(walk(value ?? null));
}
