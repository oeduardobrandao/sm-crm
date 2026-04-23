# PostEditor BubbleMenu & Text Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PostEditor's fixed inline formatting toolbar with a floating BubbleMenu and add Notion-like text color and background highlight options.

**Architecture:** Add TipTap extensions (Color, TextStyle, Highlight) to the editor. Move inline formatting buttons (bold, italic, underline, link) plus new color/highlight dropdowns into a BubbleMenu component. Simplify the fixed top bar to only block-level controls (lists) and character count. Color dropdowns render as small popovers with swatch grids.

**Tech Stack:** TipTap v3, React, CSS custom properties for dark mode, lucide-react icons

---

### Task 1: Install TipTap extensions

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the three new TipTap extensions**

Run:
```bash
npm install @tiptap/extension-color @tiptap/extension-text-style @tiptap/extension-highlight
```

- [ ] **Step 2: Verify installation**

Run: `npm ls @tiptap/extension-color @tiptap/extension-text-style @tiptap/extension-highlight`
Expected: All three listed without errors

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add tiptap color, text-style, and highlight extensions"
```

---

### Task 2: Add CSS styles for BubbleMenu, color dropdowns, and highlight dark mode

**Files:**
- Modify: `apps/crm/style.css:4561-4725` (post-editor section)

- [ ] **Step 1: Add BubbleMenu styles, color dropdown styles, and dark mode highlight overrides**

Insert the following CSS **after** the `.post-editor-link-remove` block (after line 4679) and **before** the `/* ── Edit Workflow Modal footer */` comment (line 4681):

```css
/* ── BubbleMenu ────────────────────────────────────────────────────────────── */
.bubble-menu {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  padding: 0.3rem 0.4rem;
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
}
[data-theme="dark"] .bubble-menu {
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}

.bubble-menu .post-editor-btn { width: 28px; height: 28px; }

.bubble-menu .post-editor-link-wrapper { position: relative; }

/* ── Color dropdown ────────────────────────────────────────────────────────── */
.color-dropdown-wrapper { position: relative; }

.color-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 0.5rem;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
  white-space: nowrap;
}
[data-theme="dark"] .color-dropdown {
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}
.color-dropdown-label {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 0.35rem;
}
.color-dropdown-grid {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
  max-width: 196px;
}

.color-swatch {
  position: relative;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1.5px solid var(--border-color);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.1s, box-shadow 0.1s;
}
.color-swatch:hover {
  transform: scale(1.15);
  box-shadow: 0 0 0 2px var(--surface-3);
}
.color-swatch.active {
  box-shadow: 0 0 0 2px var(--primary-color);
  border-color: var(--primary-color);
}
.color-swatch--default {
  background: var(--surface-2);
  font-size: 0.6rem;
  color: var(--text-muted);
  font-weight: 700;
}
.color-swatch svg.swatch-check {
  width: 12px;
  height: 12px;
  color: #fff;
}
.color-swatch--default svg.swatch-check {
  color: var(--text-color);
}

/* Color indicator bar under the text-color button */
.color-indicator {
  position: absolute;
  bottom: 2px;
  left: 5px;
  right: 5px;
  height: 3px;
  border-radius: 1px;
  background: currentColor;
}

/* Highlight indicator background on the highlight button */
.highlight-indicator {
  position: absolute;
  inset: 4px;
  border-radius: 3px;
  z-index: -1;
  opacity: 0.5;
}

