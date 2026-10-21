import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Trash2, Download, Info, ArrowRight, Copy } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Slot } from '@radix-ui/react-slot';
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
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { renameFolder, deleteFolder, renameFile, deleteFile } from '@/services/fileService';
import { FileApiError } from '@/services/fileApiError';
import { fileInUseMessage } from '../fileInUse';
import { FolderInfoModal } from './FolderInfoModal';
import type { Folder, FileRecord } from '../types';
import { openExternalUrl, sanitizeExternalUrl } from '@/utils/security';
import {
  ContextMenu,
  type ContextMenuAction,
  type ContextMenuTriggerProps,
} from '@/components/mobile/ContextMenu';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { PhoneNameSheet } from '../phone/PhoneNameSheet';

function truncateName(name: string, max = 40): string {
  if (name.length <= max) return name;
  const ext = name.lastIndexOf('.');
  if (ext > 0) {
    const suffix = name.slice(ext);
    const keep = max - suffix.length - 3;
    if (keep > 4) return name.slice(0, keep) + '…' + suffix;
  }
  return name.slice(0, max - 1) + '…';
}

interface FileContextMenuProps {
  /**
   * The target. Desktop: one element that receives `onContextMenu` (right-click). Phone:
   * the hold target; pass a function to also get the props of an explicit "…" trigger.
   */
  children: React.ReactElement | ((api: { triggerProps: ContextMenuTriggerProps }) => ReactNode);
  item: Folder | FileRecord;
  /**
   * `phone`: the kit's long-press ContextMenu with a lifted preview, rename in a sheet and
   * an action-sheet confirm (iOS Safari never fires `contextmenu` on a long-press, so the
   * desktop menu is unreachable there). Defaults to the right-click menu.
   */
  variant?: 'desktop' | 'phone';
  /** Phone only: compact copy of the item shown above the menu. */
  preview?: ReactNode;
  /** Phone only: no menu (selection mode owns the tap). */
  disabled?: boolean;
  type: 'folder' | 'file';
  onActionComplete: () => void;
  onRename?: () => void;
  onRequestMove?: () => void;
  onRequestCopy?: () => void;
  /** `can('arquivos', 'editar') === true`. Required (not defaulted) so every
   * caller (FileGrid.tsx, MobileArquivosView.tsx) makes this decision
   * explicitly. Hides Renomear/Excluir; Informações/Download stay visible
   * (read-only). */
  canEdit: boolean;
}

interface MenuPosition {
  x: number;
  y: number;
}

