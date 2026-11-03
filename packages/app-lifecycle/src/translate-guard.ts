/**
 * Keeps browser page translation (Chrome's Google Translate, Edge, extensions) from crashing
 * React into the "Algo deu errado" error screen.
 *
 * Translation replaces each text node it translates with its own `<font>` elements. React
 * still holds the original text node, so the next update that removes it, or inserts next to
 * it, calls `removeChild`/`insertBefore` with a node that is no longer a child of that parent,
 * and the DOM throws `NotFoundError`. Changing a post's date did it every time for a user
 * running the CRM in English with Chrome translating it back to Portuguese
 * (facebook/react#11538).
 *
 * The guard only acts when the node already moved, which never happens without a third party
 * editing the DOM: removing it becomes a no-op, and inserting before it appends instead of
 * dropping the new content. The translated text can linger next to React's fresh output until
 * the translator runs again, which is a far better failure than losing the page.
 */

let uninstallCurrent: (() => void) | undefined;

/** Patches `Node.prototype` once. Returns a function that restores it (for tests). */
export function installTranslateGuard(): () => void {
  if (typeof Node !== 'function') return () => {};
  if (uninstallCurrent) return () => {};

  const proto = Node.prototype;
  const originalRemoveChild = proto.removeChild;
  const originalInsertBefore = proto.insertBefore;

  proto.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) return child;
    return originalRemoveChild.call(this, child) as T;
  };

  proto.insertBefore = function <T extends Node>(this: Node, node: T, ref: Node | null): T {
    if (ref && ref.parentNode !== this) return originalInsertBefore.call(this, node, null) as T;
    return originalInsertBefore.call(this, node, ref) as T;
  };

  uninstallCurrent = () => {
    proto.removeChild = originalRemoveChild;
    proto.insertBefore = originalInsertBefore;
    uninstallCurrent = undefined;
  };
  return uninstallCurrent;
}
