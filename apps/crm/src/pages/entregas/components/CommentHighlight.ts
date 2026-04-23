import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    commentHighlight: {
      setCommentHighlight: (attrs: { threadId: number }) => ReturnType;
      unsetCommentHighlight: (threadId: number) => ReturnType;
      updateCommentResolved: (threadId: number, resolved: boolean) => ReturnType;
    };
  }
}

export const CommentHighlight = Mark.create({
  name: 'commentHighlight',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      threadId: {
        default: null,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute('data-thread-id')),
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-thread-id': attrs.threadId }),
      },
      resolved: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-resolved') === 'true',
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-resolved': String(attrs.resolved) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-thread-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'comment-highlight',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setCommentHighlight:
        (attrs) =>
        ({ commands }) =>
          commands.setMark(this.name, attrs),
      unsetCommentHighlight:
        (threadId) =>
        ({ tr, state, dispatch }) => {
          const { doc } = state;
          const markType = state.schema.marks[this.name];
          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type === markType && mark.attrs.threadId === threadId) {
                tr.removeMark(pos, pos + node.nodeSize, mark);
              }
            });
          });
          if (dispatch) dispatch(tr);
          return true;
        },
      updateCommentResolved:
        (threadId, resolved) =>
        ({ tr, state, dispatch }) => {
          const { doc } = state;
          const markType = state.schema.marks[this.name];
          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type === markType && mark.attrs.threadId === threadId) {
                tr.removeMark(pos, pos + node.nodeSize, mark);
                tr.addMark(pos, pos + node.nodeSize, markType.create({ ...mark.attrs, resolved }));
              }
            });
          });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
});
