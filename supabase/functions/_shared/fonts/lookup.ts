// Real FontVariantLookup implementation (docs/estudio-design.md §2.5 / _shared/design-doc.ts's
// decoupled interface) backed by the committed font manifest. Import-free like the rest of
// _shared/fonts/ except for the manifest JSON itself and the FontWeight type — safe to use from
// any Deno edge function (design-render-core.ts already imports the same manifest.json
// independently; this module is the validation-time counterpart, not a second source of truth
// for the catalog itself).

import type { FontWeight } from "../design-doc.ts";
import type { FontVariantLookup } from "../design-doc.ts";
import manifest from "./manifest.json" with { type: "json" };
import type { FontManifest } from "./types.ts";

const FONT_MANIFEST = manifest as unknown as FontManifest;

const VARIANTS_BY_KEY = new Map<
  string,
  Array<{ weight: FontWeight; style: "normal" | "italic" }>
>(
  FONT_MANIFEST.families.map((family) => [
    family.key,
    family.variants.map((v) => ({
      weight: v.weight as FontWeight,
      style: v.style,
    })),
  ]),
);

export const manifestFontLookup: FontVariantLookup = {
  allowedKeys: () => [...VARIANTS_BY_KEY.keys()],
  hasVariant: (key, weight, style) =>
    (VARIANTS_BY_KEY.get(key) ?? []).some((v) =>
      v.weight === weight && v.style === style
    ),
  variantsFor: (key) => VARIANTS_BY_KEY.get(key) ?? [],
};
