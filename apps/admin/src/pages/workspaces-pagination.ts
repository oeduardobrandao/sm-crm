/**
 * Page-number window for the list footer: up to `size` consecutive pages centred on the
 * current one, with the first and last page always pinned and 'gap' where pages are skipped.
 */
export function pageWindow(current: number, totalPages: number, size = 5): (number | 'gap')[] {
  if (totalPages <= 0) return [];
  const cur = Math.min(Math.max(1, current), totalPages);
  if (totalPages <= size + 2) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const half = Math.floor(size / 2);
  let start = Math.max(1, cur - half);
  const end = Math.min(totalPages, start + size - 1);
  start = Math.max(1, end - size + 1);

  const pages: (number | 'gap')[] = [];
  if (start > 1) {
    pages.push(1);
    if (start > 2) pages.push('gap');
  }
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < totalPages) {
    if (end < totalPages - 1) pages.push('gap');
    pages.push(totalPages);
  }
  return pages;
}
