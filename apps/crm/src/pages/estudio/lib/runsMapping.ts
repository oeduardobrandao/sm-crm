// Pure text/runs <-> TipTap-JSON mapping (docs/estudio-design.md §6.4 "text editing overlay",
// plan T2.8). No React, no DOM, no @tiptap import (this module only produces/consumes plain
// TipTap/ProseMirror JSON object shapes — see the mark-shape notes below) — mirrors the
// "pure, testable in isolation" style of `lib/layerGeometry.ts` / `lib/snapMath.ts`.
//
// Mark shapes (confirmed by reading the installed extension source, not guessed):
//   - `@tiptap/extension-bold`   -> mark `{ type: 'bold' }` (no attrs)
//   - `@tiptap/extension-italic` -> mark `{ type: 'italic' }` (no attrs)
//   - `@tiptap/extension-text-style` + `@tiptap/extension-color` -> mark
//     `{ type: 'textStyle', attrs: { color } }` (Color is a thin global-attribute extension on
//     top of the `textStyle` mark, not its own mark type)
//   - `@tiptap/extension-highlight` (with `multicolor: true`, required for a `color` attr to
//     exist at all) -> mark `{ type: 'highlight', attrs: { color } }`
//   - `@tiptap/extension-hard-break` -> node `{ type: 'hardBreak' }` (Shift+Enter within the
//     editor's single paragraph)
//
// Newline convention (verified against design-render-tree.ts's `runNode`/`textBlockChildren`):
// the render tree treats a literal "\n" character embedded in a layer's `text` OR a run's `text`
// as a real visual line break (`white-space: pre-wrap`). So a TipTap hardBreak node maps to a
// literal "\n" character concatenated into the surrounding run/text string — never a separate
// run, never a paragraph break (this schema is single-paragraph only, design-doc.ts places no
// per-run restriction against an embedded "\n").

import type { FontWeight, NormalizedRun, NormalizedTextLayer } from '../types';

// ============================================================
// Minimal TipTap JSON types (this module's own contract — deliberately not importing
// `@tiptap/core`'s `JSONContent`, since we only ever produce/consume this narrow subset: a doc
// with exactly one paragraph containing text/hardBreak nodes carrying a small known mark set).
// ============================================================

export interface TiptapMark {
  type: 'bold' | 'italic' | 'textStyle' | 'highlight';
  attrs?: { color?: string | null };
}

export interface TiptapTextNode {
  type: 'text';
  text: string;
  marks?: TiptapMark[];
}

export interface TiptapHardBreakNode {
  type: 'hardBreak';
}

export type TiptapInlineNode = TiptapTextNode | TiptapHardBreakNode;

export interface TiptapParagraphNode {
  type: 'paragraph';
  content?: TiptapInlineNode[];
}

export interface TiptapDoc {
  type: 'doc';
  content: TiptapParagraphNode[];
}

/** The result of `tiptapDocToLayerPatch` — matches design-doc.ts's XOR rule: a text layer sets
 * EXACTLY ONE of `text`/`runs`, never both, never neither. */
export type TextLayerPatch = { text: string } | { runs: NormalizedRun[] };

// ============================================================
// layer -> TipTap doc
// ============================================================

/** Splits a string on literal "\n" into inline nodes: plain text segments interleaved with
 * hardBreak nodes (one per newline). A run/layer text of "" produces a single empty text node
 * (never zero nodes) so marks/coalescing has something to attach to; callers that don't want an
 * empty text node (e.g. a fully-empty layer) special-case that themselves. `marks` (if any) is
 * attached to every text segment produced, not to the hardBreak nodes (hardBreak nodes never
 * carry marks in this mapping — matching how design-render-tree.ts applies run-level styling to
 * the whole run string, newlines included, so re-attaching marks per segment on the way back in
 * keeps round-tripping stable). */
function splitIntoInlineNodes(text: string, marks: TiptapMark[] | undefined): TiptapInlineNode[] {
  const parts = text.split('\n');
  const nodes: TiptapInlineNode[] = [];
  parts.forEach((part, i) => {
    const node: TiptapTextNode = { type: 'text', text: part };
    if (marks && marks.length > 0) node.marks = marks;
    nodes.push(node);
    if (i < parts.length - 1) nodes.push({ type: 'hardBreak' });
  });
  return nodes;
}

/** Builds the mark list for one run, relative to its layer's base styling.
 *
 * Bold/italic inference rule (documented per the task brief's request for an explicit, written
 * rule rather than a guessed threshold): a run maps to a `bold` mark ONLY when
 * `run.font_weight` is explicitly set AND is strictly greater than the layer's own base
 * `font_weight` (i.e. the run is deliberately bolder than the layer default) — matching what
 * TipTap's own bold mark implies (a binary "is this bolder than surrounding text" toggle, not an
 * absolute weight value). A run that merely repeats the layer's base weight, or sets a LOWER
 * weight, does NOT get a bold mark (TipTap's StarterKit bold mark is boolean, it cannot encode
 * "lighter than normal" — that's a known v1 lossy edge: a run explicitly set lighter than its
 * layer's base weight round-trips as unstyled/non-bold through the TipTap editor). Italic maps
 * whenever `run.font_style === 'italic'`, regardless of the layer's own base `font_style`
 * (italic is unambiguous either way, no threshold needed). */
