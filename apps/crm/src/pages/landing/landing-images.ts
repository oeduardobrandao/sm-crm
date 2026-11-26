import type { SiteLocale } from '@/content/locale';

/** Files under `public/landing/en/` (English screenshots). Resolved at build time from this list,
 * never by a runtime file check: an image missing here keeps the Portuguese path. Add a name when
 * its English asset ships. */
export const EN_LANDING_IMAGES: readonly string[] = [];

/** `/landing/<file>` for pt; for en the `/landing/en/<file>` twin when it is listed above. */
export function landingAsset(locale: SiteLocale, path: string): string {
  if (locale !== 'en' || !path.startsWith('/landing/')) return path;
  const file = path.slice('/landing/'.length);
  return EN_LANDING_IMAGES.includes(file) ? `/landing/en/${file}` : path;
}
