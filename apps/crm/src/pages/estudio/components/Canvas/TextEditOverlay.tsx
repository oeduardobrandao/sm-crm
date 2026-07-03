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
import { findFontFile } from '../../hooks/useFontManifest';
import {
  clampPatchToAvailableFonts,
  layerToTiptapDoc,
  tiptapDocToLayerPatch,
  type TiptapDoc,
} from '../../lib/runsMapping';
import type { CanvasPoint } from '../../hooks/useCanvasTransform';
import type { LayerBBox } from '../../lib/layerGeometry';
import type { NormalizedRun, NormalizedTextLayer } from '../../types';

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

  // TipTap's Bold/Italic marks (Mod-b/Mod-i) have no awareness of which variants `layer.font_key`
  // actually ships — clamping here, right before the patch ever reaches onCommit/the reducer,
  // prevents an unrenderable per-run (weight, style) combo from ever being saved (design-doc.ts's
  // validation only checks the LAYER's own font_weight/font_style, never per-run overrides — see
  // runsMapping.ts's clampPatchToAvailableFonts header comment for the full crash scenario this
  // prevents).
  const commit = (doc: TiptapDoc) => {
    if (settledRef.current) return;
    settledRef.current = true;
    const patch = clampPatchToAvailableFonts(
      tiptapDocToLayerPatch(doc),
      layer,
      (weight, style) => findFontFile(layer.font_key, weight, style) !== undefined,
    );
    onCommit(patch);
  };

  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  };

  const editor = useEditor(
    {
      extensions: [
        Document,
        Paragraph,
        Text,
        HardBreak,
        Bold,
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
      const patch = clampPatchToAvailableFonts(
        tiptapDocToLayerPatch(editor.state.doc.toJSON() as TiptapDoc),
        layer,
        (weight, style) => findFontFile(layer.font_key, weight, style) !== undefined,
      );
      onCommit(patch);
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