function runToMarks(run: NormalizedRun, layer: NormalizedTextLayer): TiptapMark[] {
  const marks: TiptapMark[] = [];
  if (run.font_weight != null && run.font_weight > layer.font_weight) {
    marks.push({ type: 'bold' });
  }
  if (run.font_style === 'italic') {
    marks.push({ type: 'italic' });
  }
  if (run.color) {
    marks.push({ type: 'textStyle', attrs: { color: run.color } });
  }
  if (run.highlight) {
    // Lossy: `highlight.padding_x`/`highlight.radius` have no TipTap-mark equivalent (the
    // `highlight` extension's attrs are just `{ color }`) — dropped here on the way in. They are
    // NOT reconstructed on the way out either (see `marksToRunFields` below), so a run with
    // custom highlight padding/radius loses that styling once edited through this overlay. This
    // is an accepted v1 limitation, not an oversight.
    marks.push({ type: 'highlight', attrs: { color: run.highlight.color } });
  }
  return marks;
}

/** Converts a `NormalizedTextLayer` (exactly one of `text`/`runs` set, per schema) into a
 * single-paragraph TipTap JSON doc. Plain `text` maps with no marks; `runs` map each run to one
 * or more (mark-carrying) text nodes, splitting embedded "\n" characters — in either the plain
 * text OR inside an individual run's text — into hardBreak nodes. */
export function layerToTiptapDoc(layer: NormalizedTextLayer): TiptapDoc {
  let content: TiptapInlineNode[];

  if (layer.runs && layer.runs.length > 0) {
    content = layer.runs.flatMap((run) => splitIntoInlineNodes(run.text, runToMarks(run, layer)));
  } else {
    const text = layer.text ?? '';
    content = text === '' ? [] : splitIntoInlineNodes(text, undefined);
  }

  return { type: 'doc', content: [{ type: 'paragraph', content }] };
}

// ============================================================
// TipTap doc -> layer patch
// ============================================================

/** Stable stringified key for a mark set, used to decide whether two adjacent text nodes are
 * "identically styled" and should be coalesced into one run. Marks are sorted by type first so
 * node authoring order (TipTap doesn't guarantee a canonical mark order) doesn't defeat
 * coalescing. */
function markSetKey(marks: TiptapMark[] | undefined): string {
  if (!marks || marks.length === 0) return '';
  return [...marks]
    .sort((a, b) => a.type.localeCompare(b.type))
    .map((m) => `${m.type}:${m.attrs?.color ?? ''}`)
    .join('|');
}

function marksToRunFields(
  marks: TiptapMark[] | undefined,
): Pick<NormalizedRun, 'font_weight' | 'font_style' | 'color' | 'highlight'> {
  const fields: Pick<NormalizedRun, 'font_weight' | 'font_style' | 'color' | 'highlight'> = {};
  for (const mark of marks ?? []) {
    if (mark.type === 'bold') fields.font_weight = 700;
    else if (mark.type === 'italic') fields.font_style = 'italic';
    else if (mark.type === 'textStyle' && mark.attrs?.color) fields.color = mark.attrs.color;
    else if (mark.type === 'highlight' && mark.attrs?.color) {
      // padding_x/radius are never reconstructed here — see the matching comment in
      // `runToMarks` above; this is the read-back half of that same documented lossy edge.
      fields.highlight = { color: mark.attrs.color };
    }
  }
  return fields;
}

/** Converts a TipTap JSON doc's single paragraph back into a `NormalizedTextLayer` patch.
 * hardBreak nodes become a literal "\n" appended to the run/segment currently being built (never
 * starting a new run) — a run can and should contain embedded "\n" characters, matching
 * design-render-tree.ts's own per-run newline handling. Adjacent text nodes sharing the exact
 * same mark set are coalesced into a single run (TipTap sometimes splits text into multiple
 * nodes for reasons unrelated to styling, e.g. around input rules). If the paragraph has zero
 * marks anywhere, returns `{ text }` (flattened, hardBreaks -> "\n") instead of a single-run
 * `runs` array — matching how a freshly-typed, never-styled layer should round-trip. An empty
 * paragraph (no content, or content with no text) returns `{ text: '' }`. */
