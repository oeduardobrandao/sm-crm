import { Node, mergeAttributes } from '@tiptap/core';
import { sanitizeExternalUrl } from '../lib/security';

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
    // `displayWidth` is a persisted document attribute -- it can carry whatever a crafted
    // ProseMirror JSON doc puts there. Interpolating it into a style string unguarded lets
    // a malicious value inject arbitrary CSS declarations (e.g. `background-image:
    // url(...)`) across the agency-to-client boundary. Coerce to a finite positive number
    // and fall back to the width-less style for anything else.
    const dw = Number(HTMLAttributes.displayWidth);
    const imgStyle =
      Number.isFinite(dw) && dw > 0
        ? `width: ${dw}px; max-width: 100%; border-radius: 8px; display: block`
        : 'max-width: 100%; border-radius: 8px; display: block';
    return [
      'figure',
      mergeAttributes({ 'data-inline-image': '', style: 'margin: 0.5rem 0' }),
      [
        'img',
        {
          // Same allowlist the legacy `image` page block uses (sanitizeExternalUrl):
          // http/https only, no embedded credentials.
          src: sanitizeExternalUrl(HTMLAttributes.src),
          alt: HTMLAttributes.alt ?? '',
          style: imgStyle,
        },
      ],
    ];
  },
});
