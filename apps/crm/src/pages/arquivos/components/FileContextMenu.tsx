import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Trash2, Download, Info, ArrowRight, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('files');
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
      toast.success(t('fileContextMenu.renameSuccess'));
      onActionComplete();
      setRenameOpen(false);
    } catch {
      toast.error(t('fileContextMenu.renameError'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    setIsDeleting(true);
    try {
      if (isFolder) {
        await deleteFolder(item.id);
        toast.success(t('fileContextMenu.folderDeleted'));
      } else {
        await deleteFile(item.id);
        toast.success(t('fileContextMenu.fileDeleted'));
      }
      onActionComplete();
      setDeleteOpen(false);
    } catch (err: unknown) {
      if (err instanceof FileApiError && err.body.error === 'file_in_use') {
        toast.error(fileInUseMessage(err.body));
      } else {
        toast.error(t('fileContextMenu.deleteError'));
      }
    } finally {
      setIsDeleting(false);
    }
  }

  const isSystemFolder = isFolder && folder?.source === 'system';
  const renameTitle = isFolder
    ? t('fileContextMenu.renameFolderTitle')
    : t('fileContextMenu.renameFileTitle');
  const deleteTitle = isFolder
    ? t('fileContextMenu.deleteFolderTitle')
    : t('fileContextMenu.deleteFileTitle');
  const namePlaceholder = isFolder
    ? t('fileContextMenu.folderNamePlaceholder')
    : t('fileContextMenu.fileNamePlaceholder');
  const deleteMessage = isFolder
    ? t('fileContextMenu.deleteFolderMessage', { name: truncateName(item.name) })
    : t('fileContextMenu.deleteFileMessage', { name: truncateName(item.name) });

  if (variant === 'phone') {
    const first: ContextMenuAction[] = [];
    if (canEdit)
      first.push({
        label: t('fileContextMenu.rename'),
        icon: <Pencil aria-hidden="true" />,
        onSelect: openRename,
      });
    first.push({
      label: t('fileContextMenu.info'),
      icon: <Info aria-hidden="true" />,
      onSelect: openInfo,
    });
    if (!isFolder && file?.url) {
      const url = file.url;
      first.push({
        label: t('fileContextMenu.download'),
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
          label: t('fileContextMenu.moveTo'),
          icon: <ArrowRight aria-hidden="true" />,
          onSelect: () => onRequestMove?.(),
        },
        {
          label: t('fileContextMenu.copyTo'),
          icon: <Copy aria-hidden="true" />,
          onSelect: () => onRequestCopy?.(),
        },
      ]);
    }
    if (isSystemFolder) {
      sections.push([
        {
          label: t('fileContextMenu.systemFolderPhone'),
          icon: <Trash2 aria-hidden="true" />,
          disabled: true,
          onSelect: () => {},
        },
      ]);
    } else if (canEdit) {
      sections.push([
        {
          label: t('fileContextMenu.delete'),
          icon: <Trash2 aria-hidden="true" />,
          destructive: true,
          onSelect: openDelete,
        },
      ]);
    }

    return (
      <>
        <ContextMenu
          label={t('fileContextMenu.actionsLabel', { name: item.name })}
          sections={sections}
          preview={preview}
          disabled={disabled}
        >
          {children}
        </ContextMenu>
        <PhoneNameSheet
          open={renameOpen}
          onOpenChange={setRenameOpen}
          title={renameTitle}
          initialValue={item.name}
          placeholder={namePlaceholder}
          confirmLabel={t('fileContextMenu.save')}
          busyLabel={t('fileContextMenu.saving')}
          busy={isSaving}
          onConfirm={(name) => void renameTo(name)}
        />
        <PhoneConfirmSheet
          open={deleteOpen}
          title={deleteTitle}
          message={deleteMessage}
          onCancel={() => setDeleteOpen(false)}
          actions={[
            {
              label: t('fileContextMenu.delete'),
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
                {t('fileContextMenu.rename')}
              </button>
            )}

            {/* Info */}
            <button
              role="menuitem"
              onClick={openInfo}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-[var(--text-main)] hover:bg-[var(--surface-hover)] transition-colors"
            >
              <Info className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              {t('fileContextMenu.info')}
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
                {t('fileContextMenu.download')}
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
                {t('fileContextMenu.moveTo')}
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
                {t('fileContextMenu.copyTo')}
              </button>
            )}

            {/* Separator before delete */}
            {(canEdit || isSystemFolder) && <div className="my-1 h-px bg-[var(--border-color)]" />}

            {/* Delete */}
            {isSystemFolder ? (
              <div className="flex items-center gap-2.5 px-3 py-2 text-[var(--text-muted)] cursor-not-allowed text-xs italic">
                <Trash2 className="h-3.5 w-3.5 opacity-40" />
                {t('fileContextMenu.systemFolder')}
              </div>
            ) : (
              canEdit && (
                <button
                  role="menuitem"
                  onClick={openDelete}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-[var(--danger)] hover:bg-[var(--surface-hover)] transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('fileContextMenu.delete')}
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
            <DialogTitle>{renameTitle}</DialogTitle>
            <DialogDescription className="sr-only">
              {t('fileContextMenu.renameDescription')}
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
              placeholder={namePlaceholder}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm">
                {t('actions.cancel')}
              </Button>
            </DialogClose>
            <Button size="sm" onClick={handleRename} disabled={isSaving}>
              {isSaving ? t('fileContextMenu.saving') : t('fileContextMenu.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription className="break-all">{deleteMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-[var(--danger)] hover:bg-[var(--danger)] hover:opacity-90 text-white"
            >
              {isDeleting ? t('fileContextMenu.deleting') : t('fileContextMenu.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Info modal */}
      <FolderInfoModal open={infoOpen} onOpenChange={setInfoOpen} item={item} type={type} />
    </>
  );
}
