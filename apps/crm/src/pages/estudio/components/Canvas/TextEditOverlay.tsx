// T2.8 TextEditOverlay (docs/estudio-design.md §6.4 "text editing overlay"). A MINIMAL TipTap
// instance — single paragraph + hard-break + bold/italic/color/highlight marks, mapped 1:1 to
// `runs` on commit (plain `text` when unstyled, via `runsMapping.ts`'s `tiptapDocToLayerPatch`).
//
// EXTENSION SET is deliberately hand-picked, NOT `StarterKit` wholesale — StarterKit ships
// heading/blockquote/bulletList/orderedList/codeBlock/horizontalRule/etc, none of which this
// doc's schema (single-paragraph, text+hardBreak only) can represent, and several of those
// (Heading in particular) install markdown-shortcut input rules ("# " -> heading) that would
// silently corrupt what's actually just plain text content. See
// `__tests__/TextEditOverlay.test.tsx`'s "does not convert markdown shortcuts" test — the
// regression guard that this constraint actually holds.
//
// POSITIONING replicates InteractionOverlay.tsx's existing gesture-ghost div pattern EXACTLY
// (see that file's render() "gesture-ghost" block): position:absolute, left/top from
// `canvasToScreen(bbox.x, bbox.y)`, width `bbox.w * scale`, height AUTO (never clipped — while
// editing, content can be temporarily taller/shorter than the last-measured height, and text
// layers have no schema `h` to begin with), `transform: rotate(${rotation}deg)` with the
// DEFAULT/unset (center) transform-origin — the verified rotation convention for this codebase.
// Do NOT use getRotatedCorners/AABB polygon math here (that's LayerHandles.tsx's different
// technique, for drawing a rotated OUTLINE polygon, not for positioning a live DOM overlay).
//
// COMMIT/CANCEL LIFECYCLE mirrors InteractionOverlay.tsx's `endGesture()` idempotency pattern —
// multiple event sources (Enter, blur, window-level cleanup) might all try to end the same edit
// session, so a `committedOrCancelledRef` guard (analogous to that file's gestureRef-nulling)
// ensures `onCommit`/`onCancel` each fire AT MOST ONCE per mounted session, matching design.md
// §6.2's "one step per session" discipline (exactly analogous to drag/resize's "one
// onUpdateLayer per gesture").
import { useEffect, useMemo, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Document } from '@tiptap/extension-document';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { HardBreak } from '@tiptap/extension-hard-break';
import { Bold } from '@tiptap/extension-bold';
import { Italic } from '@tiptap/extension-italic';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import { Slice, Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { findFamily, findFontFile } from '../../hooks/useFontManifest';
import {
  clampPatchToAvailableFonts,
  layerToTiptapDoc,
  tiptapDocToLayerPatch,
  type TiptapDoc,
} from '../../lib/runsMapping';
import type { CanvasPoint } from '../../hooks/useCanvasTransform';
import type { LayerBBox } from '../../lib/layerGeometry';
import type { NormalizedRun, NormalizedTextLayer } from '../../types';

// The doc schema is single-paragraph only — stock Document (`block+`) would let a multi-line
// paste create additional paragraphs that the commit mapping (doc.content[0]) silently drops.
const SingleParagraphDocument = Document.extend({ content: 'paragraph' });

// Bold with the run's REAL weight riding along (runsMapping.ts's `runToMarks` emits
// `{ type: 'bold', attrs: { weight } }`): without a declared attribute TipTap strips unknown
// attrs on load, collapsing a 600/800 bold run to the hardcoded default and silently restyling
// it on the next commit. `renderHTML` also makes the editable text show its true weight.
const BoldWithWeight = Bold.extend({
  addAttributes() {
    return {
      weight: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const w = parseInt(element.style.fontWeight || '', 10);
          return Number.isFinite(w) ? w : null;
        },
        renderHTML: (attributes: { weight?: number | null }) =>
          attributes.weight ? { style: `font-weight: ${attributes.weight}` } : {},
      },
    };
  },
});

