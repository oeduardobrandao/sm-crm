import { lazy, Suspense } from 'react';
import { docPlainText } from '../lib/richDoc';

/**
 * Lazy front for the TipTap renderer in `RichTextTiptap.tsx`. TipTap + ProseMirror are
 * ~180 kB gzip, and on Postagens/Aprovações rich text only shows inside the post dialog,
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

export function RichTextContent(props: RichTextContentProps) {
  const loadingText = docPlainText(props.content) ?? props.fallbackText;
  return (
    <Suspense
      fallback={
        loadingText ? (
          <div className={props.className}>
            <p className="whitespace-pre-wrap">{loadingText}</p>
          </div>
        ) : null
      }
    >
      <RichTextTiptap {...props} />
    </Suspense>
  );
}
