// scripts/build-report-fonts.ts
// One-off generator: fetches latin WOFF2 subsets from Google Fonts and emits
// supabase/functions/_shared/report-template/fonts.ts with base64 @font-face rules.
// Run manually when fonts change: deno run --allow-net --allow-write scripts/build-report-fonts.ts
//
// Both families are VARIABLE fonts: Google returns ONE woff2 file per family
// covering the whole weight axis, so every requested weight's @font-face block
// points at byte-identical content. We de-duplicate by hashing the actual
// downloaded payload (never by assumption) and emit one @font-face per unique
// file, declaring a variable font-weight RANGE that covers the weights mapped
// to it. If a future Google Fonts response legitimately returns distinct files
// per weight, this still works: each distinct payload gets its own rule.

const FAMILIES = [
  { css: 'Fraunces:opsz,wght@9..144,500;9..144,600', name: 'Fraunces', weights: [500, 600] },
  {
    css: 'Instrument+Sans:wght@400;500;600;700',
    name: 'Instrument Sans',
    weights: [400, 500, 600, 700],
  },
];
// Chrome UA → Google returns woff2 with unicode-range subsets
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// woff2 magic bytes: ASCII "wOF2"
const WOFF2_MAGIC = [0x77, 0x4f, 0x46, 0x32];

interface FaceProps {
  family: string;
  style: string;
  weight: number;
  stretch: string | null;
  display: string;
  unicodeRange: string;
  url: string;
}

function parseBlock(block: string): FaceProps {
  const family = block.match(/font-family:\s*'([^']+)'/)?.[1];
  const style = block.match(/font-style:\s*([\w-]+)\s*;/)?.[1];
  const weight = block.match(/font-weight:\s*(\d+)\s*;/)?.[1];
  const stretch = block.match(/font-stretch:\s*([^;]+);/)?.[1]?.trim() ?? null;
  const display = block.match(/font-display:\s*([\w-]+)\s*;/)?.[1];
  const unicodeRange = block.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
  const urlMatch = block.match(/url\((https:[^)]+\.woff2)\)/);

  if (!family || !style || !weight || !display || !unicodeRange || !urlMatch) {
    throw new Error(`Could not parse required @font-face properties from block:\n${block}`);
  }

  return {
    family,
    style,
    weight: Number(weight),
    stretch,
    display,
    unicodeRange,
    url: urlMatch[1],
  };
}

function bytesToBase64(bin: Uint8Array): string {
  let b64 = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bin.length; i += CHUNK) {
    b64 += String.fromCharCode(...bin.subarray(i, i + CHUNK));
  }
  return btoa(b64);
}

