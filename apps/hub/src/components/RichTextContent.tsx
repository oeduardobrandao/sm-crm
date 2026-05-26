import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import UnderlineExt from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import { CalloutReadonly } from './CalloutReadonly';
import { InlineImageReadonly } from './InlineImageReadonly';

class EditorErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

interface RichTextContentProps {
  content: Record<string, unknown>;
  className?: string;
  editable?: boolean;
  onUpdate?: (json: Record<string, unknown>, plain: string) => void;
  fallbackText?: string;
}

function RichTextEditor({ content, className, editable = false, onUpdate }: Omit<RichTextContentProps, 'fallbackText'>) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const [focused, setFocused] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      UnderlineExt,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Link.configure({ openOnClick: !editable, autolink: false }),
      CalloutReadonly,
      InlineImageReadonly,
    ],
    content,
    editable,
    editorProps: editable ? {
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData('text/plain');
        if (text) {
          editor?.commands.insertContent(text);
          return true;
        }
        return false;
      },
      handleDrop: () => true,
    } : undefined,
    onUpdate: editable ? ({ editor: ed }) => {
      onUpdateRef.current?.(ed.getJSON() as Record<string, unknown>, ed.getText());
    } : undefined,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  });

  useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  return (
    <div className={className}>
      {editable && !focused && !editor?.isFocused && (
        <p className="text-[11px] text-stone-400 mb-1 flex items-center gap-1">
          <span className="opacity-70">✏️</span> Clique no texto para editar
        </p>
      )}
      <div
        className={editable ? 'border border-dashed border-stone-300 rounded-lg px-3 py-2 transition-colors focus-within:border-stone-400 focus-within:border-solid' : ''}
      >
        <EditorContent editor={editor} className="post-editor-content" />
      </div>
    </div>
  );
}

function PlainFallback({ className, text }: { className?: string; text?: string }) {
  if (!text) return null;
  return (
    <div className={className}>
      <p className="whitespace-pre-wrap">{text}</p>
    </div>
  );
}

export function RichTextContent({ content, className, editable, onUpdate, fallbackText }: RichTextContentProps) {
  if (typeof content !== 'object' || content === null || !('type' in content)) {
    return <PlainFallback className={className} text={fallbackText} />;
  }

  return (
    <EditorErrorBoundary fallback={<PlainFallback className={className} text={fallbackText} />}>
      <RichTextEditor content={content} className={className} editable={editable} onUpdate={onUpdate} />
    </EditorErrorBoundary>
  );
}
