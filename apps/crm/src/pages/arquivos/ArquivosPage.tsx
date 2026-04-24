import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, List, Upload, FolderPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';
import { getFolderContents, createFolder } from '@/services/fileService';
import { Breadcrumbs } from './components/Breadcrumbs';
import { FolderTree } from './components/FolderTree';
import { FileGrid } from './components/FileGrid';
import type { FileRecord } from './types';

export default function ArquivosPage() {
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['folder-contents', currentFolderId],
    queryFn: () => getFolderContents(currentFolderId),
  });

  const breadcrumbs = data?.breadcrumbs ?? [];
  const subfolders = data?.subfolders ?? [];
  const files = data?.files ?? [];

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
            {/* Upload placeholder */}
            <button
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--primary-color)] text-[#12151a] hover:opacity-90 transition-opacity"
              onClick={() => toast.info('Upload — disponível em breve')}
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

        {/* Content */}
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
            />
          )}
        </div>
      </main>
    </div>
  );
}
