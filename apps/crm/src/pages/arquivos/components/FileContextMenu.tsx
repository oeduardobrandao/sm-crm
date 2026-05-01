import { useState, useEffect, useRef, useCallback } from 'react';
import { Pencil, Trash2, Download, Info } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
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
import { FolderInfoModal } from './FolderInfoModal';
import type { Folder, FileRecord } from '../types';

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
  children: React.ReactNode;
  item: Folder | FileRecord;
  type: 'folder' | 'file';
  onActionComplete: () => void;
  onRename?: () => void;
}

interface MenuPosition {
  x: number;
  y: number;
}

export function FileContextMenu({ children, item, type, onActionComplete, onRename }: FileContextMenuProps) {
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
    if (!isFolder && file && file.reference_count > 0) {
      toast.error(
        `Este arquivo está vinculado a ${file.reference_count} post(s). Desvincule primeiro.`
      );
      closeMenu();
      return;
    }
    setDeleteOpen(true);
    closeMenu();
  }

  async function handleRename() {
    const trimmed = renameValue.trim();
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
      const errorMsg = err instanceof Error ? err.message : '';
      if (errorMsg.includes('file_in_use')) {
        toast.error('Este arquivo está em uso e não pode ser excluído.');
      } else {
        toast.error('Erro ao excluir');
      }
    } finally {
      setIsDeleting(false);
    }
  }

  const isSystemFolder = isFolder && folder?.source === 'system';

  return (
    <>
      {/* Wrapper that captures right-click */}
      <div onContextMenu={handleContextMenu} className="contents">
        {children}
      </div>

      {/* Context menu */}
      {menuPos && (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 min-w-[12rem] rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] shadow-lg py-1 text-sm"
          style={{ top: menuPos.y, left: menuPos.x }}
        >
          {/* Rename */}
          <button
            role="menuitem"
            onClick={openRename}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-[var(--text-main)] hover:bg-[var(--surface-hover)] transition-colors"
          >
            <Pencil className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            Renomear
          </button>

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
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={closeMenu}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-[var(--text-main)] hover:bg-[var(--surface-hover)] transition-colors"
            >
              <Download className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              Download
            </a>
          )}

          {/* Separator before delete */}
          <div className="my-1 h-px bg-[var(--border-color)]" />

          {/* Delete */}
          {isSystemFolder ? (
            <div className="flex items-center gap-2.5 px-3 py-2 text-[var(--text-muted)] cursor-not-allowed text-xs italic">
              <Trash2 className="h-3.5 w-3.5 opacity-40" />
              Pasta do sistema — não pode ser excluída
            </div>
          ) : (
            <button
              role="menuitem"
              onClick={openDelete}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-[var(--danger)] hover:bg-[var(--surface-hover)] transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Excluir
            </button>
          )}
        </div>
      )}

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Renomear {isFolder ? 'pasta' : 'arquivo'}</DialogTitle>
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
            <AlertDialogTitle>
              Excluir {isFolder ? 'pasta' : 'arquivo'}?
            </AlertDialogTitle>
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
      <FolderInfoModal
        open={infoOpen}
        onOpenChange={setInfoOpen}
        item={item}
        type={type}
      />
    </>
  );
}
