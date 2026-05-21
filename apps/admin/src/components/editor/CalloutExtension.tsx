import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, type ReactNodeViewProps } from '@tiptap/react';

const CALLOUT_EMOJIS = ['💡', '📌', '⚠️', '✅', '❗', '🧠', '📝', '🎯', '🔥', '💬', '📣', '🚀'];

export const CALLOUT_COLORS = [
  { name: 'Marrom', value: 'brown' },
  { name: 'Cinza', value: 'gray' },
  { name: 'Laranja', value: 'orange' },
  { name: 'Amarelo', value: 'yellow' },
  { name: 'Verde', value: 'green' },
  { name: 'Azul', value: 'blue' },
  { name: 'Roxo', value: 'purple' },
  { name: 'Rosa', value: 'pink' },
] as const;

function CalloutNodeView({ node, updateAttributes }: ReactNodeViewProps) {
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const openPicker = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPickerPos({ top: rect.top, left: rect.left });
    setEmojiPickerOpen(true);
  }, []);

  useEffect(() => {
    if (!emojiPickerOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        pickerRef.current && !pickerRef.current.contains(target) &&
        btnRef.current && !btnRef.current.contains(target)
      ) {
        setEmojiPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [emojiPickerOpen]);

  const emoji = (node.attrs.emoji as string) || '💡';
  const color = (node.attrs.color as string) || 'brown';

  return (
    <NodeViewWrapper className={`callout-block callout-block--${color}`}>
      <div className="callout-emoji-wrapper" contentEditable={false}>
        <button
          ref={btnRef}
          className="callout-emoji-btn"
          onClick={() => emojiPickerOpen ? setEmojiPickerOpen(false) : openPicker()}
          type="button"
        >
          {emoji}
        </button>
        {emojiPickerOpen && pickerPos && createPortal(
          <div
            ref={pickerRef}
            className="callout-emoji-picker"
            style={{ top: pickerPos.top, left: pickerPos.left, transform: 'translateY(-100%) translateY(-6px)' }}
          >
            <div className="callout-emoji-grid">
              {CALLOUT_EMOJIS.map(e => (
                <button
                  key={e}
                  type="button"
                  className={`callout-emoji-option${emoji === e ? ' active' : ''}`}
                  onClick={() => { updateAttributes({ emoji: e }); setEmojiPickerOpen(false); }}
                >
                  {e}
                </button>
              ))}
            </div>
            <div className="callout-color-section">
              <span className="callout-color-label">Cor</span>
              <div className="callout-color-grid">
                {CALLOUT_COLORS.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    className={`callout-color-dot callout-color-dot--${c.value}${color === c.value ? ' active' : ''}`}
                    title={c.name}
                    onClick={() => updateAttributes({ color: c.value })}
                  />
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
      </div>
      <NodeViewContent className="callout-content" />
    </NodeViewWrapper>
  );
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      insertCallout: (attrs?: { emoji?: string; color?: string }) => ReturnType;
    };
  }
}

export const CalloutExtension = Node.create({
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
    return ReactNodeViewRenderer(CalloutNodeView);
  },

  addCommands() {
    return {
      insertCallout: (attrs?: { emoji?: string; color?: string }) => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
          attrs: { emoji: attrs?.emoji ?? '💡', color: attrs?.color ?? 'brown' },
          content: [{ type: 'paragraph' }],
        });
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { $anchor } = editor.state.selection;
        const parentNode = $anchor.parent;
        const grandParent = $anchor.node($anchor.depth - 1);
        if (
          grandParent?.type.name === this.name &&
          parentNode.type.name === 'paragraph' &&
          parentNode.textContent === '' &&
          grandParent.childCount === 1
        ) {
          return editor.commands.lift(this.name);
        }
        return false;
      },
    };
  },
});
