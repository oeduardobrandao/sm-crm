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
import Youtube from '@tiptap/extension-youtube';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  Baseline,
  Highlighter,
  Check,
  Lightbulb,
  Youtube as YoutubeIcon,
  Code2,
  Heading2,
  Heading3,
} from 'lucide-react';
import { CalloutExtension } from './CalloutExtension';
import { createInlineImageExtension } from './InlineImageExtension';
import type { InlineImageUploadFn } from './InlineImageExtension';
import { IframeExtension } from './IframeExtension';

const TEXT_COLORS = [
  { name: 'Default', color: null },
  { name: 'Gray', color: '#787774' },
  { name: 'Brown', color: '#9F6B53' },
  { name: 'Orange', color: '#D9730D' },
  { name: 'Yellow', color: '#CB912F' },
  { name: 'Green', color: '#448361' },
  { name: 'Blue', color: '#337EA9' },
  { name: 'Purple', color: '#9065B0' },
  { name: 'Pink', color: '#C14C8A' },
] as const;

const HIGHLIGHT_COLORS = [
  { name: 'None', color: null, cssColor: 'transparent' },
  { name: 'Gray', color: 'gray', cssColor: '#E3E2E0' },
  { name: 'Brown', color: 'brown', cssColor: '#EEE0DA' },
  { name: 'Orange', color: 'orange', cssColor: '#FADEC9' },
  { name: 'Yellow', color: 'yellow', cssColor: '#FBF3DB' },
  { name: 'Green', color: 'green', cssColor: '#DBEDDB' },
  { name: 'Blue', color: 'blue', cssColor: '#D3E5EF' },
  { name: 'Purple', color: 'purple', cssColor: '#E8DEEE' },
  { name: 'Pink', color: 'pink', cssColor: '#F4DFEB' },
] as const;

interface ArticleEditorProps {
  initialContent: Record<string, unknown> | null;
  onUpdate: (json: Record<string, unknown>, plain: string) => void;
  disabled?: boolean;
  onUploadInlineImage?: InlineImageUploadFn;
}

