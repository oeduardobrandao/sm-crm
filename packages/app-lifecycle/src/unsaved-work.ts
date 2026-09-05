/**
 * Work in progress that a silent reload would destroy.
 *
 * Two layers. `holdUnsavedWork` is the explicit one: an editor with unsaved input, a save
 * in flight or an upload holds while that is true. `isDocumentBusy` is the safety net for
 * surfaces nobody registered: it reads the DOM for an open dialog, a focused editable or an
 * editor with content. Every reload trigger (navigation, hidden tab, idle) consults both, so
 * an editor shipped without the hook fails closed everywhere.
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

/**
 * True when reloading now would plausibly lose something: an open dialog (Radix Dialog,
 * Sheet and AlertDialog all render `role="dialog"` or `role="alertdialog"`), a focused
 * editable, or a textarea / contenteditable with content. Deliberately conservative.
 */
export function isDocumentBusy(doc: Document = document): boolean {
  if (doc.querySelector('[role="dialog"], [role="alertdialog"]')) return true;
  if (isEditable(doc.activeElement)) return true;
  for (const el of doc.querySelectorAll('textarea')) {
    if (el.value.trim() !== '') return true;
  }
  for (const el of doc.querySelectorAll('[contenteditable]:not([contenteditable="false"])')) {
    if ((el.textContent ?? '').trim() !== '') return true;
  }
  return false;
}

/** Test seam: forget every hold. */
export function resetUnsavedWorkForTests(): void {
  holds = 0;
}
