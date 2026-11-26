// Editor TipTap dos blocos de texto do relatório. Restrito EXATAMENTE ao que
// packages/report-blocks/tiptap-render.ts sabe renderizar (view/Hub/print):
// paragraph, heading 2-3, listas, blockquote, hr, hardBreak; bold/italic/
// strike/underline; cor de texto (textStyle #rrggbb) e alinhamento
// (paragraph/heading). code/codeBlock/link desativados: o renderer degradaria
// para texto puro. Toolbar aparece com o foco no bloco (focus-within).
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Palette,
  Strikethrough,
  TextQuote,
  Underline,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Editor } from '@tiptap/core';
import type { AnyExtension } from '@tiptap/core';
import type { ReportBlock } from '@mesaas/report-blocks/types';
import { tr } from './editorText';

export function buildTextBlockExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      code: false,
      codeBlock: false,
      link: false,
    }),
    Placeholder.configure({ placeholder: tr('text.placeholder') }),
    TextStyle,
    Color,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
  ];
}

// Paleta fechada em #rrggbb: o renderer compartilhado só emite cor que passa
// no regex estrito dele — swatch fora desse formato sumiria na visão do
// cliente.
// `id` keys the localized name (text.colorName.*); `name` is the Portuguese label.
export const TEXT_COLORS: readonly { id: string; name: string; hex: string }[] = [
  { id: 'gray', name: 'Cinza', hex: '#6b7280' },
  { id: 'red', name: 'Vermelho', hex: '#dc2626' },
  { id: 'orange', name: 'Laranja', hex: '#ea580c' },
  { id: 'green', name: 'Verde', hex: '#16a34a' },
  { id: 'blue', name: 'Azul', hex: '#2563eb' },
  { id: 'violet', name: 'Violeta', hex: '#7c3aed' },
  { id: 'pink', name: 'Rosa', hex: '#db2777' },
];

interface ToolbarButtonProps {
  label: string;
  active?: boolean;
  onRun: () => void;
  children: React.ReactNode;
}

