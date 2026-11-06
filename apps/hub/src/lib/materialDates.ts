/** "14 nov" in the client's language; null when the post has no date yet. */
export function shortDate(iso: string | null, lang: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(lang === 'en' ? 'en-US' : 'pt-BR', {
    day: 'numeric',
    month: 'short',
  });
}