/** Flattens a pasted slice's textblocks into one hardBreak-joined inline sequence, so a
 * multi-paragraph paste becomes visual line breaks inside the single allowed paragraph instead
 * of blocks the schema can't hold (ProseMirror would otherwise join them with NO separator,
 * gluing lines together). Inline-only slices (ordinary within-paragraph copy) pass through via
 * the textblock walk too — a single block just contributes its content with no separator. */
function flattenPastedBlocks(slice: Slice, hardBreak: () => PMNode): Slice {
  const inline: PMNode[] = [];
  let sawTextblock = false;
  slice.content.descendants((node) => {
    if (node.isTextblock) {
      if (sawTextblock) inline.push(hardBreak());
      sawTextblock = true;
      node.content.forEach((child) => inline.push(child));
      return false;
    }
    return true;
  });
  if (!sawTextblock) return slice;
  return new Slice(Fragment.from(inline), 0, 0);
}

export interface TextEditOverlayProps {
  layer: NormalizedTextLayer;
  /** The layer's CURRENT (pre-rotation) canvas-space box — from `getLayerBBox`, NOT a rotated
   * AABB (see this file's header comment on the positioning technique). */
  bbox: LayerBBox;
  scale: number;
  canvasToScreen: (x: number, y: number) => CanvasPoint;
  onCommit: (patch: { text: string } | { runs: NormalizedRun[] }) => void;
  onCancel: () => void;
}

/** Registers (or reuses) a `document.fonts` `FontFace` for the layer's exact (font_key,
 * font_weight, font_style) so the contenteditable's `font-family` below actually resolves to the
 * SAME TTF satori rendered with, rather than silently falling back to a generic sans-serif. Keyed
 * by a synthetic per-variant family name (`estudio-edit-{key}-{weight}-{style}`) so switching
 * between two differently-styled text layers never collides with a previously-registered face for
 * a different variant. Best-effort: swallows load failures (a slow/broken font fetch degrades to
 * the browser's fallback glyph, not a crash of the edit session). */
function useEditorFontFace(
  fontKey: string,
  weight: NormalizedTextLayer['font_weight'],
  style: 'normal' | 'italic',
): string {
  const familyName = useMemo(
    () => `estudio-edit-${fontKey}-${weight}-${style}`.replace(/[^a-zA-Z0-9-]/g, '_'),
    [fontKey, weight, style],
  );

  useEffect(() => {
    if (typeof document === 'undefined' || !('fonts' in document)) return;
    const file = findFontFile(fontKey, weight, style);
    if (!file) return;

    const alreadyRegistered = Array.from(document.fonts).some(
      (f) => f.family === familyName && f.status !== 'error',
    );
    if (alreadyRegistered) return;

    const face = new FontFace(familyName, `url(${file.path})`, { style });
    document.fonts.add(face);
    face.load().catch(() => {
      // Best-effort visual fidelity only — see header comment.
    });
  }, [familyName, fontKey, weight, style]);

  return familyName;
}

