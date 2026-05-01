import { useRef, useMemo, useState, useCallback } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale/pt-BR';
import {
  Folder,
  FileText,
  FileVideo,
  FileImage,
  Link as LinkIcon,
} from 'lucide-react';
import type { FileRecord, Folder as FolderType, FolderContents } from '../types';
import { FileContextMenu } from './FileContextMenu';
import { InlineRenameInput } from './InlineRenameInput';
import { getFolderContents, renameFile, renameFolder } from '@/services/fileService';

export type SortBy = 'name' | 'size' | 'date';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function kindLabel(kind: FileRecord['kind']): string {
  if (kind === 'image') return 'Imagem';
  if (kind === 'video') return 'Vídeo';
  return 'Documento';
}

function FileIcon({ kind, className }: { kind: FileRecord['kind']; className?: string }) {
  if (kind === 'image') return <FileImage className={className} />;
  if (kind === 'video') return <FileVideo className={className} />;
  return <FileText className={className} />;
}

interface FileGridProps {
  files: FileRecord[];
  subfolders: FolderType[];
  onOpenFolder: (id: number) => void;
  onFileAction: (action: string, file: FileRecord) => void;
  viewMode: 'grid' | 'list';
  onActionComplete: () => void;
  sortBy?: SortBy;
  isLoading?: boolean;
  currentFolderId?: number | null;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
  onToggleRangeSelect?: (id: number) => void;
  selectionCount?: number;
  onRequestMove?: (id: number, type: 'file' | 'folder') => void;
  onDrop?: (targetFolderId: number, payload: { fileIds: number[]; folderIds: number[] }) => void;
  classifySelection?: () => { fileIds: number[]; folderIds: number[] };
}

function sortFolders(folders: FolderType[], sortBy: SortBy): FolderType[] {
  return [...folders].sort((a, b) => {
    switch (sortBy) {
      case 'size':
        return (b.total_size_bytes ?? 0) - (a.total_size_bytes ?? 0);
      case 'date':
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      case 'name':
      default:
        return a.name.localeCompare(b.name, 'pt-BR');
    }
  });
}

function sortFiles(files: FileRecord[], sortBy: SortBy): FileRecord[] {
  return [...files].sort((a, b) => {
    switch (sortBy) {
      case 'size':
        return b.size_bytes - a.size_bytes;
      case 'date':
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      case 'name':
      default:
        return a.name.localeCompare(b.name, 'pt-BR');
    }
  });
}

