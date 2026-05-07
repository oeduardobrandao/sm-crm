import { Node, mergeAttributes } from '@tiptap/core';

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
      loading: { default: false },
      blurSrc: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-inline-image]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'figure',
      mergeAttributes({ 'data-inline-image': '', style: 'margin: 0.5rem 0' }),
      [
        'img',
        {
          src: HTMLAttributes.src,
          alt: HTMLAttributes.alt ?? '',
          style: 'max-width: 100%; border-radius: 8px; display: block',
        },
      ],
    ];
  },
});
