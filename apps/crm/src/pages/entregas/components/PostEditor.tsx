import { useEffect, useState, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import UnderlineExt from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import {
  Bold, Italic, Underline as UnderlineIcon, Link as LinkIcon,
  List, ListOrdered, Baseline, Highlighter, Check,
} from 'lucide-react';

const TEXT_COLORS = [
  { name: 'Padrão', color: null },
  { name: 'Cinza', color: '#787774' },
  { name: 'Marrom', color: '#9F6B53' },
  { name: 'Laranja', color: '#D9730D' },
  { name: 'Amarelo', color: '#CB912F' },
  { name: 'Verde', color: '#448361' },
  { name: 'Azul', color: '#337EA9' },
  { name: 'Roxo', color: '#9065B0' },
  { name: 'Rosa', color: '#C14C8A' },
] as const;

const HIGHLIGHT_COLORS = [
  { name: 'Nenhum', color: null, cssColor: 'transparent' },
  { name: 'Cinza', color: 'gray', cssColor: '#E3E2E0' },
  { name: 'Marrom', color: 'brown', cssColor: '#EEE0DA' },
  { name: 'Laranja', color: 'orange', cssColor: '#FADEC9' },
  { name: 'Amarelo', color: 'yellow', cssColor: '#FBF3DB' },
  { name: 'Verde', color: 'green', cssColor: '#DBEDDB' },
  { name: 'Azul', color: 'blue', cssColor: '#D3E5EF' },
  { name: 'Roxo', color: 'purple', cssColor: '#E8DEEE' },
  { name: 'Rosa', color: 'pink', cssColor: '#F4DFEB' },
] as const;

interface PostEditorProps {
  initialContent: Record<string, unknown> | null;
  onUpdate: (json: Record<string, unknown>, plain: string) => void;
  disabled?: boolean;
}

export function PostEditor({ initialContent, onUpdate, disabled }: PostEditorProps) {
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkInputValue, setLinkInputValue] = useState('');
  const [textColorOpen, setTextColorOpen] = useState(false);
  const [highlightOpen, setHighlightOpen] = useState(false);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const textColorRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const isInitialized = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      UnderlineExt,
      TextStyle,
      Color,
      Highlight.configure({
        multicolor: true,
        HTMLAttributes: {},
      }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: 'Escreva o conteúdo do post...' }),
    ],
    content: initialContent ?? undefined,
    editable: !disabled,
    onCreate: () => { isInitialized.current = true; },
    onUpdate: ({ editor: ed }) => {
      if (!isInitialized.current) return;
      onUpdate(ed.getJSON() as Record<string, unknown>, ed.getText());
    },
  });

  useEffect(() => {
    if (editor) editor.setEditable(!disabled);
  }, [editor, disabled]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (textColorOpen && textColorRef.current && !textColorRef.current.contains(e.target as Node)) {
        setTextColorOpen(false);
      }
      if (highlightOpen && highlightRef.current && !highlightRef.current.contains(e.target as Node)) {
        setHighlightOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [textColorOpen, highlightOpen]);

  const openLinkPopover = useCallback(() => {
    if (!editor) return;
    const existing = editor.getAttributes('link').href ?? '';
    setLinkInputValue(existing);
    setLinkPopoverOpen(true);
    setTextColorOpen(false);
    setHighlightOpen(false);
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

  const applyTextColor = useCallback((color: string | null) => {
    if (!editor) return;
    if (color) {
      editor.chain().focus().setColor(color).run();
    } else {
      editor.chain().focus().unsetColor().run();
    }
    setTextColorOpen(false);
  }, [editor]);

  const applyHighlight = useCallback((color: string | null) => {
    if (!editor) return;
    if (color) {
      editor.chain().focus().setHighlight({ color }).run();
    } else {
      editor.chain().focus().unsetHighlight().run();
    }
    setHighlightOpen(false);
  }, [editor]);

  const currentTextColor = editor?.getAttributes('textStyle').color ?? null;
  const currentHighlight = editor?.getAttributes('highlight').color ?? null;

  return (
    <div className={`post-editor${disabled ? ' post-editor--readonly' : ''}`}>
      {!disabled && (
        <div className="post-editor-toolbar">
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

      {editor && !disabled && (
        <BubbleMenu editor={editor} className="bubble-menu">
          <button
            type="button"
            className={`post-editor-btn${editor.isActive('bold') ? ' active' : ''}`}
            onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}
            title="Negrito"
          >
            <Bold className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={`post-editor-btn${editor.isActive('italic') ? ' active' : ''}`}
            onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
            title="Itálico"
          >
            <Italic className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={`post-editor-btn${editor.isActive('underline') ? ' active' : ''}`}
            onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleUnderline().run(); }}
            title="Sublinhado"
          >
            <UnderlineIcon className="h-3.5 w-3.5" />
          </button>

          <div className="post-editor-link-wrapper">
            <button
              type="button"
              className={`post-editor-btn${editor.isActive('link') ? ' active' : ''}`}
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
                {editor.isActive('link') && (
                  <button type="button" className="post-editor-link-remove" onClick={removeLink}>Remover</button>
                )}
              </div>
            )}
          </div>

          <div className="post-editor-divider" />

          {/* Text color dropdown */}
          <div className="color-dropdown-wrapper" ref={textColorRef}>
            <button
              type="button"
              className={`post-editor-btn${currentTextColor ? ' active' : ''}`}
              onMouseDown={e => {
                e.preventDefault();
                setTextColorOpen(v => !v);
                setHighlightOpen(false);
                setLinkPopoverOpen(false);
              }}
              title="Cor do texto"
              style={{ position: 'relative' }}
            >
              <Baseline className="h-3.5 w-3.5" />
              <span
                className="color-indicator"
                style={{ background: currentTextColor ?? 'var(--text-muted)' }}
              />
            </button>
            {textColorOpen && (
              <div className="color-dropdown" onMouseDown={e => e.stopPropagation()}>
                <div className="color-dropdown-label">Cor do texto</div>
                <div className="color-dropdown-grid">
                  {TEXT_COLORS.map(tc => (
                    <button
                      key={tc.name}
                      type="button"
                      className={`color-swatch${currentTextColor === tc.color || (!currentTextColor && !tc.color) ? ' active' : ''}${!tc.color ? ' color-swatch--default' : ''}`}
                      style={tc.color ? { background: tc.color } : undefined}
                      title={tc.name}
                      onMouseDown={e => {
                        e.preventDefault();
                        applyTextColor(tc.color);
                      }}
                    >
                      {(currentTextColor === tc.color || (!currentTextColor && !tc.color)) && (
                        <Check className="swatch-check" />
                      )}
                      {!tc.color && !(currentTextColor === tc.color) && 'A'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Highlight dropdown */}
          <div className="color-dropdown-wrapper" ref={highlightRef}>
            <button
              type="button"
              className={`post-editor-btn${currentHighlight ? ' active' : ''}`}
              onMouseDown={e => {
                e.preventDefault();
                setHighlightOpen(v => !v);
                setTextColorOpen(false);
                setLinkPopoverOpen(false);
              }}
              title="Cor de fundo"
              style={{ position: 'relative' }}
            >
              <Highlighter className="h-3.5 w-3.5" />
              {currentHighlight && (
                <span
                  className="color-indicator"
                  style={{ background: HIGHLIGHT_COLORS.find(h => h.color === currentHighlight)?.cssColor ?? currentHighlight }}
                />
              )}
            </button>
            {highlightOpen && (
              <div className="color-dropdown" onMouseDown={e => e.stopPropagation()}>
                <div className="color-dropdown-label">Cor de fundo</div>
                <div className="color-dropdown-grid">
                  {HIGHLIGHT_COLORS.map(hc => (
                    <button
                      key={hc.name}
                      type="button"
                      className={`color-swatch${currentHighlight === hc.color || (!currentHighlight && !hc.color) ? ' active' : ''}${!hc.color ? ' color-swatch--default' : ''}`}
                      style={hc.color ? { background: hc.cssColor } : undefined}
                      title={hc.name}
                      onMouseDown={e => {
                        e.preventDefault();
                        applyHighlight(hc.color);
                      }}
                    >
                      {(currentHighlight === hc.color || (!currentHighlight && !hc.color)) && (
                        <Check className="swatch-check" />
                      )}
                      {!hc.color && !(currentHighlight === hc.color) && '⊘'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </BubbleMenu>
      )}

      <EditorContent editor={editor} className="post-editor-content" />
    </div>
  );
}
