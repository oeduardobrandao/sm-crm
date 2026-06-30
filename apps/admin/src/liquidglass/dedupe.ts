/**
 * Tag-and-skip dedup for liquidGL's class-based target scan (the library has no
 * removeLens and `liquidGL()` re-scans `.liquidGL` with no dedup).
 * - Unbound panes: mark `data-lgl-bound` and KEEP the class so the next
 *   `liquidGL()` scan binds them. Counted as "fresh".
 * - Already-bound panes: REMOVE the `.liquidGL` class so the next scan ignores
 *   them (their existing lens keeps the element reference and is unaffected).
 * Returns the number of fresh panes found.
 */
export function stripBoundAndTagNew(root: ParentNode): number {
  const panes = root.querySelectorAll<HTMLElement>('.liquidGL');
  let fresh = 0;
  panes.forEach((el) => {
    if (el.dataset.lglBound === 'true') {
      el.classList.remove('liquidGL');
    } else {
      el.dataset.lglBound = 'true';
      fresh += 1;
    }
  });
  return fresh;
}
