/** pt-BR formatting helpers for the blog render pieces. */

/** `YYYY-MM-DD` as "21 de outubro de 2026". Built from the date's parts in
 * local time, never `new Date('YYYY-MM-DD')` (UTC midnight, which prints the
 * previous day in Brasília while the prerender runs in UTC). Same approach as
 * `formatPostDate` in apps/crm/src/content/blog.ts. */
export function formatIsoDatePtBR(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(y, m - 1, d));
}

export function formatNumberPtBR(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value);
}
