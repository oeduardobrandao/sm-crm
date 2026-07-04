// Single reducer atom for the editor's document state (docs/estudio-design.md §6.2):
// `{ doc, past[], future[], selection, activePage }`. Every mutating action is ONE undo step —
// callers (drag/resize overlays, the text-edit overlay, toolbar actions) are responsible for
// only dispatching once a gesture/edit session actually commits, never per intermediate frame;
// this hook has no notion of "transient" updates, by design (docs/estudio-design.md §6.2:
// "dispatch once on pointer-up" / "commit on blur/Enter" are the callers' job, not this atom's).
import { useCallback, useMemo, useReducer } from 'react';
import * as ops from '../lib/designDocOps';
import type { DesignDoc, NormalizedFill, NormalizedLayer, NormalizedPage } from '../types';

export const MAX_UNDO = 50;

export interface DesignDocState {
  doc: DesignDoc;
  past: DesignDoc[];
  future: DesignDoc[];
  /** Layer ids selected on the active page. */
  selection: string[];
  activePageId: string;
}

export type DesignDocAction =
  | { type: 'layer/add'; pageId: string; layer: NormalizedLayer; index?: number }
  | { type: 'layer/update'; pageId: string; layerId: string; patch: Partial<NormalizedLayer> }
  | { type: 'layer/remove'; pageId: string; layerId: string }
  | { type: 'layer/duplicate'; pageId: string; layerId: string }
  | { type: 'layer/reorder'; pageId: string; layerId: string; toIndex: number }
  | { type: 'page/background'; pageId: string; background: NormalizedFill }
  | { type: 'page/add'; page: NormalizedPage; index?: number }
  | { type: 'page/duplicate'; pageId: string }
  | { type: 'page/remove'; pageId: string }
  | { type: 'page/reorder'; fromIndex: number; toIndex: number }
  | { type: 'select'; selection: string[] }
  | { type: 'activePage/set'; pageId: string }
  | { type: 'load'; doc: DesignDoc }
  /** Autosave's server-normalized doc adoption (design §6.2): swaps the doc IN PLACE — no undo
   * entry (normalization is not a user edit), history/selection/active page all preserved. The
   * exact `action.doc` reference is stored so the autosave hook can recognize its own adoption
   * (`state.doc === adoptedDoc`) and not count it as a new local generation. */
  | { type: 'doc/adopt'; doc: DesignDoc }
  | { type: 'undo' }
  | { type: 'redo' };

type MutatingAction = Extract<DesignDocAction, { type: `layer/${string}` | `page/${string}` }>;

function applyOp(doc: DesignDoc, action: MutatingAction): DesignDoc {
  switch (action.type) {
    case 'layer/add':
      return ops.addLayer(doc, action.pageId, action.layer, action.index);
    case 'layer/update':
      return ops.updateLayer(doc, action.pageId, action.layerId, action.patch);
    case 'layer/remove':
      return ops.removeLayer(doc, action.pageId, action.layerId);
    case 'layer/duplicate':
      return ops.duplicateLayer(doc, action.pageId, action.layerId);
    case 'layer/reorder':
      return ops.reorderLayer(doc, action.pageId, action.layerId, action.toIndex);
    case 'page/background':
      return ops.setPageBackground(doc, action.pageId, action.background);
    case 'page/add':
      return ops.addPage(doc, action.page, action.index);
    case 'page/duplicate':
      return ops.duplicatePage(doc, action.pageId);
    case 'page/remove':
      return ops.removePage(doc, action.pageId);
    case 'page/reorder':
      return ops.reorderPages(doc, action.fromIndex, action.toIndex);
  }
}

function isMutating(action: DesignDocAction): action is MutatingAction {
  return action.type.startsWith('layer/') || action.type.startsWith('page/');
}

export function initDesignDocState(doc: DesignDoc): DesignDocState {
  return { doc, past: [], future: [], selection: [], activePageId: doc.pages[0]?.id ?? '' };
}

export function designDocReducer(state: DesignDocState, action: DesignDocAction): DesignDocState {
  if (isMutating(action)) {
    const nextDoc = applyOp(state.doc, action);
    // designDocOps contract: same reference back means "nothing to do" — no undo entry.
    if (nextDoc === state.doc) return state;
    return {
      doc: nextDoc,
      past: [...state.past, state.doc].slice(-MAX_UNDO),
      future: [],
      // A page/remove may have taken the active page with it — fall back to the first
      // remaining page rather than pointing at a page id that no longer exists.
      activePageId: nextDoc.pages.some((p) => p.id === state.activePageId)
        ? state.activePageId
        : (nextDoc.pages[0]?.id ?? ''),
      // Drop any selected id that no longer exists anywhere in the doc (removed layer/page).
      selection: state.selection.filter((id) =>
        nextDoc.pages.some((p) => p.layers.some((l) => l.id === id)),
      ),
    };
  }

  switch (action.type) {
    case 'load':
      return initDesignDocState(action.doc);
    case 'doc/adopt':
      return {
        ...state,
        doc: action.doc,
        // Stale ids are impossible in practice (normalization never adds/removes layers or
        // pages), but filter defensively so a bad adoption can't leave phantom selection.
        selection: state.selection.filter((id) =>
          action.doc.pages.some((p) => p.layers.some((l) => l.id === id)),
        ),
        activePageId: action.doc.pages.some((p) => p.id === state.activePageId)
          ? state.activePageId
          : (action.doc.pages[0]?.id ?? ''),
      };
    case 'select':
      return { ...state, selection: action.selection };
    case 'activePage/set':
      return state.activePageId === action.pageId
        ? state
        : { ...state, activePageId: action.pageId };
    case 'undo': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        ...state,
        doc: previous,
        past: state.past.slice(0, -1),
        future: [state.doc, ...state.future],
      };
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        ...state,
        doc: next,
        past: [...state.past, state.doc].slice(-MAX_UNDO),
        future: state.future.slice(1),
      };
    }
  }
}

export function useDesignDocState(initialDoc: DesignDoc) {
  const [state, dispatch] = useReducer(designDocReducer, initialDoc, initDesignDocState);

  const canUndo = state.past.length > 0;
  const canRedo = state.future.length > 0;
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const select = useCallback((selection: string[]) => dispatch({ type: 'select', selection }), []);
  const setActivePage = useCallback(
    (pageId: string) => dispatch({ type: 'activePage/set', pageId }),
    [],
  );
  const load = useCallback((doc: DesignDoc) => dispatch({ type: 'load', doc }), []);

  return useMemo(
    () => ({ ...state, dispatch, canUndo, canRedo, undo, redo, select, setActivePage, load }),
    [state, canUndo, canRedo, undo, redo, select, setActivePage, load],
  );
}