export function tiptapDocToLayerPatch(doc: TiptapDoc): TextLayerPatch {
  const paragraph = doc.content[0];
  const inlineNodes = paragraph?.content ?? [];

  if (inlineNodes.length === 0) return { text: '' };

  const anyMarked = inlineNodes.some((n) => n.type === 'text' && (n.marks?.length ?? 0) > 0);

  if (!anyMarked) {
    const flat = inlineNodes.map((n) => (n.type === 'hardBreak' ? '\n' : n.text)).join('');
    return { text: flat };
  }

  // Coalesce: walk nodes, accumulating text (and any embedded hardBreaks as literal "\n") into
  // the current run as long as consecutive TEXT nodes share the same mark set. A hardBreak never
  // breaks a run (it's appended as "\n" to whatever run is currently open) — only a change in
  // mark set (or reaching a text node after having none open) starts a new run.
  const runs: NormalizedRun[] = [];
  let currentText = '';
  let currentMarks: TiptapMark[] | undefined;
  let hasOpenRun = false;

  const flushRun = () => {
    if (!hasOpenRun) return;
    runs.push({ text: currentText, ...marksToRunFields(currentMarks) });
    currentText = '';
    currentMarks = undefined;
    hasOpenRun = false;
  };

  for (const node of inlineNodes) {
    if (node.type === 'hardBreak') {
      // No open run yet (paragraph started with a hardBreak) -- open an unmarked run to hold it.
      if (!hasOpenRun) {
        hasOpenRun = true;
        currentMarks = undefined;
      }
      currentText += '\n';
      continue;
    }
    const key = markSetKey(node.marks);
    if (hasOpenRun && markSetKey(currentMarks) === key) {
      currentText += node.text;
    } else {
      flushRun();
      hasOpenRun = true;
      currentMarks = node.marks;
      currentText = node.text;
    }
  }
  flushRun();

  // A run must have non-empty text per design-doc.ts's `Run` schema (`text: z.string().min(1)`)
  // -- an empty text node (e.g. `{type:'text', text:''}` that TipTap occasionally leaves behind)
  // would otherwise produce an invalid zero-length run; drop empties defensively. Doesn't apply
  // to the plain-`text` fast path above, which has no such constraint.
  const nonEmptyRuns = runs.filter((r) => r.text.length > 0);
  if (nonEmptyRuns.length === 0) return { text: '' };
  return { runs: nonEmptyRuns };
}

// ============================================================
// Font-variant clamping — a SEPARATE pass from tiptapDocToLayerPatch above (deliberately not
// folded into it: mapping TipTap marks to run fields and validating those fields against a font's
// actually-shipped variants are different concerns, and this module stays free of any font-
// manifest import per its own "no React, no DOM" header contract — the caller injects variant
// availability instead, matching this codebase's established DI pattern for cross-cutting lookups
// (e.g. `layerGeometry.ts`'s injected `GetTextHeight`).
//
// WHY THIS EXISTS: TipTap's Bold/Italic marks are unconditional UI affordances (Mod-b/Mod-i always
// work) with no awareness of which (weight, style) variants the layer's current `font_key` actually
// ships. `design-doc.ts`'s Stage-1 validation only inspects a TEXT LAYER'S OWN `font_weight`/
// `font_style` fields for the `unsupported_font_variant` rule — it never walks `layer.runs[]` — so
// a run-level override pointing at a variant the font doesn't have saves clean and only fails later,
// at render time (both `useFontManifest.ts`'s `findVariant`/`loadVariantEntries` client-side and
// `design-render-core.ts`'s `loadFontEntries` server-side throw on an unknown variant), which is a
// last-render crash with no way to undo from the UI. Clamping BEFORE commit prevents this doc from
// ever reaching a saved/persisted state in the first place.
// ============================================================

/** Whether `(weight, style)` is an actually-shipped variant of some font — the shape TextEditOverlay
 * passes in, backed by `useFontManifest.ts`'s `findFontFile` (same manifest lookup satori/render
 * already use, so "clamped" and "renderable" always agree). */
export type HasFontVariant = (weight: FontWeight, style: 'normal' | 'italic') => boolean;

/** Strips a run's `font_weight`/`font_style` override back to "inherit the layer's base" (`undefined`
 * — `design-render-tree.ts`'s `run.font_weight ?? layer.font_weight` / `run.font_style ??
 * layer.font_style` already treats an absent run field this way) whenever the run, AS WRITTEN, would
 * point at a `(weight, style)` combination `hasVariant` says the layer's `font_key` doesn't actually
 * ship. The layer's OWN base `font_weight`/`font_style` is never touched here — only per-run
 * overrides, which is the only place `design-doc.ts`'s validation has a blind spot (see header
 * comment above). A `{ text }` patch (no runs at all) passes through unchanged — nothing to clamp. */
export function clampPatchToAvailableFonts(
  patch: TextLayerPatch,
  layer: NormalizedTextLayer,
  hasVariant: HasFontVariant,
): TextLayerPatch {
  if ('text' in patch) return patch;

  const clamped = patch.runs.map((run): NormalizedRun => {
    let font_weight = run.font_weight;
    let font_style = run.font_style;

    if (
      font_weight != null &&
      !hasVariant(font_weight, font_style ?? layer.font_style ?? 'normal')
    ) {
      font_weight = undefined;
    }
    if (font_style === 'italic' && !hasVariant(font_weight ?? layer.font_weight, 'italic')) {
      font_style = undefined;
    }

    return font_weight === run.font_weight && font_style === run.font_style
      ? run
      : { ...run, font_weight, font_style };
  });

  return { runs: clamped };
}
