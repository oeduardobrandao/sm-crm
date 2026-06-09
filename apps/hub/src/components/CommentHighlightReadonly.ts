import { Mark } from '@tiptap/core';

/**
 * Read-only mirror of the CRM `commentHighlight` mark (see
 * apps/crm/.../components/CommentHighlight.ts).
 *
 * The CRM editor persists this mark into post `conteudo` whenever an agent comments on a
 * span of post text. The hub must register the mark so its TipTap schema can parse such
 * `conteudo` — without it, TipTap rejects the whole document and the body renders blank in
 * the client portal.
 *
 * Comments are INTERNAL team annotations, so this read-only version intentionally renders
 * the text in a plain <span> with no highlight class and no thread id: the marked text
 * stays visible to the client, but the internal comment is not surfaced or leaked.
 */
export const CommentHighlightReadonly = Mark.create({
  name: 'commentHighlight',

  addAttributes() {
    return {
      threadId: { default: null },
      resolved: { default: false },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-thread-id]' }];
  },

  renderHTML() {
    // Deliberately drop threadId/resolved and the comment-highlight class so the internal
    // comment is invisible to the client; only the text content is rendered.
    return ['span', 0];
  },
});
