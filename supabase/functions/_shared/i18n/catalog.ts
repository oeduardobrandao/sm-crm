import type { Lang } from "./lang.ts";

/**
 * A catalog is a plain object whose values are strings or `(args) => string`.
 * Both languages must share the same shape (enforced by the type and by
 * __tests__/edge-i18n-catalogs_test.ts).
 */
export function defineCatalog<T extends Record<string, unknown>>(
  c: { pt: T; en: T },
): (lang: Lang) => T {
  return (lang) => (lang === "en" ? c.en : c.pt);
}