/* ── ProseMirror highlight mark rendering ──────────────────────────────────── */
/* !important overrides inline style="background-color:..." set by TipTap Highlight multicolor */
.post-editor-content .ProseMirror mark[data-color] {
  border-radius: 3px;
  padding: 0.05em 0.15em;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
.post-editor-content .ProseMirror mark[data-color="gray"]   { background-color: #E3E2E0 !important; }
.post-editor-content .ProseMirror mark[data-color="brown"]  { background-color: #EEE0DA !important; }
.post-editor-content .ProseMirror mark[data-color="orange"] { background-color: #FADEC9 !important; }
.post-editor-content .ProseMirror mark[data-color="yellow"] { background-color: #FBF3DB !important; }
.post-editor-content .ProseMirror mark[data-color="green"]  { background-color: #DBEDDB !important; }
.post-editor-content .ProseMirror mark[data-color="blue"]   { background-color: #D3E5EF !important; }
.post-editor-content .ProseMirror mark[data-color="purple"] { background-color: #E8DEEE !important; }
.post-editor-content .ProseMirror mark[data-color="pink"]   { background-color: #F4DFEB !important; }

[data-theme="dark"] .post-editor-content .ProseMirror mark[data-color="gray"]   { background-color: #373737 !important; }
[data-theme="dark"] .post-editor-content .ProseMirror mark[data-color="brown"]  { background-color: #4C3228 !important; }
[data-theme="dark"] .post-editor-content .ProseMirror mark[data-color="orange"] { background-color: #5C3B1E !important; }
[data-theme="dark"] .post-editor-content .ProseMirror mark[data-color="yellow"] { background-color: #564328 !important; }
[data-theme="dark"] .post-editor-content .ProseMirror mark[data-color="green"]  { background-color: #2B4632 !important; }
[data-theme="dark"] .post-editor-content .ProseMirror mark[data-color="blue"]   { background-color: #28456C !important; }
[data-theme="dark"] .post-editor-content .ProseMirror mark[data-color="purple"] { background-color: #412F5A !important; }
[data-theme="dark"] .post-editor-content .ProseMirror mark[data-color="pink"]   { background-color: #5C2746 !important; }
```

- [ ] **Step 2: Commit**

```bash
git add apps/crm/style.css
git commit -m "style: add bubble menu, color dropdown, and highlight dark mode CSS"
```

---

### Task 3: Rewrite PostEditor with BubbleMenu, color extensions, and color dropdowns

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/PostEditor.tsx`

- [ ] **Step 1: Replace the entire PostEditor.tsx with the updated implementation**

Replace the full contents of `apps/crm/src/pages/entregas/components/PostEditor.tsx` with:

```tsx
import { useEffect, useState, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import UnderlineExt from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Color from '@tiptap/extension-color';
import TextStyle from '@tiptap/extension-text-style';
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
```

- [ ] **Step 2: Run typecheck**

Run: `npm run build`
Expected: Build succeeds without TypeScript errors

- [ ] **Step 3: Run tests**

Run: `npm run test`
Expected: All existing tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/entregas/components/PostEditor.tsx
git commit -m "feat: add bubble menu with text color and highlight to PostEditor"
```

---

### Task 4: Manual verification

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Test BubbleMenu**

1. Navigate to a workflow with a post that has text content
2. Select some text in the editor
3. Verify the floating BubbleMenu appears above the selection with buttons: Bold, Italic, Underline, Link, divider, Text Color, Highlight
4. Verify clicking Bold/Italic/Underline toggles formatting on the selected text
5. Verify the BubbleMenu disappears when text is deselected

- [ ] **Step 3: Test Link in BubbleMenu**

1. Select text and click the Link button in the BubbleMenu
2. Verify the link popover appears with URL input
3. Enter a URL, press Enter
4. Verify the link is applied
5. Select the linked text, verify "Remover" button shows

- [ ] **Step 4: Test Text Color**

1. Select text and click the Baseline (A) icon in the BubbleMenu
2. Verify the color dropdown appears with the label "Cor do texto" and 9 swatches
3. Click "Azul" swatch — verify text turns blue (#337EA9)
4. Select the same text again — verify the blue swatch has a checkmark
5. Click "Padrão" — verify text returns to default color

- [ ] **Step 5: Test Highlight**

1. Select text and click the Highlighter icon in the BubbleMenu
2. Verify the dropdown appears with label "Cor de fundo" and 9 swatches
3. Click "Amarelo" — verify text gets a yellow background
4. Click "Nenhum" — verify highlight is removed

- [ ] **Step 6: Test dark mode**

1. Switch to dark mode
2. Apply a highlight (e.g. blue) — verify it uses the dark variant (#28456C) not the light one
3. Verify text colors remain legible in dark mode

- [ ] **Step 7: Test fixed top bar**

1. Verify the top bar only shows bullet list, ordered list, and character count
2. Verify list buttons work correctly

- [ ] **Step 8: Test readonly mode**

1. View a post in readonly/disabled mode
2. Verify neither the BubbleMenu nor the top bar toolbar appear
3. Verify highlight and text color formatting renders correctly in readonly

- [ ] **Step 9: Commit any fixes if needed**

If any issues found, fix and commit:
```bash
git add -u
git commit -m "fix: address issues found during PostEditor manual testing"
```
