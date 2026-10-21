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

// The Hub rich-text schema (richTextExtensions() in components/RichTextTiptap.tsx), kept
// here so plain-text extraction doesn't pull TipTap into every chunk that compares texts.
// richDoc.test.ts pins these sets, and the output, against the real TipTap schema.
export const INLINE_NODES = new Set(['text', 'hardBreak', 'mention']);
export const BLOCK_NODES = new Set([
  'doc',
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'horizontalRule',
  'callout',
  'inlineImage',
]);
// Nodes with no content (ProseMirror leaves, minus text): they count as one position.
export const LEAF_NODES = new Set(['hardBreak', 'mention', 'horizontalRule', 'inlineImage']);
export const MARKS = new Set([
  'bold',
  'italic',
  'strike',
  'code',
  'underline',
  'textStyle',
  'highlight',
  'link',
  'commentHighlight',
]);
// Nodes with a `renderText`: their text replaces their content, which isn't walked.
const TEXT_SERIALIZERS: Record<string, (attrs: Record<string, unknown>) => string> = {
  hardBreak: () => '\n',
  mention: (attrs) => `@${attrs.label ?? null}`,
};

type JsonNode = {
  type?: unknown;
  text?: unknown;
  attrs?: unknown;
  marks?: unknown;
  content?: unknown;
};

class SchemaMismatch extends Error {}

function children(node: JsonNode): JsonNode[] {
  if (node.content === undefined || node.content === null) return [];
  if (!Array.isArray(node.content)) throw new SchemaMismatch('content');
  return node.content as JsonNode[];
}

function checkNode(node: JsonNode) {
  if (!node || typeof node !== 'object') throw new SchemaMismatch('node');
  const type = node.type;
  if (typeof type !== 'string' || (!INLINE_NODES.has(type) && !BLOCK_NODES.has(type))) {
    throw new SchemaMismatch(`node ${String(type)}`);
  }
  if (type === 'text' && (typeof node.text !== 'string' || node.text === '')) {
    throw new SchemaMismatch('text');
  }
  if (node.marks !== undefined && node.marks !== null) {
    if (!Array.isArray(node.marks)) throw new SchemaMismatch('marks');
    for (const mark of node.marks as { type?: unknown }[]) {
      if (!mark || typeof mark.type !== 'string' || !MARKS.has(mark.type)) {
        throw new SchemaMismatch(`mark ${String(mark?.type)}`);
      }
    }
  }
}

// ProseMirror node size: a text node counts its characters, a leaf 1, anything else its
// content plus its open and close tokens.
function nodeSize(node: JsonNode): number {
  if (node.type === 'text') return (node.text as string).length;
  if (LEAF_NODES.has(node.type as string)) return 1;
  return children(node).reduce((sum, kid) => sum + nodeSize(kid), 0) + 2;
}

/**
 * TipTap's `getTextBetween` over the whole document (what `editor.getText()` and
 * `generateText()` return): a block separator before every block not at position 0,
 * text nodes verbatim, nodes with a text serializer replaced by its output. Throws
 * `SchemaMismatch` wherever `Node.fromJSON` would reject the document.
 */
function getText(root: JsonNode): string {
  checkNode(root);
  let text = '';
  const walk = (parent: JsonNode, start: number) => {
    let pos = start;
    for (const node of children(parent)) {
      checkNode(node);
      const type = node.type as string;
      if (BLOCK_NODES.has(type) && pos > 0) text += '\n\n';
      const serializer = TEXT_SERIALIZERS[type];
      if (serializer) {
        const attrs = node.attrs && typeof node.attrs === 'object' ? node.attrs : {};
        text += serializer(attrs as Record<string, unknown>);
      } else if (type === 'text') {
        text += node.text as string;
      } else {
        walk(node, pos + 1);
      }
      pos += nodeSize(node);
    }
  };
  walk(root, 0);
  return text;
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
    text = getText(doc as JsonNode) || null;
  } catch {
    text = null;
  }
  plainTextCache.set(doc, text);
  return text;
}
