// Browser-side font loading (docs/estudio-design.md §6.3/§7). Fetches the SAME public TTF URLs
// the manifest describes, mirroring `design-render-core.ts`'s `loadFontsForVariants` byte-for-
// byte (identical per-variant latin+latinExt entries, identical fallback-family append) so satori
// gets identical `fonts[]` input in both runtimes — same layouter + same inputs ⇒ same geometry.
// Server-side loads bytes via an injected R2 resolver; here there's no DB/tenancy boundary to
// cross, so this fetches straight from the public manifest paths (§7's "single-format serving" —
// these are the exact URLs the TipTap overlay's `@font-face` will reuse in T2.8, one HTTP-cached
// download per variant).
import { useQuery } from '@tanstack/react-query';
import rawManifest from '@mesaas/fonts/manifest.json';
import type { FontFamily, FontFile, FontManifest } from '@mesaas/fonts/types';
import type { FontWeight } from '@mesaas/design-doc';
import type { DesignDoc } from '../types';

const FONT_MANIFEST = rawManifest as unknown as FontManifest;

export interface SatoriFontEntry {
  name: string;
  data: ArrayBuffer;
  weight: FontWeight;
  style: 'normal' | 'italic';
}

interface VariantKey {
  fontKey: string;
  weight: FontWeight;
  style: 'normal' | 'italic';
}

function variantId(v: VariantKey): string {
  return `${v.fontKey}/${v.weight}/${v.style}`;
}

/** Walks every text layer (+ its runs) across ALL pages of `doc` — unlike the server, which only
 * ever needs one page's fonts per render invocation, the editor has the whole doc open at once
 * (carousel page-switching must not re-trigger a font-loading flash), so this collects the
 * doc-wide set. */
export function collectDocFontVariants(doc: DesignDoc): VariantKey[] {
  const seen = new Set<string>();
  const out: VariantKey[] = [];
  const push = (fontKey: string, weight: FontWeight, style: 'normal' | 'italic') => {
    const key = variantId({ fontKey, weight, style });
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ fontKey, weight, style });
  };
  for (const page of doc.pages) {
    for (const layer of page.layers) {
      if (layer.type !== 'text') continue;
      push(layer.font_key, layer.font_weight, layer.font_style ?? 'normal');
      for (const run of layer.runs ?? []) {
        push(
          layer.font_key,
          run.font_weight ?? layer.font_weight,
          run.font_style ?? layer.font_style ?? 'normal',
        );
      }
    }
  }
  return out;
}

// Module-scope cache (survives across hook instances/unmounts within the session) — the browser's
// own HTTP cache still saves the network round trip on a repeat fetch, but not the JS-side
// `ArrayBuffer` materialization; this cache avoids both, same reasoning as the server's fontCache.
const fontBytesCache = new Map<string, Promise<ArrayBuffer>>();

function fetchFontBytes(file: FontFile): Promise<ArrayBuffer> {
  let cached = fontBytesCache.get(file.path);
  if (!cached) {
    cached = fetch(`${file.path}?v=${FONT_MANIFEST.version}`).then((res) => {
      if (!res.ok) throw new Error(`font fetch failed: ${file.path} (${res.status})`);
      return res.arrayBuffer();
    });
    cached.catch(() => fontBytesCache.delete(file.path)); // don't cache a rejected fetch forever
    fontBytesCache.set(file.path, cached);
  }
  return cached;
}

/** Pure manifest lookup by key only (no weight/style) — exported for UI callers (e.g.
 * ContextualToolbar's font/weight selects) that need family metadata to populate controls, per
 * this module's "single ownership of manifest lookups" convention. Returns undefined for an
 * unknown key rather than throwing — a `<select>`'s currently-stored font_key can transiently be
 * stale/unknown (e.g. mid-edit), and UI code should degrade gracefully, unlike the satori-loading
 * path below which treats an unknown variant as a hard error. */
export function findFamily(fontKey: string): FontFamily | undefined {
  return FONT_MANIFEST.families.find((f) => f.key === fontKey);
}

/** All families grouped by `family.group`, in the manifest's own group order — the exact
 * grouping ContextualToolbar's font <select> needs for its <optgroup>s. */
export function familiesByGroup(): Array<{ group: string; label: string; families: FontFamily[] }> {
  return Object.entries(FONT_MANIFEST.groups).map(([group, label]) => ({
    group,
    label,
    families: FONT_MANIFEST.families.filter((f) => f.group === group),
  }));
}