export function ArticleEditor({
  initialContent,
  onUpdate,
  disabled,
  onUploadInlineImage,
}: ArticleEditorProps) {
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkInputValue, setLinkInputValue] = useState('');
  const [textColorOpen, setTextColorOpen] = useState(false);
  const [highlightOpen, setHighlightOpen] = useState(false);
  const [youtubePopoverOpen, setYoutubePopoverOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [iframePopoverOpen, setIframePopoverOpen] = useState(false);
  const [iframeUrl, setIframeUrl] = useState('');
  const linkInputRef = useRef<HTMLInputElement>(null);
  const textColorRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const youtubeInputRef = useRef<HTMLInputElement>(null);
  const iframeInputRef = useRef<HTMLInputElement>(null);
  const isInitialized = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      UnderlineExt,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: 'Write article content...' }),
      CalloutExtension,
      Youtube.configure({ inline: false, ccLanguage: 'pt' }),
      IframeExtension,
      ...(onUploadInlineImage ? [createInlineImageExtension(onUploadInlineImage)] : []),
    ],
    content: initialContent ?? undefined,
    editable: !disabled,
    onCreate: () => {
      isInitialized.current = true;
    },
    onUpdate: ({ editor: ed }) => {
      if (!isInitialized.current) return;
      onUpdate(ed.getJSON() as Record<string, unknown>, ed.getText());
    },
  });

  useEffect(() => {
    if (editor && initialContent) {
      editor.commands.setContent(initialContent);
    }
  }, [editor, initialContent]);

  useEffect(() => {
    if (editor) editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        textColorOpen &&
        textColorRef.current &&
        !textColorRef.current.contains(e.target as Node)
      ) {
        setTextColorOpen(false);
      }
      if (
        highlightOpen &&
        highlightRef.current &&
        !highlightRef.current.contains(e.target as Node)
      ) {
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

  const applyTextColor = useCallback(
    (color: string | null) => {
      if (!editor) return;
      if (color) {
        editor.chain().focus().setColor(color).run();
      } else {
        editor.chain().focus().unsetColor().run();
      }
      setTextColorOpen(false);
    },
    [editor],
  );

  const applyHighlight = useCallback(
    (color: string | null) => {
      if (!editor) return;
      if (color) {
        editor.chain().focus().setHighlight({ color }).run();
      } else {
        editor.chain().focus().unsetHighlight().run();
      }
      setHighlightOpen(false);
    },
    [editor],
  );

  const addYoutube = useCallback(() => {
    if (!editor || !youtubeUrl.trim()) return;
    editor.commands.setYoutubeVideo({ src: youtubeUrl.trim() });
    setYoutubeUrl('');
    setYoutubePopoverOpen(false);
  }, [editor, youtubeUrl]);

  const addIframe = useCallback(() => {
    if (!editor || !iframeUrl.trim()) return;
    editor.commands.setIframe({ src: iframeUrl.trim() });
    setIframeUrl('');
    setIframePopoverOpen(false);
  }, [editor, iframeUrl]);

  const currentTextColor = editor?.getAttributes('textStyle').color ?? null;
  const currentHighlight = editor?.getAttributes('highlight').color ?? null;

  return (
    <div className={`post-editor article-editor${disabled ? ' post-editor--readonly' : ''}`}>
      {!disabled && (
        <div className="post-editor-toolbar">
          <button
            type="button"
            className={`post-editor-btn${editor?.isActive('heading', { level: 2 }) ? ' active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              editor?.chain().focus().toggleHeading({ level: 2 }).run();
            }}
            title="Heading 2"
          >
            <Heading2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={`post-editor-btn${editor?.isActive('heading', { level: 3 }) ? ' active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              editor?.chain().focus().toggleHeading({ level: 3 }).run();
            }}
            title="Heading 3"
          >
            <Heading3 className="h-3.5 w-3.5" />
          </button>
          <div className="post-editor-divider" />
          <button
            type="button"
            className={`post-editor-btn${editor?.isActive('bulletList') ? ' active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              editor?.chain().focus().toggleBulletList().run();
            }}
            title="Bullet list"
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={`post-editor-btn${editor?.isActive('orderedList') ? ' active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              editor?.chain().focus().toggleOrderedList().run();
            }}
            title="Ordered list"
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </button>
          <div className="post-editor-divider" />
          <button
            type="button"
            className={`post-editor-btn${editor?.isActive('callout') ? ' active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              editor?.chain().focus().insertCallout().run();
            }}
            title="Callout"
          >
            <Lightbulb className="h-3.5 w-3.5" />
          </button>

          <div className="post-editor-link-wrapper" style={{ position: 'relative' }}>
            <button
              type="button"
              className="post-editor-btn"
              title="YouTube"
              onMouseDown={(e) => {
                e.preventDefault();
                setYoutubePopoverOpen((v) => !v);
                setIframePopoverOpen(false);
                setTimeout(() => youtubeInputRef.current?.focus(), 0);
              }}
            >
              <YoutubeIcon className="h-3.5 w-3.5" />
            </button>
            {youtubePopoverOpen && (
              <div className="post-editor-link-popover" onMouseDown={(e) => e.stopPropagation()}>
                <input
                  ref={youtubeInputRef}
                  className="post-editor-link-input"
                  type="url"
                  placeholder="https://youtube.com/watch?v=..."
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addYoutube();
                    }
                    if (e.key === 'Escape') setYoutubePopoverOpen(false);
                  }}
                />
                <button type="button" className="post-editor-link-apply" onClick={addYoutube}>
                  OK
                </button>
              </div>
            )}
          </div>

          <div className="post-editor-link-wrapper" style={{ position: 'relative' }}>
            <button
              type="button"
              className="post-editor-btn"
              title="Embed (Loom, Arcade)"
              onMouseDown={(e) => {
                e.preventDefault();
                setIframePopoverOpen((v) => !v);
                setYoutubePopoverOpen(false);
                setTimeout(() => iframeInputRef.current?.focus(), 0);
              }}
            >
              <Code2 className="h-3.5 w-3.5" />
            </button>
            {iframePopoverOpen && (
              <div className="post-editor-link-popover" onMouseDown={(e) => e.stopPropagation()}>
                <input
                  ref={iframeInputRef}
                  className="post-editor-link-input"
                  type="url"
                  placeholder="https://www.loom.com/share/..."
                  value={iframeUrl}
                  onChange={(e) => setIframeUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addIframe();
                    }
                    if (e.key === 'Escape') setIframePopoverOpen(false);
                  }}
                />
                <button type="button" className="post-editor-link-apply" onClick={addIframe}>
                  OK
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {editor && !disabled && (
        <BubbleMenu editor={editor} className="bubble-menu">
          <button
            type="button"
            className={`post-editor-btn${editor.isActive('bold') ? ' active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleBold().run();
            }}
          >
            <Bold className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={`post-editor-btn${editor.isActive('italic') ? ' active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleItalic().run();
            }}
          >
            <Italic className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={`post-editor-btn${editor.isActive('underline') ? ' active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleUnderline().run();
            }}
          >
            <UnderlineIcon className="h-3.5 w-3.5" />
          </button>

          <div className="post-editor-link-wrapper">
            <button
              type="button"
              className={`post-editor-btn${editor.isActive('link') ? ' active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                openLinkPopover();
              }}
            >
              <LinkIcon className="h-3.5 w-3.5" />
            </button>
            {linkPopoverOpen && (
              <div className="post-editor-link-popover" onMouseDown={(e) => e.stopPropagation()}>
                <input
                  ref={linkInputRef}
                  className="post-editor-link-input"
                  type="url"
                  placeholder="https://..."
                  value={linkInputValue}
                  onChange={(e) => setLinkInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      applyLink();
                    }
                    if (e.key === 'Escape') setLinkPopoverOpen(false);
                  }}
                />
                <button type="button" className="post-editor-link-apply" onClick={applyLink}>
                  OK
                </button>
                {editor.isActive('link') && (
                  <button type="button" className="post-editor-link-remove" onClick={removeLink}>
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="post-editor-divider" />

          <div className="color-dropdown-wrapper" ref={textColorRef}>
            <button
              type="button"
              className={`post-editor-btn${currentTextColor ? ' active' : ''}`}
              style={{ position: 'relative' }}
              onMouseDown={(e) => {
                e.preventDefault();
                setTextColorOpen((v) => !v);
                setHighlightOpen(false);
                setLinkPopoverOpen(false);
              }}
            >
              <Baseline className="h-3.5 w-3.5" />
              <span
                className="color-indicator"
                style={{ background: currentTextColor ?? 'hsl(var(--muted-foreground))' }}
              />
            </button>
            {textColorOpen && (
              <div className="color-dropdown" onMouseDown={(e) => e.stopPropagation()}>
                <div className="color-dropdown-label">Text color</div>
                <div className="color-dropdown-grid">
                  {TEXT_COLORS.map((tc) => (
                    <button
                      key={tc.name}
                      type="button"
                      className={`color-swatch${currentTextColor === tc.color || (!currentTextColor && !tc.color) ? ' active' : ''}${!tc.color ? ' color-swatch--default' : ''}`}
                      style={tc.color ? { background: tc.color } : undefined}
                      title={tc.name}
                      onMouseDown={(e) => {
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

          <div className="color-dropdown-wrapper" ref={highlightRef}>
            <button
              type="button"
              className={`post-editor-btn${currentHighlight ? ' active' : ''}`}
              style={{ position: 'relative' }}
              onMouseDown={(e) => {
                e.preventDefault();
                setHighlightOpen((v) => !v);
                setTextColorOpen(false);
                setLinkPopoverOpen(false);
              }}
            >
              <Highlighter className="h-3.5 w-3.5" />
              {currentHighlight && (
                <span
                  className="color-indicator"
                  style={{
                    background:
                      HIGHLIGHT_COLORS.find((h) => h.color === currentHighlight)?.cssColor ??
                      currentHighlight,
                  }}
                />
              )}
            </button>
            {highlightOpen && (
              <div className="color-dropdown" onMouseDown={(e) => e.stopPropagation()}>
                <div className="color-dropdown-label">Highlight</div>
                <div className="color-dropdown-grid">
                  {HIGHLIGHT_COLORS.map((hc) => (
                    <button
                      key={hc.name}
                      type="button"
                      className={`color-swatch${currentHighlight === hc.color || (!currentHighlight && !hc.color) ? ' active' : ''}${!hc.color ? ' color-swatch--default' : ''}`}
                      style={hc.color ? { background: hc.cssColor } : undefined}
                      data-highlight={hc.color ?? undefined}
                      title={hc.name}
                      onMouseDown={(e) => {
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

      <EditorContent editor={editor} className="post-editor-content article-editor-content" />
    </div>
  );
}
