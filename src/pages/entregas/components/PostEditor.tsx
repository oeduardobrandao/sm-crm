import { useEffect, useState, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { Bold, Italic, Underline as UnderlineIcon, Link as LinkIcon, List, ListOrdered } from 'lucide-react';

interface PostEditorProps {
  /** TipTap JSON content. Parent should key this component by post.id for proper remounting. */
  initialContent: Record<string, unknown> | null;
  onUpdate: (json: Record<string, unknown>, plain: string) => void;
  disabled?: boolean;
}

export function PostEditor({ initialContent, onUpdate, disabled }: PostEditorProps) {
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkInputValue, setLinkInputValue] = useState('');
  const linkInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: 'Escreva o conteúdo do post...' }),
    ],
    content: initialContent ?? undefined,
    editable: !disabled,
    onUpdate: ({ editor }) => {
      onUpdate(editor.getJSON() as Record<string, unknown>, editor.getText());
    },
  });

  // Sync editable state when disabled prop changes
  useEffect(() => {
    if (editor) editor.setEditable(!disabled);
  }, [editor, disabled]);

  const openLinkPopover = useCallback(() => {
    if (!editor) return;
    const existing = editor.getAttributes('link').href ?? '';
    setLinkInputValue(existing);
    setLinkPopoverOpen(true);
    setTimeout(() => linkInputRef.current?.focus(), 0);
  }, [editor]);

  const applyLink = useCallback(() => {
    if (!editor) return;
    const url = linkInputValue.trim();
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
    setLinkPopoverOpen(false);
  }, [editor, linkInputValue]);

  const removeLink = useCallback(() => {
    editor?.chain().focus().unsetLink().run();
    setLinkPopoverOpen(false);
  }, [editor]);

  return (
    <div className={`post-editor${disabled ? ' post-editor--readonly' : ''}`}>
      {!disabled && (
        <div className="post-editor-toolbar">
          <button
            type="button"
            className={`post-editor-btn${editor?.isActive('bold') ? ' active' : ''}`}
            onMouseDown={e => { e.preventDefault(); editor?.chain().focus().toggleBold().run(); }}
            title="Negrito"
          >
            <Bold className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={`post-editor-btn${editor?.isActive('italic') ? ' active' : ''}`}
            onMouseDown={e => { e.preventDefault(); editor?.chain().focus().toggleItalic().run(); }}
            title="Itálico"
          >
            <Italic className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={`post-editor-btn${editor?.isActive('underline') ? ' active' : ''}`}
            onMouseDown={e => { e.preventDefault(); editor?.chain().focus().toggleUnderline().run(); }}
            title="Sublinhado"
          >
            <UnderlineIcon className="h-3.5 w-3.5" />
          </button>
          <div className="post-editor-divider" />
          <div className="post-editor-link-wrapper">
            <button
              type="button"
              className={`post-editor-btn${editor?.isActive('link') ? ' active' : ''}`}
              onMouseDown={e => { e.preventDefault(); openLinkPopover(); }}
              title="Inserir link"
            >
              <LinkIcon className="h-3.5 w-3.5" />
            </button>
            {linkPopoverOpen && (
              <div className="post-editor-link-popover" onMouseDown={e => e.stopPropagation()}>
                <input
                  ref={linkInputRef}
                  className="post-editor-link-input"
                  type="url"
                  placeholder="https://..."
                  value={linkInputValue}
                  onChange={e => setLinkInputValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
                    if (e.key === 'Escape') setLinkPopoverOpen(false);
                  }}
                />
                <button type="button" className="post-editor-link-apply" onClick={applyLink}>OK</button>
                {editor?.isActive('link') && (
                  <button type="button" className="post-editor-link-remove" onClick={removeLink}>Remover</button>
                )}
              </div>
            )}
          </div>
          <div className="post-editor-divider" />
          <button
            type="button"
            className={`post-editor-btn${editor?.isActive('bulletList') ? ' active' : ''}`}
            onMouseDown={e => { e.preventDefault(); editor?.chain().focus().toggleBulletList().run(); }}
            title="Lista"
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={`post-editor-btn${editor?.isActive('orderedList') ? ' active' : ''}`}
            onMouseDown={e => { e.preventDefault(); editor?.chain().focus().toggleOrderedList().run(); }}
            title="Lista numerada"
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </button>
          <div className="post-editor-char-count">
            {editor?.storage.characterCount?.characters?.() ?? editor?.getText().length ?? 0} / 2200
          </div>
        </div>
      )}
      <EditorContent editor={editor} className="post-editor-content" />
    </div>
  );
}
