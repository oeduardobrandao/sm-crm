import type { BlockProps } from '../BlockRenderer';
import { tiptapToHtml } from '../tiptap-render';

export function TextBlock({ block }: BlockProps) {
  const html = tiptapToHtml(block.text);
  if (!html) return null;
  // Seguro: tiptapToHtml só emite tags da allowlist com texto escapado.
  return <div className="rb-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}
