import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import UnderlineExt from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { isAllowedRichTextAutolinkUrl } from '@mesaas/link-policy';
import { CalloutExtension } from '@/pages/entregas/components/CalloutExtension';

/**
 * Fonte única do schema de páginas do portal: o editor (PaginaRichTextEditor),
 * o conversor (pageContent) e o script de migração usam este mesmo array.
 * Mudar aqui sem mudar `richTextExtensions()` do Hub quebra o teste de
 * contrato — de propósito.
 */
export function pageEditorExtensions(): AnyExtension[] {
  return [
    // StarterKit v3 already bundles Link and Underline. Without `link: false` /
    // `underline: false` both register twice -- TipTap logs "Duplicate extension
    // names found: ['link','underline']" and keeps BOTH Link instances live, so
    // StarterKit's own `openOnClick: true` handler fires alongside the `openOnClick:
    // false` one configured below, and clicking a link while editing navigates away.
    StarterKit.configure({ link: false, underline: false }),
    UnderlineExt,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    // isAllowedRichTextAutolinkUrl (@mesaas/link-policy) is the autolink-aware form of
    // the same policy the Hub's reader enforces (RichTextContent.tsx): http/https/
    // mailto/tel allowed, everything else (including relative/anchor-only URLs)
    // rejected. Applying it here too -- not just on the read side -- closes the gap
    // where this editor could persist a link the Hub then silently refuses to render
    // (dead `href=""`, no feedback on either side). It resolves a schemeless autolink
    // candidate (TipTap validates the RAW TYPED TEXT, e.g. "contato@exemplo.com", not
    // the `mailto:`/`http:` href it is about to assign) to that href before testing it
    // -- the plain strict policy would reject every such candidate outright, silently
    // disabling autolink for email addresses and bare domains instead of keeping them
    // alive. mailto/tel being allowed on both sides is what makes `autolink: true` safe
    // to keep: an agency typing a contact email address produces a working `mailto:`
    // link, not one that dies in the portal.
    Link.configure({
      openOnClick: false,
      autolink: true,
      isAllowedUri: (url, ctx) => isAllowedRichTextAutolinkUrl(url, ctx),
    }),
    Placeholder.configure({ placeholder: 'Escreva o conteúdo da página…' }),
    CalloutExtension,
  ];
}
