import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Folder,
  FileText,
  FileVideo,
  FileImage,
  ChevronRight,
  Check,
  Play,
  Search,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { getFolderContents } from '@/services/fileService';
import type { FileRecord } from '../types';

interface FilePickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (fileIds: number[]) => void;
  filterKind?: ('image' | 'video')[];
}

function FileIcon({ kind, className }: { kind: FileRecord['kind']; className?: string }) {
  if (kind === 'image') return <FileImage className={className} />;
  if (kind === 'video') return <FileVideo className={className} />;
  return <FileText className={className} />;
}

function kindLabel(kind: FileRecord['kind']): string {
  if (kind === 'image') return 'Imagem';
  if (kind === 'video') return 'Vídeo';
  return 'Documento';
}

export function FilePickerModal({ open, onClose, onSelect, filterKind }: FilePickerModalProps) {
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setCurrentFolderId(null);
      setSelectedFileIds(new Set());
      setSearchQuery('');
    }
  }, [open]);

  const { data, isLoading } = useQuery({
    queryKey: ['folder-contents', currentFolderId],
    queryFn: () => getFolderContents(currentFolderId),
    enabled: open,
  });

  const breadcrumbs = data?.breadcrumbs ?? [];
  const subfolders = data?.subfolders ?? [];
  const allFiles = data?.files ?? [];

  // Apply kind filter
  const kindFilteredFiles = filterKind
    ? allFiles.filter((f) => filterKind.includes(f.kind as 'image' | 'video'))
    : allFiles;

  // Apply search filter (client-side)
  const files = searchQuery.trim()
    ? kindFilteredFiles.filter((f) =>
        f.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : kindFilteredFiles;

  const filteredFolders = searchQuery.trim()
    ? subfolders.filter((folder) =>
        folder.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : subfolders;

  function toggleFile(id: number) {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleVincular() {
    onSelect([...selectedFileIds]);
    onClose();
  }

  const selectedCount = selectedFileIds.size;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden flex flex-col" style={{ maxHeight: '70vh' }}>
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-[var(--border-color)] flex-shrink-0">
          <DialogTitle className="text-base font-semibold text-[var(--text-main)]">
            Selecionar arquivos
          </DialogTitle>
        </DialogHeader>

        {/* Breadcrumb bar + search */}
        <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-b border-[var(--border-color)] bg-[var(--card-bg)] flex-shrink-0">
          {/* Mini breadcrumbs */}
          <nav className="flex items-center gap-1 text-xs flex-wrap min-w-0 overflow-hidden">
            <button
              onClick={() => setCurrentFolderId(null)}
              className="text-[var(--text-muted)] hover:text-[var(--primary-color)] transition-colors duration-150 font-medium whitespace-nowrap flex-shrink-0"
            >
              Todos os Arquivos
            </button>
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <span key={crumb.id} className="flex items-center gap-1 min-w-0">
                  <ChevronRight className="h-3 w-3 text-[var(--text-muted)] opacity-50 flex-shrink-0" />
                  {isLast ? (
                    <span className="text-[var(--text-main)] font-medium truncate max-w-[140px]">
                      {crumb.name}
                    </span>
                  ) : (
                    <button
                      onClick={() => setCurrentFolderId(crumb.id)}
                      className="text-[var(--text-muted)] hover:text-[var(--primary-color)] transition-colors duration-150 truncate max-w-[120px]"
                    >
                      {crumb.name}
                    </button>
                  )}
                </span>
              );
            })}
          </nav>

          {/* Search */}
          <div className="relative flex-shrink-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
            <Input
              placeholder="Buscar..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 pl-7 text-xs w-44"
            />
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : filteredFolders.length === 0 && files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[var(--text-muted)]">
              <Folder className="h-10 w-10 mb-2 opacity-30" />
              <p className="text-sm">Nenhum arquivo encontrado</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Folder rows */}
              {filteredFolders.length > 0 && (
                <div className="space-y-1">
                  {filteredFolders.map((folder) => (
                    <button
                      key={folder.id}
                      onClick={() => setCurrentFolderId(folder.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-[var(--surface-hover)] transition-colors text-left group"
                    >
                      <Folder className="h-4 w-4 text-[var(--primary-color)] flex-shrink-0" />
                      <span className="text-sm font-medium text-[var(--text-main)] truncate flex-1">
                        {folder.name}
                      </span>
                      {folder.source === 'system' && (
                        <span className="text-[0.6rem] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-muted)] group-hover:bg-[var(--card-bg)]">
                          AUTO
                        </span>
                      )}
                      <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)] opacity-50 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}

              {/* File grid */}
              {files.length > 0 && (
                <div
                  className="grid gap-2.5"
                  style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}
                >
                  {files.map((file) => {
                    const isSelected = selectedFileIds.has(file.id);
                    const thumbSrc = file.thumbnail_url ?? file.url ?? null;

                    return (
                      <button
                        key={file.id}
                        onClick={() => toggleFile(file.id)}
                        className={`group relative flex flex-col rounded-[14px] overflow-hidden border transition-all duration-150 text-left ${
                          isSelected
                            ? 'border-[var(--primary-color)] shadow-md ring-1 ring-[var(--primary-color)]'
                            : 'border-[var(--border-color)] hover:border-[var(--primary-color)] hover:shadow-sm'
                        } bg-[var(--card-bg)]`}
                      >
                        {/* Thumbnail area */}
                        <div className="relative w-full aspect-square bg-[var(--surface-hover)] flex items-center justify-center overflow-hidden">
                          {(file.kind === 'image' || file.kind === 'video') && thumbSrc ? (
                            <img
                              src={thumbSrc}
                              alt={file.name}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <FileIcon
                              kind={file.kind}
                              className="h-8 w-8 text-[var(--text-muted)] opacity-40"
                            />
                          )}

                          {/* Video play icon overlay */}
                          {file.kind === 'video' && thumbSrc && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="rounded-full bg-black/50 p-1.5">
                                <Play className="h-3 w-3 text-white fill-white" />
                              </div>
                            </div>
                          )}

                          {/* Document kind label (no thumbnail) */}
                          {file.kind === 'document' && (
                            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[0.55rem] uppercase tracking-wide font-semibold px-1 py-0.5 rounded bg-[var(--card-bg)] text-[var(--text-muted)] border border-[var(--border-color)]">
                              {kindLabel(file.kind)}
                            </span>
                          )}

                          {/* Selected checkmark overlay */}
                          {isSelected && (
                            <div className="absolute inset-0 bg-[var(--primary-color)]/20 flex items-end justify-end p-1.5 pointer-events-none">
                              <div className="rounded-full bg-[var(--primary-color)] p-0.5">
                                <Check className="h-3 w-3 text-[#12151a]" />
                              </div>
                            </div>
                          )}
                        </div>

                        {/* File name */}
                        <div className="px-2 py-1.5">
                          <p className="text-[0.65rem] font-medium text-[var(--text-main)] truncate leading-tight">
                            {file.name}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="px-5 py-3 border-t border-[var(--border-color)] flex-shrink-0 flex flex-row items-center justify-between sm:justify-between sm:space-x-0">
          <span className="text-sm text-[var(--text-muted)]">
            {selectedCount === 0
              ? 'Nenhum arquivo selecionado'
              : `${selectedCount} arquivo${selectedCount !== 1 ? 's' : ''} selecionado${selectedCount !== 1 ? 's' : ''}`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={selectedCount === 0}
              onClick={handleVincular}
              className="bg-[var(--primary-color)] text-[#12151a] hover:opacity-90"
            >
              Vincular
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