function ToolbarButton({ label, active, onRun, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={`post-editor-btn${active ? ' active' : ''}`}
      aria-label={label}
      aria-pressed={active ?? false}
      data-tooltip={label}
      onMouseDown={(e) => {
        // preventDefault mantém a seleção/foco no editor durante o clique.
        e.preventDefault();
      }}
      onClick={onRun}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const { t } = useTranslation('reportEditor');
  const [colorOpen, setColorOpen] = useState(false);
  const st = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      h2: ed.isActive('heading', { level: 2 }),
      h3: ed.isActive('heading', { level: 3 }),
      bold: ed.isActive('bold'),
      italic: ed.isActive('italic'),
      underline: ed.isActive('underline'),
      strike: ed.isActive('strike'),
      bullet: ed.isActive('bulletList'),
      ordered: ed.isActive('orderedList'),
      quote: ed.isActive('blockquote'),
      alignCenter: ed.isActive({ textAlign: 'center' }),
      alignRight: ed.isActive({ textAlign: 'right' }),
      color: (ed.getAttributes('textStyle').color as string | undefined) ?? null,
    }),
  });
  return (
    <div className="rb-text-toolbar" role="toolbar" aria-label={t('text.toolbarAria')}>
      <ToolbarButton
        label={t('text.heading')}
        active={st.h2}
        onRun={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label={t('text.subheading')}
        active={st.h3}
        onRun={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 className="h-3.5 w-3.5" />
      </ToolbarButton>
      <span className="rb-text-toolbar-sep" />
      <ToolbarButton
        label={t('text.bold')}
        active={st.bold}
        onRun={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label={t('text.italic')}
        active={st.italic}
        onRun={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label={t('text.underline')}
        active={st.underline}
        onRun={() => editor.chain().focus().toggleUnderline().run()}
      >
        <Underline className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label={t('text.strike')}
        active={st.strike}
        onRun={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="h-3.5 w-3.5" />
      </ToolbarButton>
      <span className="rb-text-toolbar-sep" />
      <div className="rb-text-toolbar-color">
        <ToolbarButton
          label={t('text.color')}
          active={Boolean(st.color)}
          onRun={() => setColorOpen((v) => !v)}
        >
          <Palette className="h-3.5 w-3.5" style={st.color ? { color: st.color } : undefined} />
        </ToolbarButton>
        {colorOpen && (
          <div className="rb-text-swatches" role="listbox" aria-label={t('text.colorsAria')}>
            {TEXT_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                className="rb-text-swatch"
                aria-label={t('text.colorNamed', { name: t(`text.colorName.${c.id}`) })}
                style={{ background: c.hex }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  editor.chain().focus().setColor(c.hex).run();
                  setColorOpen(false);
                }}
              />
            ))}
            <button
              type="button"
              className="rb-text-swatch rb-text-swatch-clear"
              aria-label={t('text.removeColor')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                editor.chain().focus().unsetColor().run();
                setColorOpen(false);
              }}
            >
              ×
            </button>
          </div>
        )}
      </div>
      <span className="rb-text-toolbar-sep" />
      <ToolbarButton
        label={t('text.alignLeft')}
        active={!st.alignCenter && !st.alignRight}
        onRun={() => editor.chain().focus().setTextAlign('left').run()}
      >
        <AlignLeft className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label={t('text.alignCenter')}
        active={st.alignCenter}
        onRun={() => editor.chain().focus().setTextAlign('center').run()}
      >
        <AlignCenter className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label={t('text.alignRight')}
        active={st.alignRight}
        onRun={() => editor.chain().focus().setTextAlign('right').run()}
      >
        <AlignRight className="h-3.5 w-3.5" />
      </ToolbarButton>
      <span className="rb-text-toolbar-sep" />
      <ToolbarButton
        label={t('text.list')}
        active={st.bullet}
        onRun={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label={t('text.orderedList')}
        active={st.ordered}
        onRun={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label={t('text.quote')}
        active={st.quote}
        onRun={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <TextQuote className="h-3.5 w-3.5" />
      </ToolbarButton>
    </div>
  );
}

export interface TextBlockEditorProps {
  block: ReportBlock;
  onTextChange: (id: string, json: unknown) => void;
}

export function TextBlockEditor({ block, onTextChange }: TextBlockEditorProps) {
  // Extensões congeladas no 1º render (useEditor sem deps) — padrão da casa
  // (PostEditor.tsx:120-124). onTextChange vai por ref para não recriar o editor.
  const onTextChangeRef = useRef(onTextChange);
  onTextChangeRef.current = onTextChange;
  const isInitialized = useRef(false);
  // Último texto que ESTE editor emitiu (ou recebeu na criação). updateBlockText
  // guarda o objeto como veio, então block.text === lastText enquanto a edição
  // vem daqui; outra referência = mudança externa (desfazer/refazer do layout).
  const lastText = useRef<unknown>(block.text);

  const editor = useEditor({
    extensions: buildTextBlockExtensions(),
    content: (block.text as object | undefined) ?? undefined,
    onCreate: () => {
      isInitialized.current = true;
    },
    onUpdate: ({ editor: ed }) => {
      if (!isInitialized.current) return;
      const json = ed.getJSON();
      lastText.current = json;
      onTextChangeRef.current(block.id, json);
    },
  });

  useEffect(() => {
    if (!editor || block.text === lastText.current) return;
    lastText.current = block.text;
    // emitUpdate: false -- sem isso o setContent voltaria como edição nova e
    // apagaria o refazer.
    editor.commands.setContent((block.text as object | undefined) ?? '', { emitUpdate: false });
  }, [editor, block.text]);

  return (
    <div className="rb-text-editor">
      {editor && <Toolbar editor={editor} />}
      {/* rb-prose: a MESMA tipografia do TextBlock renderizado (headings,
          listas, citação) — o preflight do Tailwind achata tudo sem ela. */}
      <EditorContent editor={editor} className="rb-text-editor-content rb-prose" />
    </div>
  );
}
