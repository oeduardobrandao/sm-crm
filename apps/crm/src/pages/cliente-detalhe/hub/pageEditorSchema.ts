import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import UnderlineExt from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { CalloutExtension } from '@/pages/entregas/components/CalloutExtension';

/**
 * Fonte única do schema de páginas do portal: o editor (PaginaRichTextEditor),
 * o conversor (pageContent) e o script de migração usam este mesmo array.
 * Mudar aqui sem mudar `richTextExtensions()` do Hub quebra o teste de
 * contrato — de propósito.
 */
export function pageEditorExtensions(): AnyExtension[] {
  return [
    StarterKit,
    UnderlineExt,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    Link.configure({ openOnClick: false, autolink: true }),
    Placeholder.configure({ placeholder: 'Escreva o conteúdo da página…' }),
    CalloutExtension,
  ];
}