export function FileGrid(props: FileGridProps) {
  const {
    files,
    subfolders,
    onOpenFolder,
    onFileAction,
    viewMode,
    onActionComplete,
    sortBy = 'name',
    isLoading,
    currentFolderId,
    selectedIds = new Set<number>(),
    onToggleSelect,
    onToggleRangeSelect,
    selectionCount = 0,
    onRequestMove,
    onDrop,
    classifySelection,
  } = props;
  const queryClient = useQueryClient();
  const prefetchTimeout = useRef<number | undefined>(undefined);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const [renamingId, setRenamingId] = useState<{ id: number; type: 'file' | 'folder' } | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<number | null>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent, itemId: number, itemType: 'file' | 'folder') => {
      let fileIds: number[];
      let folderIds: number[];

      if (selectedIds.has(itemId) && selectionCount > 1) {
        const classified = classifySelection?.() ?? { fileIds: [], folderIds: [] };
        fileIds = classified.fileIds;
        folderIds = classified.folderIds;
      } else {
        fileIds = itemType === 'file' ? [itemId] : [];
        folderIds = itemType === 'folder' ? [itemId] : [];
      }

      e.dataTransfer.setData('application/x-arquivos', JSON.stringify({ fileIds, folderIds }));
      e.dataTransfer.effectAllowed = 'move';

      const ghost = document.createElement('div');
      const count = fileIds.length + folderIds.length;
      ghost.textContent = `Mover ${count} ${count === 1 ? 'item' : 'itens'}`;
      ghost.style.cssText =
        'position:fixed;top:-100px;left:-100px;padding:6px 12px;border-radius:8px;background:#1a1e26;color:#eab308;font-size:12px;font-weight:700;border:1px solid rgba(234,179,8,0.4);white-space:nowrap;pointer-events:none;z-index:9999;';
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 0, 0);
      ghostRef.current = ghost;
    },
    [selectedIds, selectionCount, classifySelection],
  );

  const handleDragEnd = useCallback(() => {
    if (ghostRef.current) {
      document.body.removeChild(ghostRef.current);
      ghostRef.current = null;
    }
  }, []);

  function handleFolderMouseEnter(folderId: number) {
    prefetchTimeout.current = window.setTimeout(() => {
      queryClient.prefetchQuery({
        queryKey: ['folder-contents', folderId],
        queryFn: () => getFolderContents(folderId),
        staleTime: 30_000,
      });
    }, 150);
  }

  function handleFolderMouseLeave() {
    if (prefetchTimeout.current !== undefined) {
      clearTimeout(prefetchTimeout.current);
      prefetchTimeout.current = undefined;
    }
  }

  const renameMutation = useMutation({
    mutationFn: async ({ id, type, name }: { id: number; type: 'file' | 'folder'; name: string }) => {
      if (type === 'folder') return renameFolder(id, name);
      return renameFile(id, name);
    },
    onMutate: async ({ id, type, name }) => {
      const queryKey = ['folder-contents', currentFolderId ?? null];
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<FolderContents>(queryKey);
      if (prev) {
        queryClient.setQueryData(queryKey, {
          ...prev,
          ...(type === 'folder'
            ? { subfolders: prev.subfolders.map((f) => (f.id === id ? { ...f, name } : f)) }
            : { files: prev.files.map((f) => (f.id === id ? { ...f, name } : f)) }),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['folder-contents', currentFolderId ?? null], ctx.prev);
      toast.error('Erro ao renomear');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['folder-contents'] });
      queryClient.invalidateQueries({ queryKey: ['folder-tree'] });
    },
    onSuccess: () => toast.success('Nome atualizado'),
  });

  function handleRenameCommit(id: number, type: 'file' | 'folder', newName: string) {
    setRenamingId(null);
    renameMutation.mutate({ id, type, name: newName });
  }

  function handleRenameCancel() {
    setRenamingId(null);
  }

  // Hooks must always be called before any early return (Rules of Hooks)
  const sortedFolders = useMemo(() => sortFolders(subfolders, sortBy), [subfolders, sortBy]);
  const sortedFiles = useMemo(() => sortFiles(files, sortBy), [files, sortBy]);

  // Skeleton loading state
  if (isLoading) {
    return (
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex flex-col rounded-lg bg-[var(--card-bg)] border border-[var(--border-color)] overflow-hidden animate-pulse">
            <div className="w-full aspect-square bg-[var(--surface-hover)]" />
            <div className="px-3 py-2 space-y-1.5">
              <div className="h-3 w-3/4 bg-[var(--surface-hover)] rounded" />
              <div className="h-2.5 w-1/2 bg-[var(--surface-hover)] rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const isEmpty = subfolders.length === 0 && files.length === 0;

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-[var(--text-muted)]">
        <Folder className="h-12 w-12 mb-3 opacity-30" />
        <p className="text-sm">Nenhum arquivo nesta pasta</p>
      </div>
    );
  }

  if (viewMode === 'list') {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-color)] text-[var(--text-muted)] text-left">
              {selectionCount > 0 && <th className="pb-2 pr-2 w-8" />}
              <th className="pb-2 pr-4 font-medium text-xs uppercase tracking-wide">Nome</th>
              <th className="pb-2 pr-4 font-medium text-xs uppercase tracking-wide">Tipo</th>
              <th className="pb-2 pr-4 font-medium text-xs uppercase tracking-wide">Tamanho</th>
              <th className="pb-2 pr-4 font-medium text-xs uppercase tracking-wide">Data</th>
              <th className="pb-2 font-medium text-xs uppercase tracking-wide">Links</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-color)]">
            {sortedFolders.map((folder) => {
              const isSelected = selectedIds.has(folder.id);
              return (
                <FileContextMenu
                  key={`folder-${folder.id}`}
                  item={folder}
                  type="folder"
                  onActionComplete={onActionComplete}
                  onRename={() => setRenamingId({ id: folder.id, type: 'folder' })}
                  onRequestMove={() => onRequestMove?.(folder.id, 'folder')}
                >
                  <tr
                    className={`hover:bg-[var(--surface-hover)] cursor-pointer transition-colors group${isSelected ? ' bg-[rgba(234,179,8,0.06)]' : ''}`}
                    onClick={() => {
                      if (renamingId?.id === folder.id && renamingId?.type === 'folder') return;
                      if (selectionCount > 0) {
                        onToggleSelect?.(folder.id);
                        return;
                      }
                      onOpenFolder(folder.id);
                    }}
                    onMouseEnter={() => handleFolderMouseEnter(folder.id)}
                    onMouseLeave={handleFolderMouseLeave}
                  >
                    {selectionCount > 0 && (
                      <td className="py-2.5 pr-2">
                        <div
                          className={`w-4 h-4 rounded border-[1.5px] flex items-center justify-center text-[0.55rem] font-bold cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-[var(--primary-color)] border-[var(--primary-color)] text-[#12151a]'
                              : 'border-[var(--border-color)] bg-transparent'
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (e.shiftKey) {
                              onToggleRangeSelect?.(folder.id);
                            } else {
                              onToggleSelect?.(folder.id);
                            }
                          }}
                        >
                          {isSelected && '✓'}
                        </div>
                      </td>
                    )}
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-2">
                        <Folder className="h-4 w-4 text-[var(--primary-color)] flex-shrink-0" />
                        {renamingId?.id === folder.id && renamingId?.type === 'folder' ? (
                          <InlineRenameInput
                            currentName={folder.name}
                            onCommit={(newName) => handleRenameCommit(folder.id, 'folder', newName)}
                            onCancel={handleRenameCancel}
                          />
                        ) : (
                          <span
                            className={`font-medium text-[var(--text-main)] truncate max-w-[260px]${(folder as any)._optimistic ? ' opacity-50' : ''}`}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              setRenamingId({ id: folder.id, type: 'folder' });
                            }}
                          >
                            {folder.name}
                          </span>
                        )}
                        {folder.source === 'system' && (
                          <span className="text-[0.6rem] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-muted)]">
                            AUTO
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-[var(--text-muted)]">Pasta</td>
                    <td className="py-2.5 pr-4 text-[var(--text-muted)] font-mono text-xs">
                      {folder.total_size_bytes != null ? formatBytes(folder.total_size_bytes) : '—'}
                    </td>
                    <td className="py-2.5 pr-4 text-[var(--text-muted)]">
                      {formatDistanceToNow(new Date(folder.created_at), { addSuffix: true, locale: ptBR })}
                    </td>
                    <td className="py-2.5 text-[var(--text-muted)]">
                      {folder.file_count != null ? (
                        <span className="text-xs">{folder.file_count} arquivos</span>
                      ) : '—'}
                    </td>
                  </tr>
                </FileContextMenu>
              );
            })}

            {sortedFiles.map((file) => {
              const isSelected = selectedIds.has(file.id);
              return (
                <FileContextMenu
                  key={`file-${file.id}`}
                  item={file}
                  type="file"
                  onActionComplete={onActionComplete}
                  onRename={() => setRenamingId({ id: file.id, type: 'file' })}
                  onRequestMove={() => onRequestMove?.(file.id, 'file')}
                >
                  <tr
                    className={`hover:bg-[var(--surface-hover)] cursor-pointer transition-colors group${isSelected ? ' bg-[rgba(234,179,8,0.06)]' : ''}`}
                    onClick={() => {
                      if (renamingId?.id === file.id && renamingId?.type === 'file') return;
                      if (selectionCount > 0) {
                        onToggleSelect?.(file.id);
                        return;
                      }
                      onFileAction('open', file);
                    }}
                  >
                    {selectionCount > 0 && (
                      <td className="py-2.5 pr-2">
                        <div
                          className={`w-4 h-4 rounded border-[1.5px] flex items-center justify-center text-[0.55rem] font-bold cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-[var(--primary-color)] border-[var(--primary-color)] text-[#12151a]'
                              : 'border-[var(--border-color)] bg-transparent'
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (e.shiftKey) {
                              onToggleRangeSelect?.(file.id);
                            } else {
                              onToggleSelect?.(file.id);
                            }
                          }}
                        >
                          {isSelected && '✓'}
                        </div>
                      </td>
                    )}
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-2">
                        <FileIcon kind={file.kind} className="h-4 w-4 text-[var(--text-muted)] flex-shrink-0" />
                        {renamingId?.id === file.id && renamingId?.type === 'file' ? (
                          <InlineRenameInput
                            currentName={file.name}
                            onCommit={(newName) => handleRenameCommit(file.id, 'file', newName)}
                            onCancel={handleRenameCancel}
                          />
                        ) : (
                          <span
                            className="font-medium text-[var(--text-main)] truncate max-w-[260px]"
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              setRenamingId({ id: file.id, type: 'file' });
                            }}
                          >
                            {file.name}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-[var(--text-muted)]">{kindLabel(file.kind)}</td>
                    <td className="py-2.5 pr-4 text-[var(--text-muted)] font-mono text-xs">
                      {formatBytes(file.size_bytes)}
                    </td>
                    <td className="py-2.5 pr-4 text-[var(--text-muted)]">
                      {formatDistanceToNow(new Date(file.created_at), { addSuffix: true, locale: ptBR })}
                    </td>
                    <td className="py-2.5">
                      {file.reference_count > 0 ? (
                        <span className="inline-flex items-center gap-1 text-[0.65rem] font-semibold px-1.5 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-muted)]">
                          <LinkIcon className="h-2.5 w-2.5" />
                          {file.reference_count}
                        </span>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                  </tr>
                </FileContextMenu>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // Grid mode
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
      {sortedFolders.map((folder) => {
        const isSelected = selectedIds.has(folder.id);
        return (
          <FileContextMenu
            key={`folder-${folder.id}`}
            item={folder}
            type="folder"
            onActionComplete={onActionComplete}
            onRename={() => setRenamingId({ id: folder.id, type: 'folder' })}
            onRequestMove={() => onRequestMove?.(folder.id, 'folder')}
          >
            <button
              onClick={() => {
                if (renamingId?.id === folder.id && renamingId?.type === 'folder') return;
                if (selectionCount > 0) {
                  onToggleSelect?.(folder.id);
                  return;
                }
                onOpenFolder(folder.id);
              }}
              onMouseEnter={() => handleFolderMouseEnter(folder.id)}
              onMouseLeave={handleFolderMouseLeave}
              draggable={folder.source !== 'system'}
              onDragStart={(e) => {
                if (folder.source === 'system') return;
                handleDragStart(e, folder.id, 'folder');
              }}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('application/x-arquivos')) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }
              }}
              onDragEnter={(e) => {
                if (e.dataTransfer.types.includes('application/x-arquivos')) {
                  setDragOverFolderId(folder.id);
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverFolderId(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOverFolderId(null);
                const raw = e.dataTransfer.getData('application/x-arquivos');
                if (raw) {
                  try {
                    const payload = JSON.parse(raw);
                    onDrop?.(folder.id, payload);
                  } catch {}
                }
              }}
              className={`group relative flex flex-col items-center gap-2 p-4 rounded-sm bg-[var(--card-bg)] border border-[var(--border-color)] hover:border-[var(--primary-color)] hover:shadow-md transition-all duration-150 text-left${isSelected ? ' ring-2 ring-[var(--primary-color)]' : ''}${dragOverFolderId === folder.id ? ' ring-2 ring-[var(--primary-color)] bg-[rgba(234,179,8,0.08)]' : ''}${(folder as any)._optimistic ? ' opacity-50 animate-pulse pointer-events-none' : ''}`}
            >
              {/* Hover checkbox */}
              <div
                className={`absolute top-2 left-2 w-5 h-5 rounded border-[1.5px] flex items-center justify-center text-[0.6rem] font-bold cursor-pointer z-10 transition-all ${
                  isSelected
                    ? 'bg-[var(--primary-color)] border-[var(--primary-color)] text-[#12151a] opacity-100'
                    : 'border-white/60 bg-black/40 opacity-0 group-hover:opacity-100'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (e.shiftKey) {
                    onToggleRangeSelect?.(folder.id);
                  } else {
                    onToggleSelect?.(folder.id);
                  }
                }}
              >
                {isSelected && '✓'}
              </div>

              <Folder className="h-10 w-10 text-[var(--primary-color)]" />
              {renamingId?.id === folder.id && renamingId?.type === 'folder' ? (
                <InlineRenameInput
                  currentName={folder.name}
                  onCommit={(newName) => handleRenameCommit(folder.id, 'folder', newName)}
                  onCancel={handleRenameCancel}
                />
              ) : (
                <span
                  className="text-sm font-medium text-[var(--text-main)] text-center leading-tight line-clamp-2 w-full"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setRenamingId({ id: folder.id, type: 'folder' });
                  }}
                >
                  {folder.name}
                </span>
              )}
              {folder.total_size_bytes != null && (
                <p className="text-[0.65rem] text-[var(--text-muted)] mt-0.5 font-mono">{formatBytes(folder.total_size_bytes)}</p>
              )}
              {folder.source === 'system' && (
                <span className="text-[0.6rem] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-muted)]">
                  AUTO
                </span>
              )}
            </button>
          </FileContextMenu>
        );
      })}

      {sortedFiles.map((file) => {
        const isSelected = selectedIds.has(file.id);
        return (
          <FileContextMenu
            key={`file-${file.id}`}
            item={file}
            type="file"
            onActionComplete={onActionComplete}
            onRename={() => setRenamingId({ id: file.id, type: 'file' })}
            onRequestMove={() => onRequestMove?.(file.id, 'file')}
          >
            <button
              onClick={() => {
                if (renamingId?.id === file.id && renamingId?.type === 'file') return;
                if (selectionCount > 0) {
                  onToggleSelect?.(file.id);
                  return;
                }
                onFileAction('open', file);
              }}
              draggable
              onDragStart={(e) => handleDragStart(e, file.id, 'file')}
              onDragEnd={handleDragEnd}
              className={`group flex flex-col rounded-sm bg-[var(--card-bg)] border border-[var(--border-color)] hover:border-[var(--primary-color)] hover:shadow-md transition-all duration-150 overflow-hidden text-left${isSelected ? ' ring-2 ring-[var(--primary-color)]' : ''}`}
            >
              {/* Thumbnail area */}
              <div className="relative w-full aspect-square bg-[var(--surface-hover)] flex items-center justify-center overflow-hidden">
                {(file.kind === 'image' || file.kind === 'video') && (file.thumbnail_url ?? file.url) ? (
                  <img
                    src={(file.thumbnail_url ?? file.url)!}
                    alt={file.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <FileIcon kind={file.kind} className="h-10 w-10 text-[var(--text-muted)] opacity-40" />
                )}

                {/* Hover checkbox */}
                <div
                  className={`absolute top-2 left-2 w-5 h-5 rounded border-[1.5px] flex items-center justify-center text-[0.6rem] font-bold cursor-pointer z-10 transition-all ${
                    isSelected
                      ? 'bg-[var(--primary-color)] border-[var(--primary-color)] text-[#12151a] opacity-100'
                      : 'border-white/60 bg-black/40 opacity-0 group-hover:opacity-100'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.shiftKey) {
                      onToggleRangeSelect?.(file.id);
                    } else {
                      onToggleSelect?.(file.id);
                    }
                  }}
                >
                  {isSelected && '✓'}
                </div>

                {file.reference_count > 0 && (
                  <span className="absolute top-2 right-2 inline-flex items-center gap-1 text-[0.6rem] font-semibold px-1.5 py-0.5 rounded bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-muted)]">
                    <LinkIcon className="h-2.5 w-2.5" />
                    {file.reference_count}
                  </span>
                )}

                {(file as any)._uploading && (
                  <div className="absolute inset-0 flex items-end bg-black/20">
                    <div className="w-full h-1 bg-black/30">
                      <div
                        className="h-full bg-[var(--primary-color)] transition-all duration-300"
                        style={{ width: `${(file as any)._progress ?? 0}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* File info */}
              <div className="px-3 py-2">
                {renamingId?.id === file.id && renamingId?.type === 'file' ? (
                  <InlineRenameInput
                    currentName={file.name}
                    onCommit={(newName) => handleRenameCommit(file.id, 'file', newName)}
                    onCancel={handleRenameCancel}
                  />
                ) : (
                  <p
                    className="text-xs font-medium text-[var(--text-main)] truncate"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setRenamingId({ id: file.id, type: 'file' });
                    }}
                  >
                    {file.name}
                  </p>
                )}
                <p className="text-[0.65rem] text-[var(--text-muted)] mt-0.5 font-mono">
                  {formatBytes(file.size_bytes)}
                </p>
              </div>
            </button>
          </FileContextMenu>
        );
      })}
    </div>
  );
}
