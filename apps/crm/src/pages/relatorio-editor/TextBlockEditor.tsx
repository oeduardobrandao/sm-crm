// Editor TipTap dos blocos de texto do relatório. Restrito EXATAMENTE ao que
// packages/report-blocks/tiptap-render.ts sabe renderizar (view/Hub/print):
// paragraph, heading 2-3, listas, blockquote, hr, hardBreak; bold/italic/strike.
// code/codeBlock/link desativados: o renderer degradaria para texto puro.
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, Italic, Strikethrough } from 'lucide-react';
import { useRef } from 'react';
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
  ];
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
      {editor && (
        <BubbleMenu editor={editor} className="bubble-menu">
          <button
            type="button"
            className={`post-editor-btn${editor.isActive('bold') ? ' active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleBold().run();
            }}
            data-tooltip="Negrito"
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
            data-tooltip="Itálico"
          >
            <Italic className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={`post-editor-btn${editor.isActive('strike') ? ' active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleStrike().run();
            }}
            data-tooltip="Tachado"
          >
            <Strikethrough className="h-3.5 w-3.5" />
          </button>
        </BubbleMenu>
      )}
      <EditorContent editor={editor} className="rb-text-editor-content" />
    </div>
  );
}
