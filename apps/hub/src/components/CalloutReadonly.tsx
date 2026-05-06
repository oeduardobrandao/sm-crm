import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react';

function CalloutReadonlyView({ node }: { node: { attrs: Record<string, string> } }) {
  const emoji = node.attrs.emoji || '💡';
  const color = node.attrs.color || 'brown';

  return (
    <NodeViewWrapper className={`callout-block callout-block--${color}`}>
      <span className="callout-emoji-wrapper" style={{ userSelect: 'none' }}>
        <span className="callout-emoji-btn">{emoji}</span>
      </span>
      <NodeViewContent className="callout-content" />
    </NodeViewWrapper>
  );
}

export const CalloutReadonly = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      emoji: { default: '💡' },
      color: { default: 'brown' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-callout': '', class: `callout-block callout-block--${HTMLAttributes.color || 'brown'}` }, HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutReadonlyView);
  },
});
