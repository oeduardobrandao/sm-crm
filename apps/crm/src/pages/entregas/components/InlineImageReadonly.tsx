import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Read-only mirror of the editable `inlineImage` node (see `InlineImageExtension.tsx`),
 * without the upload/resize NodeView. The editable PostEditor can persist this node into
 * `conteudo`; ReadOnlyTipTap's schema must register it too, or TipTap silently drops the
 * whole document on read (same invariant as the hub's InlineImageReadonly).
 */
export const InlineImageReadonly = Node.create({
  name: 'inlineImage',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      r2Key: { default: null },
      src: { default: null },
      alt: { default: '' },
      width: { default: null },
      height: { default: null },
      displayWidth: { default: null },
      loading: { default: false },
      blurSrc: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-inline-image]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const dw = HTMLAttributes.displayWidth;
    const imgStyle = dw
      ? `width: ${dw}px; max-width: 100%; border-radius: 8px; display: block`
      : 'max-width: 100%; border-radius: 8px; display: block';
    return [
      'figure',
      mergeAttributes({ 'data-inline-image': '', style: 'margin: 0.5rem 0' }),
      [
        'img',
        {
          src: HTMLAttributes.src,
          alt: HTMLAttributes.alt ?? '',
          style: imgStyle,
        },
      ],
    ];
  },
});
