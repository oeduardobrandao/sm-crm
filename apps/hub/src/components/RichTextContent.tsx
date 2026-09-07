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
import { CommentHighlightReadonly } from './CommentHighlightReadonly';
import { MentionReadonly } from './MentionReadonly';

/**
 * The TipTap extension set used to read post `conteudo` in the hub. This must stay a
 * superset of the marks/nodes the CRM editor (`PostEditor`) can persist — if the hub
 * schema is missing a mark/node type that appears in `conteudo`, TipTap discards the
 * ENTIRE document (logging a warning, not throwing), rendering an empty body.
 */
export function richTextExtensions(editable = false) {
  return [
    // StarterKit v3 already bundles Link and Underline. Without `link: false` /
    // `underline: false` both register twice -- TipTap logs "Duplicate extension
    // names found: ['link','underline']" and keeps BOTH Link instances live, so
    // StarterKit's own `openOnClick: true` handler fires alongside the one configured
    // below. `openOnClick: !editable` further down is deliberate (portal links should
    // open in the read-only view) -- this only removes the duplicate registration.
    StarterKit.configure({ link: false, underline: false }),
    UnderlineExt,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    Link.configure({ openOnClick: !editable, autolink: false }),
    CalloutReadonly,
    InlineImageReadonly,
    CommentHighlightReadonly,
    MentionReadonly,
  ];
}

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

function RichTextEditor({
  content,
  className,
  editable = false,
  onUpdate,
}: Omit<RichTextContentProps, 'fallbackText'>) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const [focused, setFocused] = useState(false);

  const editor = useEditor({
    extensions: richTextExtensions(editable),
    content,
    editable,
    // Only include `editorProps` at all when editable: Tiptap's own default is `{}`, but an
    // explicit `editorProps: undefined` key overrides that default during option merging and
    // crashes `Editor.createView()` (`Cannot read properties of undefined (reading
    // 'dispatchTransaction')`) the moment a read-only instance mounts. The crash is swallowed
    // by `EditorErrorBoundary` below, so a viewer silently gets the plain-text fallback (or
    // nothing, when no `fallbackText` is given) instead of the rich content.
    ...(editable
      ? {
          editorProps: {
            handlePaste: (_view, event) => {
              const text = event.clipboardData?.getData('text/plain');
              if (text) {
                editor?.commands.insertContent(text);
                return true;
              }
              return false;
            },
            handleDrop: () => true,
          },
        }
      : {}),
    onUpdate: editable
      ? ({ editor: ed }) => {
          onUpdateRef.current?.(ed.getJSON() as Record<string, unknown>, ed.getText());
        }
      : undefined,
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
        className={
          editable
            ? 'border border-dashed border-stone-300 rounded-lg px-3 py-2 transition-colors focus-within:border-stone-400 focus-within:border-solid'
            : ''
        }
      >
        <EditorContent
          editor={editor}
          // `.post-editor-content` (apps/crm/style.css) is the CRM editing surface's own
          // sizing: 0.875rem, 80px min-height, links in the CRM's yellow. It's shared here
          // only because Tiptap's EditorContent needs a class to hang node CSS off. When
          // read-only, `hub-rich-content` (apps/hub/index.html) out-specifies it so portal
          // content reads at the surrounding Hub typography (font-size/line-height/color
          // inherited from `className` above) with links in the client's own brand color,
          // not the CRM editor's. Editable mode (inline edit-suggestion UI) keeps the CRM
          // editor look on purpose -- it IS an editor in that state.
          className={editable ? 'post-editor-content' : 'post-editor-content hub-rich-content'}
        />
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

export function RichTextContent({
  content,
  className,
  editable,
  onUpdate,
  fallbackText,
}: RichTextContentProps) {
  if (typeof content !== 'object' || content === null || !('type' in content)) {
    return <PlainFallback className={className} text={fallbackText} />;
  }

  return (
    <EditorErrorBoundary fallback={<PlainFallback className={className} text={fallbackText} />}>
      <RichTextEditor
        content={content}
        className={className}
        editable={editable}
        onUpdate={onUpdate}
      />
    </EditorErrorBoundary>
  );
}