async function sha256Hex(bin: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bin as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function buildFaceRule(props: FaceProps, weightDecl: string, dataUri: string): string {
  const lines = [
    '@font-face {',
    `  font-family: '${props.family}';`,
    `  font-style: ${props.style};`,
    `  font-weight: ${weightDecl};`,
  ];
  if (props.stretch) {
    lines.push(`  font-stretch: ${props.stretch};`);
  }
  lines.push(`  font-display: ${props.display};`);
  lines.push(`  src: url(${dataUri}) format('woff2');`);
  lines.push(`  unicode-range: ${props.unicodeRange};`);
  lines.push('}');
  return lines.join('\n');
}

interface PayloadGroup {
  props: FaceProps; // representative props (family/style/stretch/display/unicode-range shared)
  weights: number[];
  base64: string;
}

const outputRules: string[] = [];
const familySummaries: string[] = [];

for (const fam of FAMILIES) {
  const res = await fetch(`https://fonts.googleapis.com/css2?family=${fam.css}&display=swap`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) {
    console.error(
      `Google Fonts CSS2 request failed for family "${fam.name}": ${res.status} ${res.statusText}`,
    );
    Deno.exit(1);
  }
  const css = await res.text();

  // Google's CSS response is a flat sequence of `@font-face { ... }` rules,
  // each usually preceded by a comment naming the subset, e.g. `/* latin */`.
  // We keep only the blocks whose preceding comment is the latin subset
  // marker — other locales (latin-ext, cyrillic, vietnamese, etc.) are
  // dropped to keep file size sane.
  const faceBlocks = css.match(/(?:\/\*\s*[\w-]+\s*\*\/\s*)?@font-face\s*\{[^}]*\}/g) ?? [];
  const latinBlocks = faceBlocks.filter((block) => /\/\*\s*latin\s*\*\//.test(block));

  if (latinBlocks.length === 0) {
    console.error(
      `No latin @font-face blocks found for family "${fam.name}" — Google Fonts CSS response ` +
        'format may have changed, or the family name/css query is wrong. Inspect the raw `css` ' +
        'variable and adjust the parsing regex above.',
    );
    Deno.exit(1);
  }

  // Download each block's woff2, verify it, hash it, and group blocks whose
  // payload bytes are IDENTICAL (variable fonts return the same file for
  // every weight in the axis).
  const groups: PayloadGroup[] = [];
  const hashToGroupIndex = new Map<string, number>();

  for (const block of latinBlocks) {
    const props = parseBlock(block);

    const fontRes = await fetch(props.url);
    if (!fontRes.ok) {
      console.error(
        `Font file download failed for "${props.family}" weight ${props.weight}: ` +
          `${fontRes.status} ${fontRes.statusText} (${props.url})`,
      );
      Deno.exit(1);
    }
    const bin = new Uint8Array(await fontRes.arrayBuffer());

    const magicOk = WOFF2_MAGIC.every((byte, i) => bin[i] === byte);
    if (!magicOk) {
      console.error(
        `Downloaded file for "${props.family}" weight ${props.weight} does not start with the ` +
          `woff2 magic bytes (got response that is not a valid woff2 — possibly an HTML error ` +
          `page). URL: ${props.url}`,
      );
      Deno.exit(1);
    }

    const hash = await sha256Hex(bin);
    const existingIdx = hashToGroupIndex.get(hash);
    if (existingIdx === undefined) {
      hashToGroupIndex.set(hash, groups.length);
      groups.push({ props, weights: [props.weight], base64: bytesToBase64(bin) });
    } else {
      groups[existingIdx].weights.push(props.weight);
    }
  }

  // Emit one @font-face rule per unique payload, weight range = min..max of
  // the weights that map to it (a single value if only one weight does).
  const familyRanges: Array<[number, number]> = [];
  for (const group of groups) {
    const min = Math.min(...group.weights);
    const max = Math.max(...group.weights);
    const weightDecl = min === max ? `${min}` : `${min} ${max}`;
    outputRules.push(
      buildFaceRule(group.props, weightDecl, `data:font/woff2;base64,${group.base64}`),
    );
    familyRanges.push([min, max]);
  }

  // Guard: every requested weight for this family must be covered by some
  // emitted rule's weight range — catches an upstream change that silently
  // drops a weight (or an entire family, already guarded above).
  const missingWeights = fam.weights.filter(
    (w) => !familyRanges.some(([min, max]) => w >= min && w <= max),
  );
  if (missingWeights.length > 0) {
    console.error(
      `Family "${fam.name}" is missing @font-face coverage for weight(s): ` +
        `${missingWeights.join(', ')}. Requested: ${fam.weights.join(', ')}. ` +
        `Emitted ranges: ${familyRanges.map(([a, b]) => `${a}-${b}`).join(', ')}.`,
    );
    Deno.exit(1);
  }

  familySummaries.push(
    `${fam.name} ${familyRanges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join('/')}` +
      ` (${groups.length} unique file${groups.length === 1 ? '' : 's'})`,
  );
}

const out = outputRules.join('\n') + '\n';

// Self-containment guard: Gotenberg's headless Chromium has NO network
// access. A leaked https:// reference (e.g. a parsing bug that left the
// original Google CDN url in place) must fail the build loudly rather than
// silently degrade to missing glyphs / fallback fonts in the PDF.
if (out.includes('https://')) {
  console.error(
    'Generated CSS contains "https://" — a font reference was not properly inlined as a data ' +
      'URI. Gotenberg cannot fetch external resources; refusing to write a non-self-contained ' +
      'fonts.ts.',
  );
  Deno.exit(1);
}

const file = `// GENERATED by scripts/build-report-fonts.ts — do not edit by hand.
// ${familySummaries.join(', ')}, latin subset, base64 woff2, deduplicated by payload hash.
export const REPORT_FONTS_CSS = ${JSON.stringify(out)};
`;
await Deno.writeTextFile('supabase/functions/_shared/report-template/fonts.ts', file);
console.log(`fonts.ts written: ${(file.length / 1024).toFixed(0)}KB`);
console.log(`Families: ${familySummaries.join('; ')}`);
