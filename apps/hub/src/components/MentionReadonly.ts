import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Read-only mirror of the CRM `mention` node (see
 * apps/crm/src/components/mentions/MentionNode.ts).
 *
 * The CRM editor persists this node into post `conteudo` whenever an @-mention chip is
 * inserted. The hub must register the node with an IDENTICAL name and attrs so its TipTap
 * schema can parse such `conteudo` -- without it, TipTap rejects the whole document and the
 * body renders blank in the client portal.
 *
 * Non-interactive: no click handlers or navigation, just the chip markup.
 */
export const MentionReadonly = Node.create({
  name: 'mention',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      entityType: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-entity-type'),
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-entity-type': attributes.entityType,
        }),
      },
      id: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('data-id');
          return raw === null ? null : Number(raw);
        },
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-id': attributes.id,
        }),
      },
      label: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-label') ??
          (element.textContent ? element.textContent.replace(/^@/, '') : null),
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-label': attributes.label,
        }),
      },
      parentId: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('data-parent-id');
          return raw === null || raw === '' ? null : Number(raw);
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.parentId === null || attributes.parentId === undefined
            ? {}
            : { 'data-parent-id': attributes.parentId },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-mention]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-mention': '',
        class: `mention-chip mention-chip--${node.attrs.entityType}`,
      }),
      `@${node.attrs.label}`,
    ];
  },

  renderText({ node }) {
    return `@${node.attrs.label}`;
  },
});
