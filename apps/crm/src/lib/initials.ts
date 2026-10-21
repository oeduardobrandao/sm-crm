/**
 * Up to two initials for an avatar fallback: the first character of each
 * space-separated word, uppercased ("Débora Kristin" → "DK", "Eduardo" → "E").
 * Empty segments left by repeated spaces contribute nothing.
 *
 * Kept free of store imports on purpose: `EntregasPage.test` mocks the store
 * wholesale, so a component under that page importing a runtime value from
 * `@/store` gets `undefined` at render. `store/core.ts` re-exports this, so both
 * import paths reach the same function.
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