/** The safe family-switch patch (single ownership — FontPicker, BrandPanel and any other
 * family-changing UI must produce IDENTICAL fallbacks): if the new family doesn't ship the
 * layer's current font_style, fall back to 'normal' (every manifest family has at least one
 * normal variant); keep the current font_weight when the new family ships it at that style,
 * else take the family's first available weight. Without this, switching families could leave
 * (font_key, font_weight, font_style) pointing at a variant that doesn't exist — which only
 * surfaces as an `unsupported_font_variant` error at save time. */
export function buildFontFamilyPatch(
  nextKey: string,
  current: { font_weight: FontWeight; font_style?: 'normal' | 'italic' },
): { font_key: string; font_weight: FontWeight; font_style?: 'normal' | 'italic' } {
  const style = current.font_style ?? 'normal';
  const nextFamily = findFamily(nextKey);
  const nextFamilyStyles = new Set((nextFamily?.variants ?? []).map((v) => v.style));
  const nextStyle = nextFamilyStyles.has(style) ? style : 'normal';
  const nextWeights = (nextFamily?.variants ?? [])
    .filter((v) => v.style === nextStyle)
    .map((v) => v.weight as FontWeight);
  const nextWeight = nextWeights.includes(current.font_weight)
    ? current.font_weight
    : (nextWeights[0] ?? current.font_weight);
  return {
    font_key: nextKey,
    font_weight: nextWeight,
    ...(nextStyle !== style ? { font_style: nextStyle } : {}),
  };
}

function findVariant(v: VariantKey): { family: FontFamily; files: FontFile[] } {
  const family = FONT_MANIFEST.families.find((f) => f.key === v.fontKey);
  const variant = family?.variants.find((fv) => fv.weight === v.weight && fv.style === v.style);
  if (!family || !variant) {
    throw new Error(`useFontManifest: unknown font variant ${variantId(v)}`);
  }
  return {
    family,
    files: [variant.files.latin, variant.files.latinExt].filter((f): f is FontFile => !!f),
  };
}

/** Pure (family, weight, style) -> `FontFile` lookup, built from the same manifest search
 * `findVariant` uses internally — exported per this module's "single ownership of manifest
 * lookups" convention (e.g. TextEditOverlay's `@font-face` needs the SAME variant resolution the
 * satori-loading path uses, so the contenteditable visually matches the render). Returns
 * `undefined` (never throws) for an unknown key/weight/style combo — a text layer's stored
 * (font_key, font_weight, font_style) can point at a variant the manifest doesn't have (e.g. an
 * older manifest version), and callers here are visual-fidelity-only, not correctness-critical
 * like the satori loading path. Prefers the `latin` file (matches `loadVariantEntries`'s own
 * per-variant ordering); falls back to `latinExt` if `latin` is absent. */
export function findFontFile(
  fontKey: string,
  weight: FontWeight,
  style: 'normal' | 'italic',
): FontFile | undefined {
  const family = FONT_MANIFEST.families.find((f) => f.key === fontKey);
  const variant = family?.variants.find((fv) => fv.weight === weight && fv.style === style);
  return variant?.files.latin ?? variant?.files.latinExt;
}

async function loadVariantEntries(v: VariantKey): Promise<SatoriFontEntry[]> {
  const { files } = findVariant(v);
  const entries: SatoriFontEntry[] = [];
  for (const file of files) {
    entries.push({
      name: v.fontKey,
      data: await fetchFontBytes(file),
      weight: v.weight,
      style: v.style,
    });
  }
  return entries;
}

/** Loads satori `fonts[]` entries for every variant `doc` uses, plus the manifest's fallback
 * family (400/normal) last, always — same "last-resort glyph source" guarantee the server gives
 * every render (design-render-core.ts's `loadFontsForVariants`). */
export function useFontManifest(doc: DesignDoc | undefined) {
  const variants = doc ? collectDocFontVariants(doc) : [];
  const queryKey = variants.map(variantId).sort().join(',');

  return useQuery({
    queryKey: ['estudio-font-manifest', queryKey],
    queryFn: async () => {
      const all: SatoriFontEntry[] = [];
      for (const v of variants) all.push(...(await loadVariantEntries(v)));
      const fallback: VariantKey = {
        fontKey: FONT_MANIFEST.fallbackKey,
        weight: 400,
        style: 'normal',
      };
      if (!variants.some((v) => variantId(v) === variantId(fallback))) {
        all.push(...(await loadVariantEntries(fallback)));
      }
      return all;
    },
    enabled: !!doc,
    staleTime: Infinity, // font bytes for a given variant set never change once fetched
    retry: false,
  });
}
