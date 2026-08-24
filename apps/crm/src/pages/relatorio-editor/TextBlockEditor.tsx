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
import { useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { AnyExtension } from '@tiptap/core';
import type { ReportBlock } from '@mesaas/report-blocks/types';

export function buildTextBlockExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      code: false,
      codeBlock: false,
      link: false,
    }),
    Placeholder.configure({ placeholder: 'Escreva sua análise…' }),
    TextStyle,
    Color,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
  ];
}

// Paleta fechada em #rrggbb: o renderer compartilhado só emite cor que passa
// no regex estrito dele — swatch fora desse formato sumiria na visão do
// cliente.
export const TEXT_COLORS: readonly { name: string; hex: string }[] = [
  { name: 'Cinza', hex: '#6b7280' },
  { name: 'Vermelho', hex: '#dc2626' },
  { name: 'Laranja', hex: '#ea580c' },
  { name: 'Verde', hex: '#16a34a' },
  { name: 'Azul', hex: '#2563eb' },
  { name: 'Violeta', hex: '#7c3aed' },
  { name: 'Rosa', hex: '#db2777' },
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
    <div className="rb-text-toolbar" role="toolbar" aria-label="Formatação do texto">
      <ToolbarButton
        label="Título"
        active={st.h2}
        onRun={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Subtítulo"
        active={st.h3}
        onRun={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 className="h-3.5 w-3.5" />
      </ToolbarButton>
      <span className="rb-text-toolbar-sep" />
      <ToolbarButton
        label="Negrito"
        active={st.bold}
        onRun={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Itálico"
        active={st.italic}
        onRun={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Sublinhado"
        active={st.underline}
        onRun={() => editor.chain().focus().toggleUnderline().run()}
      >
        <Underline className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Tachado"
        active={st.strike}
        onRun={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="h-3.5 w-3.5" />
      </ToolbarButton>
      <span className="rb-text-toolbar-sep" />
      <div className="rb-text-toolbar-color">
        <ToolbarButton
          label="Cor do texto"
          active={Boolean(st.color)}
          onRun={() => setColorOpen((v) => !v)}
        >
          <Palette className="h-3.5 w-3.5" style={st.color ? { color: st.color } : undefined} />
        </ToolbarButton>
        {colorOpen && (
          <div className="rb-text-swatches" role="listbox" aria-label="Cores do texto">
            {TEXT_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                className="rb-text-swatch"
                aria-label={`Cor ${c.name}`}
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
              aria-label="Remover cor"
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
        label="Alinhar à esquerda"
        active={!st.alignCenter && !st.alignRight}
        onRun={() => editor.chain().focus().setTextAlign('left').run()}
      >
        <AlignLeft className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Centralizar"
        active={st.alignCenter}
        onRun={() => editor.chain().focus().setTextAlign('center').run()}
      >
        <AlignCenter className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Alinhar à direita"
        active={st.alignRight}
        onRun={() => editor.chain().focus().setTextAlign('right').run()}
      >
        <AlignRight className="h-3.5 w-3.5" />
      </ToolbarButton>
      <span className="rb-text-toolbar-sep" />
      <ToolbarButton
        label="Lista"
        active={st.bullet}
        onRun={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Lista numerada"
        active={st.ordered}
        onRun={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Citação"
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

  const editor = useEditor({
    extensions: buildTextBlockExtensions(),
    content: (block.text as object | undefined) ?? undefined,
    onCreate: () => {
      isInitialized.current = true;
    },
    onUpdate: ({ editor: ed }) => {
      if (!isInitialized.current) return;
      onTextChangeRef.current(block.id, ed.getJSON());
    },
  });

  return (
    <div className="rb-text-editor">
      {editor && <Toolbar editor={editor} />}
      {/* rb-prose: a MESMA tipografia do TextBlock renderizado (headings,
          listas, citação) — o preflight do Tailwind achata tudo sem ela. */}
      <EditorContent editor={editor} className="rb-text-editor-content rb-prose" />
    </div>
  );
}
