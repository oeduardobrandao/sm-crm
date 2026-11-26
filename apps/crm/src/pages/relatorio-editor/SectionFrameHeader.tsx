// Barra do topo de cada seção no canvas do editor (spec 2026-10-28-report-platform-sections
// §Editor): alça para arrastar a seção, ícone, título editável (o nome da plataforma ou
// "Geral" fica de placeholder), @ da conta (ou, no Google Meu Negócio, que não tem @, o número
// de unidades) e o menu da seção. A Geral nunca tem título no
// relatório; a de plataforma pode ocultá-lo (hideHeader). Remover pede confirmação quando a
// seção tem widgets.
import { useRef, useState, type HTMLAttributes } from 'react';
import { GripVertical, MoreHorizontal, PanelTop } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { PlatformIcon } from '@mesaas/report-blocks/PlatformIcon';
import {
  SECTION_TITLE_MAX,
  trimSectionTitle,
  type ReportSection,
} from '@mesaas/report-blocks/types';
import { sectionKindName } from './editorText';

export { sectionKindName };

function storedTitle(section: ReportSection): string {
  const t = section.marker.config?.title;
  return typeof t === 'string' ? t : '';
}

/** Nome da seção no editor e nas camadas: o título salvo, senão o nome padrão. */
export function sectionDisplayName(section: ReportSection): string {
  return trimSectionTitle(storedTitle(section)) || sectionKindName(section.kind);
}

export interface SectionFrameHeaderProps {
  section: ReportSection;
  /** Posição da seção e total (bordas desabilitam Mover para cima/baixo). */
  index: number;
  count: number;
  /** @ da conta da plataforma, sem o "@". */
  handle?: string | null;
  /** Rótulo secundário no lugar do @, para plataforma sem @ (ex.: "3 unidades"). */
  detail?: string | null;
  /** attributes + listeners do useSortable da seção, na alça. */
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
  /** Texto cru do campo (com espaços): o layoutOps faz o trim ao gravar. */
  onTitleChange: (title: string) => void;
  onMove: (delta: 1 | -1) => void;
  onToggleHideHeader: () => void;
  /** Já confirmado (ou seção vazia). */
  onRemove: () => void;
}

export function SectionFrameHeader({
  section,
  index,
  count,
  handle,
  detail,
  dragHandleProps,
  onTitleChange,
  onMove,
  onToggleHideHeader,
  onRemove,
}: SectionFrameHeaderProps) {
  const { t } = useTranslation('reportEditor');
  const { kind } = section;
  const kindName = sectionKindName(kind);
  const name = sectionDisplayName(section);
  const hidden = section.marker.config?.hideHeader === true;
  // Sem título no relatório: a Geral nunca tem; a de plataforma, quando oculto.
  const noHeading = kind === 'general' || hidden;

  // Rascunho local: o layout guarda o título já sem espaços nas pontas, então
  // um campo controlado direto pelo layout comeria o espaço entre palavras.
  // Quando o valor salvo muda por fora (desfazer, outra edição), o rascunho
  // segue, a menos que ele já represente esse valor.
  const stored = storedTitle(section);
  const [draft, setDraft] = useState(stored);
  const [seen, setSeen] = useState(stored);
  if (seen !== stored) {
    setSeen(stored);
    if (trimSectionTitle(draft) !== stored) setDraft(stored);
  }

  const inputRef = useRef<HTMLInputElement>(null);
  const renamePending = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="rb-section-frame-header">
      <button
        type="button"
        className="rb-section-frame-grip cursor-grab touch-none"
        aria-label={t('sectionHeaderBar.reorder')}
        {...dragHandleProps}
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>
      {kind === 'general' ? (
        <PanelTop className="rb-section-frame-icon h-4 w-4" aria-hidden />
      ) : (
        <PlatformIcon platform={kind} size={18} className="rb-section-frame-icon" />
      )}
      <input
        ref={inputRef}
        className="rb-section-frame-title"
        aria-label={t('sectionHeaderBar.titleAria', { name: kindName })}
        placeholder={kindName}
        maxLength={SECTION_TITLE_MAX}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          onTitleChange(e.target.value);
        }}
      />
      {handle ? (
        <span className="rb-section-frame-handle">@{handle}</span>
      ) : detail ? (
        <span className="rb-section-frame-handle">{detail}</span>
      ) : null}
      {noHeading ? (
        <span className="rb-section-frame-note">{t('sectionHeaderBar.noHeading')}</span>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rb-section-frame-menu"
            aria-label={t('sectionHeaderBar.menuAria', { name })}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(e) => {
            // "Renomear seção": o foco vai para o título, não volta ao gatilho.
            if (!renamePending.current) return;
            renamePending.current = false;
            e.preventDefault();
            inputRef.current?.focus();
            inputRef.current?.select();
          }}
        >
          <DropdownMenuItem onSelect={() => (renamePending.current = true)}>
            {t('sectionHeaderBar.rename')}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={index <= 0} onSelect={() => onMove(-1)}>
            {t('sectionHeaderBar.moveUp')}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={index >= count - 1} onSelect={() => onMove(1)}>
            {t('sectionHeaderBar.moveDown')}
          </DropdownMenuItem>
          {kind !== 'general' && (
            <DropdownMenuItem onSelect={onToggleHideHeader}>
              {hidden ? t('sectionHeaderBar.showTitle') : t('sectionHeaderBar.hideTitle')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-[var(--danger-text)] focus:text-[var(--danger-text)]"
            onSelect={() => (section.blocks.length > 0 ? setConfirmOpen(true) : onRemove())}
          >
            {t('sectionHeaderBar.remove')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sectionHeaderBar.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('sectionHeaderBar.confirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('sectionHeaderBar.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => onRemove()}
            >
              {t('sectionHeaderBar.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
