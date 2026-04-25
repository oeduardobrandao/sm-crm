import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, List, Upload, FolderPlus, ArrowUpDown } from 'lucide-react';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';
import { getFolderContents, createFolder } from '@/services/fileService';
import { Breadcrumbs } from './components/Breadcrumbs';
import { FolderTree } from './components/FolderTree';
import { FileGrid, formatBytes } from './components/FileGrid';
import { FileUploader } from './components/FileUploader';
import type { SortBy } from './components/FileGrid';
import type { FileRecord } from './types';

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'name', label: 'Nome' },
  { value: 'size', label: 'Tamanho' },
  { value: 'date', label: 'Data' },
];

export default function ArquivosPage() {
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const queryClient = useQueryClient();
  const uploaderRef = useRef<{ openFilePicker: () => void }>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['folder-contents', currentFolderId],
    queryFn: () => getFolderContents(currentFolderId),
  });

  const breadcrumbs = data?.breadcrumbs ?? [];
  const subfolders = data?.subfolders ?? [];
  const files = data?.files ?? [];
  const storage = data?.storage;

  async function handleCreateFolder() {
    const name = window.prompt('Nome da nova pasta:');
    if (!name?.trim()) return;
    try {
      await createFolder(name.trim(), currentFolderId);
      await queryClient.invalidateQueries({ queryKey: ['folder-contents'] });
      toast.success('Pasta criada');
    } catch {
      toast.error('Erro ao criar pasta');
    }
  }

  function handleFileAction(action: string, _file: FileRecord) {
    if (action === 'open') {
      // Task 14: file preview / detail
    }
  }

  return (
    <div
      className="flex h-full min-h-0"
      style={{ padding: 0 }}
    >
      {/* Left panel — folder tree */}
      <aside
        className="flex flex-col border-r border-[var(--border-color)] bg-[var(--card-bg)] flex-shrink-0"
        style={{ width: 260 }}
      >
        <div className="px-4 pt-5 pb-3 border-b border-[var(--border-color)]">
          <h1
            className="text-xl font-bold text-[var(--text-main)] leading-tight"
            style={{ fontFamily: 'var(--font-heading, "Playfair Display", serif)' }}
          >
            Arquivos
          </h1>
        </div>
        <FolderTree
          selectedFolderId={currentFolderId}
          onSelectFolder={setCurrentFolderId}
        />

        {/* Storage usage bar */}
        {storage && storage.quota_bytes > 0 && (
          <div className="px-4 py-3 border-t border-[var(--border-color)]">
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-1.5">
              <span>Armazenamento</span>
              <span>{formatBytes(storage.used_bytes)} de {formatBytes(storage.quota_bytes)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--surface-hover)] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min((storage.used_bytes / storage.quota_bytes) * 100, 100)}%`,
                  backgroundColor:
                    storage.used_bytes / storage.quota_bytes >= 1
                      ? 'var(--danger)'
                      : storage.used_bytes / storage.quota_bytes >= 0.9
                        ? 'var(--warning)'
                        : 'var(--primary-color)',
                }}
              />
            </div>
          </div>
        )}
      </aside>

      {/* Right panel — content area */}
      <main className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[var(--border-color)] bg-[var(--card-bg)] flex-shrink-0">
          <Breadcrumbs
            breadcrumbs={breadcrumbs}
            onNavigate={setCurrentFolderId}
          />

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Upload */}
            <button
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--primary-color)] text-[#12151a] hover:opacity-90 transition-opacity"
              onClick={() => uploaderRef.current?.openFilePicker()}
            >
              <Upload className="h-4 w-4" />
              Upload
            </button>

            {/* New folder for current location */}
            <button
              onClick={handleCreateFolder}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border border-[var(--border-color)] text-[var(--text-main)] hover:bg-[var(--surface-hover)] transition-colors"
            >
              <FolderPlus className="h-4 w-4" />
              Nova pasta
            </button>

            {/* Sort dropdown */}
            <div className="flex items-center gap-1.5 border border-[var(--border-color)] rounded-lg px-2.5 py-1.5">
              <ArrowUpDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="text-sm bg-transparent text-[var(--text-main)] outline-none cursor-pointer appearance-none pr-1"
                aria-label="Ordenar por"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* View mode toggle */}
            <div className="flex items-center border border-[var(--border-color)] rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-[var(--surface-hover)] text-[var(--text-main)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
                aria-label="Grade"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 transition-colors ${
                  viewMode === 'list'
                    ? 'bg-[var(--surface-hover)] text-[var(--text-main)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
                aria-label="Lista"
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Content — wrapped in FileUploader for drag-and-drop */}
        <FileUploader
          folderId={currentFolderId}
          onUploadComplete={() => queryClient.invalidateQueries({ queryKey: ['folder-contents'] })}
          triggerRef={uploaderRef}
        >
          <div className="flex-1 overflow-y-auto p-5">
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Spinner size="lg" />
              </div>
            ) : (
              <FileGrid
                files={files}
                subfolders={subfolders}
                onOpenFolder={setCurrentFolderId}
                onFileAction={handleFileAction}
                viewMode={viewMode}
                onActionComplete={() => queryClient.invalidateQueries({ queryKey: ['folder-contents'] })}
                sortBy={sortBy}
              />
            )}
          </div>
        </FileUploader>
      </main>
    </div>
  );
}