export function TextEditOverlay({
  layer,
  bbox,
  scale,
  canvasToScreen,
  onCommit,
  onCancel,
}: TextEditOverlayProps) {
  // Guards against double-firing onCommit/onCancel when multiple event sources (Enter, blur,
  // unmount cleanup) race to end the same edit session — mirrors InteractionOverlay.tsx's
  // `endGesture()` idempotency pattern (gestureRef nulled synchronously before any dispatch).
  const settledRef = useRef(false);

  const editorFamily = useEditorFontFace(
    layer.font_key,
    layer.font_weight,
    layer.font_style ?? 'normal',
  );

  // Family-aware weight for a bold mark freshly toggled via Mod-b (no `weight` attr yet): the
  // smallest shipped normal-style weight bolder than the layer's base. Families whose bold is
  // 600 or 800 get THAT instead of a hardcoded 700 they may not ship; a family with nothing
  // bolder resolves undefined and bold becomes a no-op rather than an unrenderable override.
  const boldWeight = useMemo(() => {
    const family = findFamily(layer.font_key);
    if (!family) return undefined;
    return family.variants
      .filter((v) => v.style === 'normal' && v.weight > layer.font_weight)
      .map((v) => v.weight as NormalizedTextLayer['font_weight'])
      .sort((a, b) => a - b)[0];
  }, [layer.font_key, layer.font_weight]);

  // TipTap's Bold/Italic marks (Mod-b/Mod-i) have no awareness of which variants `layer.font_key`
  // actually ships — clamping here, right before the patch ever reaches onCommit/the reducer,
  // prevents an unrenderable per-run (weight, style) combo from ever being saved (design-doc.ts's
  // validation only checks the LAYER's own font_weight/font_style, never per-run overrides — see
  // runsMapping.ts's clampPatchToAvailableFonts header comment for the full crash scenario this
  // prevents).
  const buildPatch = (doc: TiptapDoc) =>
    clampPatchToAvailableFonts(
      tiptapDocToLayerPatch(doc, { boldWeight }),
      layer,
      (weight, style) => findFontFile(layer.font_key, weight, style) !== undefined,
    );

  const commit = (doc: TiptapDoc) => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCommit(buildPatch(doc));
  };

  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  };

  const editor = useEditor(
    {
      extensions: [
        SingleParagraphDocument,
        Paragraph,
        Text,
        HardBreak,
        BoldWithWeight,
        Italic,
        TextStyle,
        Color,
        Highlight.configure({ multicolor: true }),
      ],
      content: layerToTiptapDoc(layer),
      autofocus: 'end',
      editorProps: {
        attributes: {
          'data-testid': 'text-edit-overlay-editor',
        },
        transformPasted: (slice, view) =>
          flattenPastedBlocks(slice, () => view.state.schema.nodes.hardBreak.create()),
        handleKeyDown: (view, event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            commit(view.state.doc.toJSON() as TiptapDoc);
            return true;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
            return true;
          }
          return false;
        },
      },
    },
    [],
  );

  // Blur commits — UNLESS the session was already settled by Enter/Escape in the same tick (the
  // `settledRef` guard above makes a subsequent commit()/cancel() call here a safe no-op).
  useEffect(() => {
    if (!editor) return;
    const handleBlur = () => {
      commit(editor.state.doc.toJSON() as TiptapDoc);
    };
    editor.on('blur', handleBlur);
    return () => {
      editor.off('blur', handleBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Unmount safety net: if this overlay is torn down from OUTSIDE (e.g. the layer was deselected
  // or removed while editing — see InteractionOverlay.tsx's defensive cleanup), commit whatever
  // was typed rather than silently discarding it, unless the session already settled via
  // Enter/Escape/blur.
  useEffect(() => {
    return () => {
      if (settledRef.current || !editor) return;
      settledRef.current = true;
      onCommit(buildPatch(editor.state.doc.toJSON() as TiptapDoc));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const screenPos = canvasToScreen(bbox.x, bbox.y);

  const style: React.CSSProperties = {
    position: 'absolute',
    left: screenPos.x,
    top: screenPos.y,
    width: bbox.w * scale,
    height: 'auto',
    transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
    fontFamily: `${editorFamily}, ${layer.font_key}, sans-serif`,
    fontWeight: layer.font_weight,
    fontStyle: layer.font_style ?? 'normal',
    fontSize: layer.font_size * scale,
    lineHeight: layer.line_height,
    letterSpacing: layer.letter_spacing * scale,
    textAlign: layer.align,
    color: layer.color,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    outline: '1.5px solid var(--primary-color, #eab308)',
    outlineOffset: 2,
    background: 'rgba(255,255,255,0.02)',
    cursor: 'text',
    // Text-edit mode is a modal takeover of this layer — no drag/resize gesture should be
    // startable while typing (Part B wires this in by rendering TextEditOverlay INSTEAD OF the
    // drag hit-area/LayerHandles, but stopping propagation here too is cheap defense-in-depth).
  };

  return (
    <div
      data-testid="text-edit-overlay"
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