export function FileContextMenu({
  children,
  item,
  type,
  onActionComplete,
  onRename,
  onRequestMove,
  onRequestCopy,
  canEdit,
  variant = 'desktop',
  preview,
  disabled,
}: FileContextMenuProps) {
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isFolder = type === 'folder';
  const folder = isFolder ? (item as Folder) : null;
  const file = !isFolder ? (item as FileRecord) : null;

  const closeMenu = useCallback(() => setMenuPos(null), []);

  // Close on outside click or Escape
  useEffect(() => {
    if (!menuPos) return;

    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeMenu();
    }

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuPos, closeMenu]);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    // Clamp menu so it doesn't overflow the viewport
    const menuWidth = 192;
    const menuHeight = isFolder ? 140 : 180;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8);

    setMenuPos({ x, y });
  }

  function openRename() {
    closeMenu();
    if (onRename) {
      onRename();
      return;
    }
    setRenameValue(item.name);
    setRenameOpen(true);
  }

  function openInfo() {
    setInfoOpen(true);
    closeMenu();
  }

  function openDelete() {
    setDeleteOpen(true);
    closeMenu();
  }

  async function handleRename() {
    await renameTo(renameValue.trim());
  }

  async function renameTo(trimmed: string) {
    if (!trimmed || trimmed === item.name) {
      setRenameOpen(false);
      return;
    }
    setIsSaving(true);
    try {
      if (isFolder) {
        await renameFolder(item.id, trimmed);
      } else {
        await renameFile(item.id, trimmed);
      }
      toast.success('Nome atualizado');
      onActionComplete();
      setRenameOpen(false);
    } catch {
      toast.error('Erro ao renomear');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    setIsDeleting(true);
    try {
      if (isFolder) {
        await deleteFolder(item.id);
        toast.success('Pasta excluída');
      } else {
        await deleteFile(item.id);
        toast.success('Arquivo excluído');
      }
      onActionComplete();
      setDeleteOpen(false);
    } catch (err: unknown) {
      if (err instanceof FileApiError && err.body.error === 'file_in_use') {
        toast.error(fileInUseMessage(err.body));
      } else {
        toast.error('Erro ao excluir');
      }
    } finally {
      setIsDeleting(false);
    }
  }

  const isSystemFolder = isFolder && folder?.source === 'system';

  if (variant === 'phone') {
    const kindLabel = isFolder ? 'pasta' : 'arquivo';
    const first: ContextMenuAction[] = [];
    if (canEdit)
      first.push({ label: 'Renomear', icon: <Pencil aria-hidden="true" />, onSelect: openRename });
    first.push({ label: 'Informações', icon: <Info aria-hidden="true" />, onSelect: openInfo });
    if (!isFolder && file?.url) {
      const url = file.url;
      first.push({
        label: 'Download',
        icon: <Download aria-hidden="true" />,
        // Inside the tap: a new tab opened after the menu's history pop is popup-blocked.
        immediate: true,
        onSelect: () => {
          openExternalUrl(url);
        },
      });
    }
    const sections: ContextMenuAction[][] = [first];
    if (canEdit) {
      sections.push([
        {
          label: 'Mover para…',
          icon: <ArrowRight aria-hidden="true" />,
          onSelect: () => onRequestMove?.(),
        },
        {
          label: 'Copiar para…',
          icon: <Copy aria-hidden="true" />,
          onSelect: () => onRequestCopy?.(),
        },
      ]);
    }
    if (isSystemFolder) {
      sections.push([
        {
          label: 'Pasta do sistema: não pode ser excluída',
          icon: <Trash2 aria-hidden="true" />,
          disabled: true,
          onSelect: () => {},
        },
      ]);
    } else if (canEdit) {
      sections.push([
        {
          label: 'Excluir',
          icon: <Trash2 aria-hidden="true" />,
          destructive: true,
          onSelect: openDelete,
        },
      ]);
    }

    return (
      <>
        <ContextMenu
          label={`Ações de ${item.name}`}
          sections={sections}
          preview={preview}
          disabled={disabled}
        >
          {children}
        </ContextMenu>
        <PhoneNameSheet
          open={renameOpen}
          onOpenChange={setRenameOpen}
          title={`Renomear ${kindLabel}`}
          initialValue={item.name}
          placeholder={isFolder ? 'Nome da pasta' : 'Nome do arquivo'}
          confirmLabel="Salvar"
          busyLabel="Salvando…"
          busy={isSaving}
          onConfirm={(name) => void renameTo(name)}
        />
        <PhoneConfirmSheet
          open={deleteOpen}
          title={`Excluir ${kindLabel}?`}
          message={
            isFolder
              ? `A pasta "${truncateName(item.name)}" e todos os seus arquivos serão excluídos permanentemente. Esta ação não pode ser desfeita.`
              : `O arquivo "${truncateName(item.name)}" será excluído permanentemente. Esta ação não pode ser desfeita.`
          }
          onCancel={() => setDeleteOpen(false)}
          actions={[
            {
              label: 'Excluir',
              destructive: true,
              onSelect: () => {
                // Closed before the request, so a failure leaves the confirm reopenable.
                setDeleteOpen(false);
                void handleDelete();
              },
            },
          ]}
        />
        <FolderInfoModal open={infoOpen} onOpenChange={setInfoOpen} item={item} type={type} />
      </>
    );
  }

  return (
    <>
      <Slot onContextMenu={handleContextMenu}>{children as React.ReactElement}</Slot>

      {/* Context menu */}
      {menuPos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-50 min-w-[12rem] rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] shadow-lg py-1 text-sm"
            style={{ top: menuPos.y, left: menuPos.x }}
          >
            {/* Rename */}
            {canEdit && (
              <button
                role="menuitem"
                onClick={openRename}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-[var(--text-main)] hover:bg-[var(--surface-hover)] transition-colors"
              >
                <Pencil className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                Renomear
              </button>
            )}

            {/* Info */}
            <button
              role="menuitem"
              onClick={openInfo}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-[var(--text-main)] hover:bg-[var(--surface-hover)] transition-colors"
            >
              <Info className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              Informações
            </button>

            {/* Download — files only */}
            {!isFolder && file?.url && (
              <a
                role="menuitem"
                href={sanitizeExternalUrl(file.url)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={closeMenu}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-[var(--text-main)] hover:bg-[var(--surface-hover)] transition-colors"
              >
                <Download className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                Download
              </a>
            )}

            {/* Move to… */}
            {canEdit && (
              <button
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  onRequestMove?.();
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-[var(--text-main)] hover:bg-[var(--surface-hover)] transition-colors"
              >
                <ArrowRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                Mover para…
              </button>
            )}

            {/* Copy to… */}
            {canEdit && (
              <button
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  onRequestCopy?.();
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-[var(--text-main)] hover:bg-[var(--surface-hover)] transition-colors"
              >
                <Copy className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                Copiar para…
              </button>
            )}

            {/* Separator before delete */}
            {(canEdit || isSystemFolder) && <div className="my-1 h-px bg-[var(--border-color)]" />}

            {/* Delete */}
            {isSystemFolder ? (
              <div className="flex items-center gap-2.5 px-3 py-2 text-[var(--text-muted)] cursor-not-allowed text-xs italic">
                <Trash2 className="h-3.5 w-3.5 opacity-40" />
                Pasta do sistema — não pode ser excluída
              </div>
            ) : (
              canEdit && (
                <button
                  role="menuitem"
                  onClick={openDelete}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-[var(--danger)] hover:bg-[var(--surface-hover)] transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Excluir
                </button>
              )
            )}
          </div>,
          document.body,
        )}

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Renomear {isFolder ? 'pasta' : 'arquivo'}</DialogTitle>
            <DialogDescription className="sr-only">
              Informe o novo nome e salve para concluir.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
              }}
              autoFocus
              placeholder={isFolder ? 'Nome da pasta' : 'Nome do arquivo'}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm">
                Cancelar
              </Button>
            </DialogClose>
            <Button size="sm" onClick={handleRename} disabled={isSaving}>
              {isSaving ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {isFolder ? 'pasta' : 'arquivo'}?</AlertDialogTitle>
            <AlertDialogDescription className="break-all">
              {isFolder
                ? `A pasta "${truncateName(item.name)}" e todos os seus arquivos serão excluídos permanentemente. Esta ação não pode ser desfeita.`
                : `O arquivo "${truncateName(item.name)}" será excluído permanentemente. Esta ação não pode ser desfeita.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-[var(--danger)] hover:bg-[var(--danger)] hover:opacity-90 text-white"
            >
              {isDeleting ? 'Excluindo…' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Info modal */}
      <FolderInfoModal open={infoOpen} onOpenChange={setInfoOpen} item={item} type={type} />
    </>
  );
}
