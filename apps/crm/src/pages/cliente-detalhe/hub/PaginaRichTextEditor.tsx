// Editor rich text das páginas do portal do cliente (Hub). Substitui o par
// markdown/preview: o texto é editado já com a aparência final.
//
// O schema (pageEditorExtensions) vem inteiro de ./pageEditorSchema -- é a
// fonte única de verdade guardada pelo teste de contrato com
// richTextExtensions() do Hub (__tests__/schemaContract.test.ts). NUNCA monte
// outro array de extensões aqui: um nó/marca que o editor persista e o Hub não
// conheça faz o TipTap descartar o documento inteiro na leitura, em silêncio --
// o cliente abre a página e vê branco.
//
// Por isso mesmo NÃO existe botão de imagem nem `onUploadInlineImage` aqui:
// imagem está fora de escopo deste editor (ver o plano da task).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, useEditorState, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import type { Editor } from '@tiptap/core';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  Highlighter,
} from 'lucide-react';
import { normalizeRichTextLinkUrl } from '@mesaas/link-policy';
import { pageEditorExtensions } from './pageEditorSchema';
import {
  PhoneFormatBar,
  PhoneFormatBarButton,
} from '@/pages/entregas/components/postEditorPhone/PhoneFormatBar';
import { PhoneTextScreen } from '@/pages/entregas/components/postEditorPhone/PhoneTextScreen';
import { TEXT_COLORS, HIGHLIGHT_COLORS } from '@/pages/entregas/components/PostEditor';

// `pageEditor.linkRejected`: mensagem mostrada quando o usuário tenta aplicar um link
// que a política recusa (@mesaas/link-policy) -- sem isso o popover simplesmente fechava
// e a marca nunca era aplicada, sem qualquer explicação (ver PostEditor.tsx para a mesma
// checagem no editor de legendas de post).

interface ToolbarButtonProps {
  label: string;
  active?: boolean;
  onRun: () => void;
  children: React.ReactNode;
}

// Botão de ícone acessível: `aria-label` dá o nome (não há texto visível) e
// `aria-pressed` expõe o estado de alternância a leitores de tela.
// `onMouseDown` com `preventDefault` mantém o foco/seleção no editor -- sem
// isso o clique tira o foco do ProseMirror antes do `onClick` rodar, e o
// comando (ex.: toggleBold) perde a seleção sobre a qual deveria agir.
function ToolbarButton({ label, active, onRun, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={`post-editor-btn${active ? ' active' : ''}`}
      aria-label={label}
      aria-pressed={active ?? false}
      data-tooltip={label}
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      onClick={onRun}
    >
      {children}
    </button>
  );
}

