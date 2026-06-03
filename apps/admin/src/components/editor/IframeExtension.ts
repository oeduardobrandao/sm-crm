import { Node, mergeAttributes } from '@tiptap/core';

const ALLOWED_DOMAINS = [
  'loom.com',
  'www.loom.com',
  'arcade.software',
  'www.arcade.software',
  'app.arcade.software',
  'scribehow.com',
  'www.scribehow.com',
];

function isAllowedDomain(src: string): boolean {
  try {
    const url = new URL(src);
    return ALLOWED_DOMAINS.some((d) => url.hostname === d || url.hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    iframe: {
      setIframe: (options: { src: string }) => ReturnType;
    };
  }
}

export const IframeExtension = Node.create({
  name: 'iframe',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      width: { default: '100%' },
      height: { default: '400px' },
    };
  },

  parseHTML() {
    return [{ tag: 'iframe' }];
  },

  renderHTML({ HTMLAttributes }) {
    const src = HTMLAttributes.src as string;
    if (!isAllowedDomain(src)) {
      return ['div', { class: 'iframe-blocked' }, 'Embed blocked: domain not allowed'];
    }
    return [
      'div',
      { class: 'iframe-wrapper', 'data-type': 'iframe' },
      [
        'iframe',
        mergeAttributes(HTMLAttributes, {
          frameborder: '0',
          allowfullscreen: 'true',
          allow: 'autoplay; fullscreen',
          sandbox: 'allow-scripts allow-same-origin allow-popups allow-presentation',
          loading: 'lazy',
        }),
      ],
    ];
  },

  addCommands() {
    return {
      setIframe:
        (options) =>
        ({ commands }) => {
          if (!isAllowedDomain(options.src)) return false;
          return commands.insertContent({
            type: this.name,
            attrs: { src: options.src },
          });
        },
    };
  },
});
