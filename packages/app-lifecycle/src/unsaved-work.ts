/**
 * Work in progress that a silent reload would destroy.
 *
 * Two layers. `holdUnsavedWork` is the explicit one: an editor with unsaved input, a save
 * in flight or an upload holds while that is true. `isDocumentBusy` is the safety net for
 * surfaces nobody registered: it reads the DOM for an open dialog, a focused editable or an
 * editor with content. The passive reload triggers (hidden tab, idle) consult both, so an
 * editor shipped without the hook fails closed. The navigation trigger consults only the
 * registry: leaving an unregistered editor by navigation already discards its content today.
 */

let holds = 0;

/** Hold the registry. Returns the release; releasing twice is a no-op. */
export function holdUnsavedWork(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
  };
}

export function hasUnsavedWork(): boolean {
  return holds > 0;
}

/** Hold the registry until `work` settles, resolving or rejecting exactly like it. */
export function trackUnsavedWork<T>(work: Promise<T>): Promise<T> {
  const release = holdUnsavedWork();
  return work.finally(release);
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'password']);

function isContentEditable(el: Element): boolean {
  // jsdom does not implement `isContentEditable`; the attribute is what TipTap sets anyway.
  return (
    el instanceof HTMLElement &&
    (el.isContentEditable === true || el.getAttribute('contenteditable') === 'true')
  );
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
  for (const el of doc.querySelectorAll('[contenteditable="true"]')) {
    if ((el.textContent ?? '').trim() !== '') return true;
  }
  return false;
}

/** Test seam: forget every hold. */
export function resetUnsavedWorkForTests(): void {
  holds = 0;
}