// Controle de link com popover de URL, usado tanto na barra fixa quanto no
// menu flutuante -- cada instância tem seu próprio estado local (não
// compartilhado), então abrir o link na barra e no menu flutuante ao mesmo
// tempo não conflita.
function LinkButton({ editor, active, label }: { editor: Editor; active: boolean; label: string }) {
  const { t } = useTranslation('clientHub');
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const openPopover = useCallback(() => {
    const existing = (editor.getAttributes('link').href as string | undefined) ?? '';
    setValue(existing);
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [editor]);

  const apply = useCallback(() => {
    const url = value.trim();
    if (!url) {
      editor.chain().focus().unsetLink().run();
      setOpen(false);
      return;
    }
    // normalizeRichTextLinkUrl (@mesaas/link-policy) resolves a schemeless candidate
    // ("mesaas.com.br", "contato@exemplo.com") to the href TipTap will actually store --
    // `isAllowedUri` on the Link extension only decides yes/no on a resolved copy, it
    // never rewrites what `setLink` persists. Passing the raw `url` through here is what
    // let a schemeless href reach `setLink` unresolved and render dead (`href=""`) in the
    // Hub. When nothing valid can be resolved, no link is applied and the popover stays
    // open with an explanation instead of silently closing.
    const normalized = normalizeRichTextLinkUrl(url);
    if (!normalized) {
      toast.error(t('pageEditor.linkRejected'));
      return;
    }
    editor.chain().focus().setLink({ href: normalized }).run();
    setOpen(false);
  }, [editor, value, t]);

  const remove = useCallback(() => {
    editor.chain().focus().unsetLink().run();
    setOpen(false);
  }, [editor]);

  return (
    <div className="post-editor-link-wrapper" ref={wrapperRef}>
      <ToolbarButton
        label={label}
        active={active}
        onRun={() => (open ? setOpen(false) : openPopover())}
      >
        <LinkIcon className="h-3.5 w-3.5" />
      </ToolbarButton>
      {open && (
        <div className="post-editor-link-popover" onMouseDown={(e) => e.stopPropagation()}>
          <input
            ref={inputRef}
            className="post-editor-link-input"
            type="url"
            placeholder="https://..."
            aria-label={t('pageEditor.linkAddress')}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                apply();
              }
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          <button type="button" className="post-editor-link-apply" onClick={apply}>
            {t('pageEditor.ok')}
          </button>
          {active && (
            <button type="button" className="post-editor-link-remove" onClick={remove}>
              {t('actions.delete')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Estado reativo compartilhado por barra fixa e menu flutuante -- um único
// useEditorState evita duas assinaturas de transação para a mesma seleção.
function useFormattingState(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      bold: ed.isActive('bold'),
      italic: ed.isActive('italic'),
      underline: ed.isActive('underline'),
      h2: ed.isActive('heading', { level: 2 }),
      h3: ed.isActive('heading', { level: 3 }),
      bulletList: ed.isActive('bulletList'),
      orderedList: ed.isActive('orderedList'),
      blockquote: ed.isActive('blockquote'),
      link: ed.isActive('link'),
      highlight: ed.isActive('highlight'),
    }),
  });
}

// Barra fixa no topo: negrito, itálico, sublinhado, H2/H3, listas, citação,
// link e destaque -- exatamente os controles do plano. Sem botão de imagem.
function Toolbar({ editor }: { editor: Editor }) {
  const st = useFormattingState(editor);
  const { t } = useTranslation('clientHub');

  return (
    <div className="post-editor-toolbar" role="toolbar" aria-label={t('pageEditor.toolbarAria')}>
      <ToolbarButton
        label={t('pageEditor.bold')}
        active={st.bold}
        onRun={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label={t('pageEditor.italic')}
        active={st.italic}
        onRun={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label={t('pageEditor.underline')}
        active={st.underline}
        onRun={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="h-3.5 w-3.5" />
      </ToolbarButton>
      <div className="post-editor-divider" />
      <ToolbarButton
        label={t('pageEditor.heading2')}
        active={st.h2}
        onRun={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label={t('pageEditor.heading3')}
        active={st.h3}
        onRun={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 className="h-3.5 w-3.5" />
      </ToolbarButton>
      <div className="post-editor-divider" />
      <ToolbarButton
        label={t('pageEditor.bulletList')}
        active={st.bulletList}
        onRun={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label={t('pageEditor.orderedList')}
        active={st.orderedList}
        onRun={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label={t('pageEditor.quote')}
        active={st.blockquote}
        onRun={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="h-3.5 w-3.5" />
      </ToolbarButton>
      <div className="post-editor-divider" />
      <LinkButton editor={editor} active={st.link} label={t('pageEditor.link')} />
      <ToolbarButton
        label={t('pageEditor.highlight')}
        active={st.highlight}
        onRun={() => editor.chain().focus().toggleHighlight({ color: 'yellow' }).run()}
      >
        <Highlighter className="h-3.5 w-3.5" />
      </ToolbarButton>
    </div>
  );
}

// Menu flutuante na seleção -- mesmo mecanismo (BubbleMenu de
// @tiptap/react/menus) e mesmo subconjunto de marcas inline que o
// PostEditor/ArticleEditor usam nos deles: acesso rápido sem viajar até a
// barra fixa. Repetir "Negrito"/"Itálico"/etc. aqui não é o defeito de nomes
// acessíveis idênticos apontado em revisões anteriores do plano -- lá, o
// mesmo rótulo apontava para alvos DIFERENTES (um botão por card); aqui os
// dois botões "Negrito" agem sobre a mesma seleção do mesmo editor.
function SelectionMenu({ editor }: { editor: Editor }) {
  const st = useFormattingState(editor);
  const { t } = useTranslation('clientHub');

  return (
    <BubbleMenu editor={editor} className="bubble-menu">
      <ToolbarButton
        label={t('pageEditor.bold')}
        active={st.bold}
        onRun={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label={t('pageEditor.italic')}
        active={st.italic}
        onRun={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label={t('pageEditor.underline')}
        active={st.underline}
        onRun={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="h-3.5 w-3.5" />
      </ToolbarButton>
      <div className="post-editor-divider" />
      <LinkButton editor={editor} active={st.link} label={t('pageEditor.link')} />
      <ToolbarButton
        label={t('pageEditor.highlight')}
        active={st.highlight}
        onRun={() => editor.chain().focus().toggleHighlight({ color: 'yellow' }).run()}
      >
        <Highlighter className="h-3.5 w-3.5" />
      </ToolbarButton>
    </BubbleMenu>
  );
}

export interface PaginaRichTextEditorProps {
  doc: Record<string, unknown>;
  onChange: (doc: Record<string, unknown>) => void;
  /**
   * `phone`: the field opens a full-screen text editor (PhoneTextScreen, its own history
   * entry) with the phone format bar over the keyboard, instead of the desktop toolbar and
   * bubble menu. Same editor instance, same schema, same commands.
   */
  variant?: 'desktop' | 'phone';
}

/** The phone format bar plus what the desktop toolbar has that it lacks (H2, H3, quote),
 *  and the link row with the same URL policy as the desktop popover. */
function PhoneToolbar({ editor }: { editor: Editor }) {
  const st = useFormattingState(editor);
  const { t } = useTranslation('clientHub');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');

  const openLink = () => {
    setLinkValue((editor.getAttributes('link').href as string | undefined) ?? '');
    setLinkOpen(true);
  };
  const applyLink = () => {
    const url = linkValue.trim();
    if (!url) {
      editor.chain().focus().unsetLink().run();
      setLinkOpen(false);
      return;
    }
    const normalized = normalizeRichTextLinkUrl(url);
    if (!normalized) {
      toast.error(t('pageEditor.linkRejected'));
      return;
    }
    editor.chain().focus().setLink({ href: normalized }).run();
    setLinkOpen(false);
  };

  return (
    <PhoneFormatBar
      editor={editor}
      onLink={openLink}
      textColors={TEXT_COLORS}
      highlightColors={HIGHLIGHT_COLORS}
      onTextColor={(color) =>
        color
          ? editor.chain().focus().setColor(color).run()
          : editor.chain().focus().unsetColor().run()
      }
      onHighlight={(color) =>
        color
          ? editor.chain().focus().setHighlight({ color }).run()
          : editor.chain().focus().unsetHighlight().run()
      }
      extraButtons={
        <>
          <PhoneFormatBarButton
            label={t('pageEditor.heading2')}
            active={st.h2}
            onPress={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 aria-hidden="true" />
          </PhoneFormatBarButton>
          <PhoneFormatBarButton
            label={t('pageEditor.heading3')}
            active={st.h3}
            onPress={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            <Heading3 aria-hidden="true" />
          </PhoneFormatBarButton>
          <PhoneFormatBarButton
            label={t('pageEditor.quote')}
            active={st.blockquote}
            onPress={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <Quote aria-hidden="true" />
          </PhoneFormatBarButton>
        </>
      }
      linkRow={
        linkOpen ? (
          <div className="phone-format-bar__link" onMouseDown={(e) => e.stopPropagation()}>
            <input
              className="phone-format-bar__link-input"
              type="url"
              inputMode="url"
              placeholder="https://..."
              aria-label={t('pageEditor.linkAddress')}
              autoFocus
              value={linkValue}
              onChange={(e) => setLinkValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyLink();
                }
                if (e.key === 'Escape') setLinkOpen(false);
              }}
            />
            {st.link && (
              <button
                type="button"
                onClick={() => {
                  editor.chain().focus().unsetLink().run();
                  setLinkOpen(false);
                }}
              >
                {t('actions.delete')}
              </button>
            )}
            <button type="button" onClick={() => setLinkOpen(false)}>
              {t('actions.cancel')}
            </button>
            <button type="button" className="phone-format-bar__link-ok" onClick={applyLink}>
              {t('pageEditor.ok')}
            </button>
          </div>
        ) : undefined
      }
    />
  );
}

export function PaginaRichTextEditor({
  doc,
  onChange,
  variant = 'desktop',
}: PaginaRichTextEditorProps) {
  const { t } = useTranslation('clientHub');
  const [screenOpen, setScreenOpen] = useState(false);
  // onChange por ref: extensões/conteúdo ficam congelados no 1º render
  // (useEditor sem deps, padrão da casa -- PostEditor.tsx), então uma
  // identidade nova de onChange a cada render do pai não pode recriar o
  // editor nem seria capturada por uma closure velha no onUpdate.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const isInitialized = useRef(false);

  const editor = useEditor({
    extensions: pageEditorExtensions(),
    content: doc,
    onCreate: () => {
      isInitialized.current = true;
    },
    onUpdate: ({ editor: ed }) => {
      if (!isInitialized.current) return;
      onChangeRef.current(ed.getJSON() as Record<string, unknown>);
    },
  });

  // Phone: tapping into the field opens the full-screen editor (the format bar only
  // shows there). Same instance either way, so the doc and focus survive the switch.
  useEffect(() => {
    if (variant !== 'phone' || !editor) return;
    const open = () => setScreenOpen(true);
    editor.on('focus', open);
    return () => {
      editor.off('focus', open);
    };
  }, [editor, variant]);

  if (variant === 'phone') {
    return (
      <PhoneTextScreen
        open={screenOpen}
        onOpenChange={setScreenOpen}
        title={t('pageEditor.phoneTitle')}
      >
        <div className="post-editor post-editor--pagina phone-cli-pagina__editor">
          {editor && <PhoneToolbar editor={editor} />}
          <EditorContent editor={editor} className="post-editor-content" />
        </div>
      </PhoneTextScreen>
    );
  }

  return (
    <div className="post-editor post-editor--pagina">
      {editor && <Toolbar editor={editor} />}
      {editor && <SelectionMenu editor={editor} />}
      <EditorContent editor={editor} className="post-editor-content" />
    </div>
  );
}
