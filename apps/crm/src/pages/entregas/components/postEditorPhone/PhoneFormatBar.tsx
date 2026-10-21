import { useEffect, useReducer, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  Lightbulb,
  ImagePlus,
  Loader2,
  MessageSquare,
  Copy,
  Palette,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { BottomSheet } from '@/components/mobile';
import { usePhoneTextScreenOpen } from './PhoneTextScreen';

export interface ColorChoice {
  name: string;
  color: string | null;
  cssColor?: string;
}

interface PhoneFormatBarProps {
  editor: Editor;
  /** Opens the link input (the editor's own link state and policy check). */
  onLink: () => void;
  /** Opens "Adicionar comentário" for the current selection. Absent: no comments. */
  onComment?: () => void;
  onPickImage?: () => void;
  imageUploading?: boolean;
  textColors: readonly ColorChoice[];
  highlightColors: readonly ColorChoice[];
  onTextColor: (color: string | null) => void;
  onHighlight: (color: string | null) => void;
  /** The link input row, shown in place of the buttons while open. */
  linkRow?: ReactNode;
  /** More `PhoneFormatBarButton`s after the list buttons (headings and quote on Páginas). */
  extraButtons?: ReactNode;
}

/** One button of the bar, for `extraButtons`: keeps the editor's focus on press. */
export function PhoneFormatBarButton({
  label,
  active,
  disabled,
  onPress,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="phone-format-bar__button"
      aria-label={label}
      aria-pressed={active}
      data-active={active || undefined}
      disabled={disabled}
      // mousedown/touch must not take focus from the editor (the keyboard would drop).
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
    >
      {children}
    </button>
  );
}

/**
 * The phone editor's formatting bar and selection menu (EditorTexto mockup). The bar
 * sits at the bottom of the full-screen text editor, which is pinned to the visual
 * viewport, so it rides right above the keyboard. The selection menu (Copiar /
 * Comentar / Link) floats under a non-empty selection, under rather than over it so
 * it doesn't fight iOS's own callout, which opens above.
 *
 * Every command is the same TipTap chain the desktop toolbar and bubble menu run.
 */
export function PhoneFormatBar({
  editor,
  onLink,
  onComment,
  onPickImage,
  imageUploading,
  textColors,
  highlightColors,
  onTextColor,
  onHighlight,
  linkRow,
  extraButtons,
}: PhoneFormatBarProps) {
  const screenOpen = usePhoneTextScreenOpen();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null);

  // Active marks and the selection menu follow the editor's own transactions.
  useEffect(() => {
    if (editor.isDestroyed) return;
    const onChange = () => {
      rerender();
      const { from, to, empty } = editor.state.selection;
      if (empty || !editor.isFocused) {
        setMenu(null);
        return;
      }
      try {
        const wrapper = editor.view.dom.closest('.post-editor') as HTMLElement | null;
        const end = editor.view.coordsAtPos(to);
        const start = editor.view.coordsAtPos(from);
        if (!wrapper) return;
        const box = wrapper.getBoundingClientRect();
        setMenu({
          top: end.bottom - box.top + 8,
          left: Math.max(0, Math.min(start.left - box.left, box.width - 240)),
        });
      } catch {
        setMenu(null);
      }
    };
    editor.on('selectionUpdate', onChange);
    editor.on('transaction', onChange);
    editor.on('blur', onChange);
    return () => {
      editor.off('selectionUpdate', onChange);
      editor.off('transaction', onChange);
      editor.off('blur', onChange);
    };
  }, [editor]);

  if (!screenOpen) return null;

  const copySelection = () => {
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, '\n');
    navigator.clipboard?.writeText(text).then(
      () => toast.success('Texto copiado.'),
      () => toast.error('Não foi possível copiar o texto.'),
    );
  };

  const currentTextColor = editor.getAttributes('textStyle').color ?? null;
  const currentHighlight = editor.getAttributes('highlight').color ?? null;

  return (
    <>
      {menu && (
        <div
          className="phone-selection-menu"
          role="toolbar"
          aria-label="Seleção"
          style={{ top: menu.top, left: menu.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button type="button" onClick={copySelection}>
            <Copy aria-hidden="true" /> Copiar
          </button>
          {onComment && (
            <button type="button" onClick={onComment}>
              <MessageSquare aria-hidden="true" /> Comentar
            </button>
          )}
          <button type="button" onClick={onLink}>
            <LinkIcon aria-hidden="true" /> Link
          </button>
        </div>
      )}
      <div className="phone-format-bar" role="toolbar" aria-label="Formatação">
        {linkRow ?? (
          <>
            <PhoneFormatBarButton
              label="Negrito"
              active={editor.isActive('bold')}
              onPress={() => editor.chain().focus().toggleBold().run()}
            >
              <Bold aria-hidden="true" />
            </PhoneFormatBarButton>
            <PhoneFormatBarButton
              label="Itálico"
              active={editor.isActive('italic')}
              onPress={() => editor.chain().focus().toggleItalic().run()}
            >
              <Italic aria-hidden="true" />
            </PhoneFormatBarButton>
            <PhoneFormatBarButton
              label="Sublinhado"
              active={editor.isActive('underline')}
              onPress={() => editor.chain().focus().toggleUnderline().run()}
            >
              <UnderlineIcon aria-hidden="true" />
            </PhoneFormatBarButton>
            <PhoneFormatBarButton
              label="Lista"
              active={editor.isActive('bulletList')}
              onPress={() => editor.chain().focus().toggleBulletList().run()}
            >
              <List aria-hidden="true" />
            </PhoneFormatBarButton>
            <PhoneFormatBarButton
              label="Lista numerada"
              active={editor.isActive('orderedList')}
              onPress={() => editor.chain().focus().toggleOrderedList().run()}
            >
              <ListOrdered aria-hidden="true" />
            </PhoneFormatBarButton>
            {extraButtons}
            <PhoneFormatBarButton
              label="Inserir link"
              active={editor.isActive('link')}
              onPress={onLink}
            >
              <LinkIcon aria-hidden="true" />
            </PhoneFormatBarButton>
            <PhoneFormatBarButton
              label="Cores"
              active={!!currentTextColor || !!currentHighlight}
              onPress={() => setColorsOpen(true)}
            >
              <Palette aria-hidden="true" />
            </PhoneFormatBarButton>
            <PhoneFormatBarButton
              label="Callout"
              active={editor.isActive('callout')}
              onPress={() => editor.chain().focus().insertCallout().run()}
            >
              <Lightbulb aria-hidden="true" />
            </PhoneFormatBarButton>
            {onPickImage && (
              <PhoneFormatBarButton
                label="Inserir imagem"
                disabled={imageUploading}
                onPress={onPickImage}
              >
                {imageUploading ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : (
                  <ImagePlus aria-hidden="true" />
                )}
              </PhoneFormatBarButton>
            )}
            {onComment && (
              <PhoneFormatBarButton
                label="Comentar"
                disabled={editor.state.selection.empty}
                onPress={onComment}
              >
                <MessageSquare aria-hidden="true" />
              </PhoneFormatBarButton>
            )}
          </>
        )}
      </div>

      <BottomSheet
        open={colorsOpen}
        onOpenChange={setColorsOpen}
        title="Cores"
        detents={['medium']}
      >
        <ColorGrid
          label="Cor do texto"
          choices={textColors}
          current={currentTextColor}
          onPick={(c) => {
            setColorsOpen(false);
            onTextColor(c);
          }}
        />
        <ColorGrid
          label="Cor de fundo"
          choices={highlightColors}
          current={currentHighlight}
          onPick={(c) => {
            setColorsOpen(false);
            onHighlight(c);
          }}
        />
      </BottomSheet>
    </>
  );
}

function ColorGrid({
  label,
  choices,
  current,
  onPick,
}: {
  label: string;
  choices: readonly ColorChoice[];
  current: string | null;
  onPick: (color: string | null) => void;
}) {
  return (
    <div className="phone-color-grid">
      <p className="phone-color-grid__label">{label}</p>
      <div className="phone-color-grid__swatches">
        {choices.map((c) => {
          const selected = current === c.color || (!current && !c.color);
          return (
            <button
              key={c.name}
              type="button"
              className="phone-color-grid__swatch"
              aria-label={c.name}
              aria-pressed={selected}
              style={c.color ? { background: c.cssColor ?? c.color } : undefined}
              onClick={() => onPick(c.color)}
            >
              {selected ? <Check aria-hidden="true" /> : !c.color ? 'A' : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
