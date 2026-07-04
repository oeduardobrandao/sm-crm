// T7.3 keyboard shortcuts (docs/estudio-plan.md slice 7). A window-level keydown listener that
// drives the same reducer the pointer gestures/toolbar use — so every shortcut is one undo step,
// exactly like a mouse action. The hook owns NO document state of its own; it reads the current
// selection/active page and dispatches `layer/*` actions.
//
// Two hard rules keep it from fighting the rest of the editor:
//   1. It's inert while the user is typing — the in-canvas text overlay (`isTextEditing`) OR any
//      focused input/textarea/select/contenteditable (toolbar fields, panels). Otherwise Delete
//      would nuke a layer mid-caption and arrows would fight the caret.
//   2. Locked layers are immovable: Delete and arrow-nudge skip them (duplicate still copies them,
//      since copying is non-destructive).
import { useEffect, useRef } from 'react';
import { generateDesignId } from '../types';
import type { NormalizedLayer, NormalizedPage } from '../types';
import type { DesignDocAction } from './useDesignDocState';

/** A nudge burst held down / hammered inside this window collapses into a single undo entry; a
 * pause longer than this opens a fresh one. */
const NUDGE_COALESCE_IDLE_MS = 600;
const NUDGE_STEP = 1;
const NUDGE_STEP_LARGE = 10;
/** Offset a Cmd/Ctrl+D duplicate by this much so the copy is visibly "next to" the original. */
const DUPLICATE_OFFSET = 20;

export interface UseEditorShortcutsArgs {
  activePage: NormalizedPage | undefined;
  activePageId: string;
  selection: string[];
  dispatch: (action: DesignDocAction) => void;
  select: (selection: string[]) => void;
  undo: () => void;
  redo: () => void;
  /** True while the in-canvas TextEditOverlay owns the keyboard — the whole hook goes inert. */
  isTextEditing: boolean;
  /** Mount guard: only listen while the editor doc is actually loaded. */
  enabled?: boolean;
}

/** "Texto 1" → "Texto 1 cópia" → "Texto 1 cópia 2" → "Texto 1 cópia 3" (no "cópia cópia" pileup). */
export function duplicateLayerName(name: string): string {
  const match = name.match(/^(.*) cópia(?: (\d+))?$/);
  if (match) {
    const next = match[2] ? parseInt(match[2], 10) + 1 : 2;
    return `${match[1]} cópia ${next}`;
  }
  return `${name} cópia`;
}

function isEditableTarget(node: EventTarget | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  const tag = node.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return node.isContentEditable;
}

export function useEditorShortcuts({
  activePage,
  activePageId,
  selection,
  dispatch,
  select,
  undo,
  redo,
  isTextEditing,
  enabled = true,
}: UseEditorShortcutsArgs): void {
  // Everything the handler reads lives behind a ref so the window listener can be registered ONCE
  // (empty deps) and never miss the latest selection/page — re-subscribing on every doc change
  // would drop keystrokes landing between renders.
  const latest = useRef({
    activePage,
    activePageId,
    selection,
    dispatch,
    select,
    undo,
    redo,
    isTextEditing,
    enabled,
  });
  latest.current = {
    activePage,
    activePageId,
    selection,
    dispatch,
    select,
    undo,
    redo,
    isTextEditing,
    enabled,
  };

  // Nudge-burst session: a monotonically-bumped counter that stays fixed while arrows fire back to
  // back, and increments after an idle gap so the next burst is its own undo step.
  const nudge = useRef({ seq: 0, lastAt: 0 });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const s = latest.current;
      if (!s.enabled || s.isTextEditing) return;
      // A focused field owns its own keys (toolbar number inputs, color hex, panel search…).
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;

      const primary = e.metaKey || e.ctrlKey;

      // Undo / redo — doc-level, so they fire regardless of selection.
      if (primary && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (primary && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        s.redo();
        return;
      }

      const page = s.activePage;
      const selectedLayers: NormalizedLayer[] =
        page?.layers.filter((l) => s.selection.includes(l.id)) ?? [];

      // Duplicate — copies EVERY selected layer (locked included; copying is non-destructive),
      // offset so the copy is visibly on top of the original, and selects the copies.
      if (primary && (e.key === 'd' || e.key === 'D')) {
        if (selectedLayers.length === 0) return;
        e.preventDefault();
        const cloneIds: string[] = [];
        for (const layer of selectedLayers) {
          const id = generateDesignId('layer');
          cloneIds.push(id);
          s.dispatch({
            type: 'layer/add',
            pageId: s.activePageId,
            layer: {
              ...layer,
              id,
              name: duplicateLayerName(layer.name),
              x: layer.x + DUPLICATE_OFFSET,
              y: layer.y + DUPLICATE_OFFSET,
            },
          });
        }
        s.select(cloneIds);
        return;
      }

      if (selectedLayers.length === 0) {
        // Escape/Delete/arrows with nothing selected: let the browser have the key.
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        s.select([]);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        for (const layer of selectedLayers) {
          if (layer.locked) continue;
          s.dispatch({ type: 'layer/remove', pageId: s.activePageId, layerId: layer.id });
        }
        return;
      }

      const step = e.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
      let dx = 0;
      let dy = 0;
      switch (e.key) {
        case 'ArrowLeft':
          dx = -step;
          break;
        case 'ArrowRight':
          dx = step;
          break;
        case 'ArrowUp':
          dy = -step;
          break;
        case 'ArrowDown':
          dy = step;
          break;
        default:
          return;
      }
      e.preventDefault();
      const movable = selectedLayers.filter((l) => !l.locked);
      if (movable.length === 0) return;
      // One coalesce key per burst: consecutive nudges (and every layer within a single multi-
      // select keypress) collapse into ONE undo entry.
      const now = Date.now();
      if (now - nudge.current.lastAt > NUDGE_COALESCE_IDLE_MS) nudge.current.seq += 1;
      nudge.current.lastAt = now;
      const coalesceKey = `nudge-${nudge.current.seq}`;
      for (const layer of movable) {
        s.dispatch({
          type: 'layer/update',
          pageId: s.activePageId,
          layerId: layer.id,
          patch: { x: layer.x + dx, y: layer.y + dy },
          coalesceKey,
        });
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
