import { Component, lazy, Suspense, type ReactNode } from 'react';
import { docPlainText } from '../lib/richDoc';

/**
 * Lazy front for the TipTap renderer in `RichTextTiptap.tsx`. TipTap + ProseMirror are
 * ~124 kB gzip, and on Postagens/Aprovações rich text only shows inside the post dialog,
 * so the pages no longer carry it: the chunk loads on first use (or earlier, through
 * `preloadRichText()`), and until then the body reads as plain text in the same place.
 * Pages that render rich text up front (PaginaPage) import `RichTextTiptap` directly.
 */
const loadTiptap = () => import('./RichTextTiptap');
const RichTextTiptap = lazy(() => loadTiptap().then((m) => ({ default: m.RichTextContent })));

/** Starts downloading the TipTap chunk ahead of the first `RichTextContent` render. */
export function preloadRichText() {
  loadTiptap().catch(() => {
    // A failed preload is retried by the lazy render, which surfaces the error there.
  });
}

export interface RichTextContentProps {
  content: Record<string, unknown>;
  className?: string;
  editable?: boolean;
  onUpdate?: (json: Record<string, unknown>, plain: string) => void;
  fallbackText?: string;
}

// A chunk that fails to load (flaky network; deploy skew already reloads through
// installDeployRecovery) leaves the body as plain text instead of taking down the page.
class ChunkErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

export function RichTextContent(props: RichTextContentProps) {
  // Same text the TipTap renderer falls back to; the document's own text when there is none.
  const plainText = props.fallbackText || docPlainText(props.content);
  const plain = plainText ? (
    <div className={props.className}>
      <p className="whitespace-pre-wrap">{plainText}</p>
    </div>
  ) : null;
  return (
    <ChunkErrorBoundary fallback={plain}>
      <Suspense fallback={plain}>
        <RichTextTiptap {...props} />
      </Suspense>
    </ChunkErrorBoundary>
  );
}
