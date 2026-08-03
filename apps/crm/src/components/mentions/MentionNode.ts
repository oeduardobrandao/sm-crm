import { Node, mergeAttributes } from '@tiptap/core';
import type { MentionEntityType } from './types';

/**
 * TipTap node for an @-mention chip (`@[Label](tipo:id)` inserted via the suggestion
 * dropdown, see Task 4). Persisted into post `conteudo` as an atomic inline node.
 *
 * Node name, attrs and DOM shape MUST stay identical to the hub's read-only mirror
 * (`apps/hub/src/components/MentionReadonly.ts`) -- the hub's TipTap schema must remain a
 * superset of anything the CRM can persist, or an unrecognised node type makes TipTap
 * silently discard the ENTIRE document.
 */
export const MentionNode = Node.create({
  name: 'mention',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      entityType: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-entity-type') as MentionEntityType | null,
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
