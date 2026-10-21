/** Preload hints for prerendered marketing routes.
 *
 * Each marketing page is a lazy chunk of the CRM entry. Without hints the
 * browser only discovers that chunk (plus its CSS and the ~20 shared chunks it
 * imports) after downloading and running the entry, which costs a full extra
 * round-trip on mobile. This reads Vite's build manifest and emits
 * `<link rel="modulepreload">` / `<link rel="stylesheet">` for the route's
 * chunk and everything it statically imports, so both tiers go out together.
 *
 * The tags mirror what Vite's runtime preload helper looks for
 * (`link[href="/assets/x.css"][rel="stylesheet"]`, crossorigin), so the
 * lazy import later finds them in the DOM instead of fetching again. */

export interface ManifestChunk {
  file: string;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  isEntry?: boolean;
}

export type BuildManifest = Record<string, ManifestChunk>;

/** Route path -> manifest key (source path relative to the Vite root, apps/crm). */
export const ROUTE_CHUNKS: Readonly<Record<string, string>> = {
  '/': 'src/pages/landing/LandingPage.tsx',
  '/precos': 'src/pages/precos/PrecosPage.tsx',
};

function chunkOrThrow(manifest: BuildManifest, key: string): ManifestChunk {
  const chunk = manifest[key];
  if (!chunk) throw new Error(`prerender: build manifest has no entry for ${key}`);
  return chunk;
}

/** Keys of every chunk reachable from `start` over static `imports`, start included. */
function staticClosure(manifest: BuildManifest, start: string): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const visit = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    order.push(key);
    for (const dep of chunkOrThrow(manifest, key).imports ?? []) visit(dep);
  };
  visit(start);
  return order;
}

/** Head tags preloading `chunkKey` and its static imports, minus whatever the
 * entry already loads (the shell's own script/link tags cover those). */
export function preloadTagsFor(manifest: BuildManifest, chunkKey: string): string {
  chunkOrThrow(manifest, chunkKey);
  const entryKeys = Object.keys(manifest).filter((k) => manifest[k].isEntry);
  if (entryKeys.length === 0) throw new Error('prerender: build manifest has no entry chunk');
  const loadedByEntry = new Set<string>();
  const entryCss = new Set<string>();
  for (const entry of entryKeys) {
    for (const key of staticClosure(manifest, entry)) {
      loadedByEntry.add(key);
      for (const css of manifest[key].css ?? []) entryCss.add(css);
    }
  }

  const scripts: string[] = [];
  const styles: string[] = [];
  for (const key of staticClosure(manifest, chunkKey)) {
    if (loadedByEntry.has(key)) continue;
    const chunk = manifest[key];
    scripts.push(chunk.file);
    for (const css of chunk.css ?? []) {
      if (!entryCss.has(css) && !styles.includes(css)) styles.push(css);
    }
  }

  return [
    ...styles.map((f) => `<link rel="stylesheet" crossorigin href="/${f}">`),
    ...scripts.map((f) => `<link rel="modulepreload" crossorigin href="/${f}">`),
  ].join('\n    ');
}

/** Preload tags for a prerendered route, or '' when the route has no mapped chunk. */
export function routePreloadTags(manifest: BuildManifest, routePath: string): string {
  const key = ROUTE_CHUNKS[routePath];
  return key ? preloadTagsFor(manifest, key) : '';
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** `<link rel="preload" as="image">` for a responsive image. The srcset/sizes
 * must equal the <img>'s exactly, or the browser fetches a second candidate. */
export function imagePreloadTag(srcset: string, sizes: string): string {
  return `<link rel="preload" as="image" fetchpriority="high" imagesrcset="${escapeAttr(srcset)}" imagesizes="${escapeAttr(sizes)}">`;
}
