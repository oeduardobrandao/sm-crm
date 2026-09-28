import { generateText, type JSONContent } from '@tiptap/react';
import { richTextExtensions } from '../components/RichTextContent';

/**
 * A TipTap document as a comparable string: keys sorted, and inline images' `src` dropped.
 * hub-posts signs `src` into both documents (appending the key), while a just-saved
 * suggestion comes back from hub-edit-suggestion with `src` stripped; the image identity is
 * its `r2Key` either way.
 */
export function canonicalDoc(value: unknown): string {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== 'object') return node;
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (key === 'src' && obj.r2Key !== undefined) continue;
      out[key] = walk(obj[key]);
    }
    return out;
  };
  return JSON.stringify(walk(value ?? null));
}

const plainTextCache = new WeakMap<object, string | null>();

/**
 * A TipTap document's plain text exactly as the Hub editor's `getText()` produces it
 * (paragraphs joined by a blank line), or null when the document is missing or does not fit
 * the Hub schema, or has no text. Stored `conteudo_plain` is not always that text: posts created by the MCP
 * agent store one `\n` per line, so comparing it against editor output flags every line break.
 */
export function docPlainText(doc: unknown): string | null {
  if (doc === null || typeof doc !== 'object') return null;
  if (plainTextCache.has(doc)) return plainTextCache.get(doc) ?? null;
  let text: string | null;
  try {
    // An empty document says nothing about a stored text that isn't: fall back to it.
    text = generateText(doc as JSONContent, richTextExtensions()) || null;
  } catch {
    text = null;
  }
  plainTextCache.set(doc, text);
  return text;
}
