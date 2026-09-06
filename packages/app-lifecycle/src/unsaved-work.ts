/**
 * Work in progress that a silent reload would destroy.
 *
 * Two layers. `holdUnsavedWork` is the explicit one: an editor with unsaved input, a save
 * in flight or an upload holds while that is true. `isDocumentBusy` is the safety net for
 * surfaces nobody registered: it reads the DOM for an open dialog, a focused editable or a
 * form control the user changed (typed, picked, toggled), until it leaves the DOM. Every
 * reload trigger (navigation, hidden tab, idle) consults both, so an editor shipped without
 * the hook fails closed everywhere.
 */

let holds = 0;

/** Hold the registry. Returns the release; releasing twice is a no-op. */
export function holdUnsavedWork(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
  };
}

export function hasUnsavedWork(): boolean {
  return holds > 0;
}

/** An upload that has not settled by then is presumed hung; no legitimate one takes this long. */
const TRACK_MAX_MS = 30 * 60_000;

/**
 * Hold the registry until `work` settles, resolving or rejecting exactly like it. The hold
 * is capped at `maxMs`: a request that never settles (an XHR without a timeout on a stalled
 * connection) must not disable the passive reload triggers for the rest of the tab's life.
 * Takes a real Promise: wrap a builder-style thenable (supabase-js query builders) in
 * Promise.resolve(...) first.
 */
export function trackUnsavedWork<T>(work: Promise<T>, maxMs = TRACK_MAX_MS): Promise<T> {
  const release = holdUnsavedWork();
  const ceiling = setTimeout(release, maxMs);
  return work.finally(() => {
    clearTimeout(ceiling);
    release();
  });
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'password']);

function isContentEditable(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  // jsdom does not implement `isContentEditable`; per HTML, a bare `contenteditable` or an
  // empty value also means editable. TipTap sets "true".
  if (el.isContentEditable === true) return true;
  const attr = el.getAttribute('contenteditable');
  return attr !== null && attr.toLowerCase() !== 'false';
}

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type);
  return isContentEditable(el);
}

const NON_EDIT_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'file', 'hidden', 'image']);

/** Any form control whose value the user can change, plus contenteditable hosts. */
function isFormControl(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !NON_EDIT_INPUT_TYPES.has(el.type);
  return isContentEditable(el);
}

/** Form controls the user changed (typed, picked, toggled), kept until they leave the DOM. */
const touched = new Set<Element>();

/**
 * Start recording user edits: a capture-phase listener on `input` and `change` marks its
 * target when it is a form control the user changed. Pre-filled content never counts; a real
 * edit fails closed until the control unmounts. Returns the stop function.
 */
export function trackDocumentEdits(doc: Document = document): () => void {
  const onChange = (event: Event) => {
    const target = event.target;
    if (target instanceof Element && isFormControl(target)) touched.add(target);
  };
  doc.addEventListener('input', onChange, { capture: true, passive: true });
  doc.addEventListener('change', onChange, { capture: true, passive: true });
  return () => {
    doc.removeEventListener('input', onChange, { capture: true });
    doc.removeEventListener('change', onChange, { capture: true });
  };
}

function hasTouchedEditable(): boolean {
  for (const el of touched) {
    if (!el.isConnected) touched.delete(el);
  }
  return touched.size > 0;
}

/**
 * True when reloading now would plausibly lose something: an open dialog (Radix Dialog,
 * Sheet and AlertDialog all render `role="dialog"` or `role="alertdialog"`), a focused
 * editable, or a form control the user changed (typed, picked, toggled). Deliberately
 * conservative.
 */
export function isDocumentBusy(doc: Document = document): boolean {
  if (doc.querySelector('[role="dialog"], [role="alertdialog"]')) return true;
  if (isEditable(doc.activeElement)) return true;
  if (hasTouchedEditable()) return true;
  return false;
}

/** Test seam: forget every hold. */
export function resetUnsavedWorkForTests(): void {
  holds = 0;
  touched.clear();
}
