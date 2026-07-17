import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { createInlineImageExtension } from '../../entregas/components/InlineImageExtension';

const dummyUpload = async () => ({ r2Key: '', src: '', width: 0, height: 0 });

function imgNode(src: string) {
  return {
    type: 'inlineImage',
    attrs: { r2Key: null, src, alt: 'Tela de exemplo', width: 1440, height: 900 },
  };
}

/**
 * IMPORTANT: `new Editor({ content })` does NOT validate content against the
 * schema by default. TipTap's `Editor` defaults to `enableContentCheck: false`
 * (@tiptap/core/dist/index.cjs ~4809), and the load path
 * (`createDoc` -> `createDocument` -> `createNodeFromContent` ->
 * `schema.nodeFromJSON` -> prosemirror-model's `Node.fromJSON`) builds nodes
 * with `NodeType.create()`, not `createChecked()`
 * (prosemirror-model/dist/index.cjs ~1189) -- so a schema-invalid nesting
 * loads silently, with no throw, no warning, and no node dropped.
 *
 * To actually exercise schema validation we opt in explicitly:
 * `enableContentCheck: true` makes `createDoc()` call `node.check()` after
 * building the doc (@tiptap/core/dist/index.cjs ~5120-5146). `Node#check()`
 * is recursive and calls `NodeType#checkContent()` on every node in the tree
 * (prosemirror-model/dist/index.cjs ~1142-1158, ~1807-1810), which is the
 * real schema-content-match check.
 *
 * When that check fails, TipTap does not throw out of the `Editor`
 * constructor by default -- it emits a `contentError` event and falls back
 * to loading the (still-invalid) doc unchecked. We supply our own
 * `onContentError` handler below to capture the error explicitly, rather
 * than relying on the default handler's throw-on-error behavior, so the
 * mechanism this test depends on is visible in the test itself.
 */
function buildEditor(doc: unknown) {
  let contentError: Error | null = null;
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      createInlineImageExtension(dummyUpload),
    ],
    content: doc as never,
    enableContentCheck: true,
    onContentError: ({ error }) => {
      contentError = error;
    },
  });
  return { editor, getContentError: () => contentError };
}

describe('inlineImage in article schema', () => {
  it('is schema-valid (no contentError) nested inside an ordered listItem', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          attrs: { start: 1 },
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Acesse Post Express' }] },
                imgNode('https://example.test/a.png'),
              ],
            },
          ],
        },
      ],
    };

    const { editor, getContentError } = buildEditor(doc);

    // The claim this suite exists to guard: with schema content-checking
    // actually turned on, TipTap raises NO contentError for inlineImage
    // (group: 'block') placed after the leading paragraph inside an ordered
    // listItem (content: 'paragraph block*' -- @tiptap/extension-list). If
    // listItem's content model were ever tightened so this nesting became
    // invalid, `getContentError()` would stop returning null and this
    // assertion would fail.
    expect(getContentError()).toBeNull();

    const out = JSON.stringify(editor.getJSON());
    expect(out).toContain('inlineImage');
    expect(out).toContain('https://example.test/a.png');
    editor.destroy();
  });

  it('NEGATIVE CONTROL: reports a contentError for inlineImage nested directly inside a paragraph', () => {
    // `paragraph`'s content spec is "inline*" (@tiptap/extension-paragraph)
    // and `inlineImage` is group 'block' -- this nesting is genuinely
    // invalid. This test exists solely to prove the check above is not
    // vacuous: it demonstrates that `buildEditor` actually can detect and
    // report invalid nesting. If this test ever stops catching this, the
    // "is schema-valid" test above has lost its ability to catch a real
    // regression.
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Acesse Post Express' },
            imgNode('https://example.test/invalid.png'),
          ],
        },
      ],
    };

    const { editor, getContentError } = buildEditor(doc);

    const error = getContentError();
    expect(error).not.toBeNull();
    expect(error?.message).toContain('Invalid JSON content');
    expect((error?.cause as Error | undefined)?.message).toContain('paragraph');

    editor.destroy();
  });

  it('preserves r2Key null so the node never routes through sign-r2-urls', () => {
    const editor = new Editor({
      extensions: [
        StarterKit.configure({ heading: { levels: [2, 3] } }),
        createInlineImageExtension(dummyUpload),
      ],
      content: { type: 'doc', content: [imgNode('https://example.test/b.png')] },
    });

    const json = editor.getJSON() as any;
    expect(json.content[0].attrs.r2Key).toBeNull();
    editor.destroy();
  });
});
