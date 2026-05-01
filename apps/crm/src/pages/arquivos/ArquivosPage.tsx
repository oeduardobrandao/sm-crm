import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { LayoutGrid, List, Upload, FolderPlus, ArrowUpDown } from 'lucide-react';
import { toast } from 'sonner';
import { getFolderContents, createFolder, getFileDownloadUrl } from '@/services/fileService';
import { Breadcrumbs } from './components/Breadcrumbs';
import { FolderTree } from './components/FolderTree';
import { FileGrid, formatBytes } from './components/FileGrid';
import { FileUploader } from './components/FileUploader';
import { CreateFolderModal } from './components/CreateFolderModal';
import { MobileArquivosView } from './components/MobileArquivosView';
import { PostMediaLightbox } from '../entregas/components/PostMediaLightbox';
import type { SortBy } from './components/FileGrid';
import type { FileRecord, FolderContents } from './types';
import type { PostMedia } from '../../store';

function useIsMobile(breakpoint = 900) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= breakpoint);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
}

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'name', label: 'Nome' },
  { value: 'size', label: 'Tamanho' },
  { value: 'date', label: 'Data' },
];

export default function ArquivosPage() {
  const isMobile = useIsMobile();
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [createFolderParent, setCreateFolderParent] = useState<number | null | undefined>(undefined);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const queryClient = useQueryClient();
  const uploaderRef = useRef<{ openFilePicker: () => void }>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['folder-contents', currentFolderId],
    queryFn: () => getFolderContents(currentFolderId),
    gcTime: 5 * 60 * 1000,
  });

  // Seed the folder-tree cache whenever we load folder contents
  useEffect(() => {
    if (data?.subfolders) {
      queryClient.setQueryData(
        ['folder-tree', currentFolderId],
        data.subfolders.map(f => ({
          id: f.id,
          name: f.name,
          source: f.source,
          source_type: f.source_type,
          position: f.position,
          has_children: f.has_children ?? false,
        }))
      );
    }
  }, [data, currentFolderId, queryClient]);

  const breadcrumbs = data?.breadcrumbs ?? [];
  const subfolders = data?.subfolders ?? [];
  const files = data?.files ?? [];
  const storage = data?.storage;

  const mediaFiles = files.filter(f => f.kind === 'image' || f.kind === 'video');
  const lightboxMedia: PostMedia[] = mediaFiles.map(f => ({
    id: f.id,
    post_id: 0,
    conta_id: f.conta_id,
    r2_key: f.r2_key,
    thumbnail_r2_key: f.thumbnail_r2_key,
    kind: f.kind as 'image' | 'video',
    mime_type: f.mime_type,
    size_bytes: f.size_bytes,
    original_filename: f.name,
    width: f.width,
    height: f.height,
    duration_seconds: f.duration_seconds,
    is_cover: false,
    sort_order: 0,
    uploaded_by: f.uploaded_by,
    created_at: f.created_at,
    blur_data_url: f.blur_data_url,
    url: f.url,
    thumbnail_url: f.thumbnail_url,
  }));

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => createFolder(name, createFolderParent ?? null),
    onMutate: async (name) => {
      const parentId = createFolderParent ?? null;
      await queryClient.cancelQueries({ queryKey: ['folder-contents', parentId] });
      const previous = queryClient.getQueryData<FolderContents>(['folder-contents', parentId]);
      queryClient.setQueryData<FolderContents>(['folder-contents', parentId], old => {
        if (!old) return old;
        const tempFolder = {
          id: -Date.now(),
          conta_id: '',
          parent_id: parentId,
          name,
          source: 'user' as const,
          source_type: null,
          source_id: null,
          name_overridden: false,
          position: 9999,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          total_size_bytes: 0,
          file_count: 0,
          _optimistic: true,
        };
        return { ...old, subfolders: [...old.subfolders, tempFolder] };
      });
      return { previous, parentId };
    },
    onError: (_err, _vars, context) => {
      if (context) queryClient.setQueryData(['folder-contents', context.parentId], context.previous);
      toast.error('Erro ao criar pasta');
    },
    onSettled: (_data, _err, _vars, context) => {
      if (context) {
        queryClient.invalidateQueries({ queryKey: ['folder-contents', context.parentId] });
        queryClient.invalidateQueries({ queryKey: ['folder-tree'] });
      }
    },
    onSuccess: () => toast.success('Pasta criada'),
  });

  function handleFileAction(action: string, file: FileRecord) {
    if (action !== 'open') return;

    if (file.kind === 'image' || file.kind === 'video') {
      const idx = mediaFiles.findIndex(f => f.id === file.id);
      if (idx >= 0) {
        setLightboxIndex(idx);
        setLightboxOpen(true);
      }
    } else {
      if (file.url) {
        window.open(file.url, '_blank');
      } else {
        getFileDownloadUrl(file.id)
          .then(url => window.open(url, '_blank'))
          .catch(() => toast.error('Erro ao abrir arquivo'));
      }
    }
  }

  if (isMobile) {
    return (
      <div className="page-full-bleed flex flex-col">
        <FileUploader
          folderId={currentFolderId}
          onUploadComplete={() => {
            queryClient.invalidateQueries({ queryKey: ['folder-contents', currentFolderId] });
            queryClient.invalidateQueries({ queryKey: ['folder-tree', currentFolderId] });
          }}
          triggerRef={uploaderRef}
        >
          <MobileArquivosView
            breadcrumbs={breadcrumbs}
            subfolders={subfolders}
            files={files}
            storage={storage}
            isLoading={isLoading}
            currentFolderId={currentFolderId}
            onNavigate={setCurrentFolderId}
            onFileAction={handleFileAction}
            onUploadClick={() => uploaderRef.current?.openFilePicker()}
            onCreateFolder={() => setCreateFolderParent(currentFolderId)}
            onActionComplete={() => {
              queryClient.invalidateQueries({ queryKey: ['folder-contents', currentFolderId] });
              queryClient.invalidateQueries({ queryKey: ['folder-tree'] });
            }}
          />
        </FileUploader>
        <PostMediaLightbox
          media={lightboxMedia}
          initialIndex={lightboxIndex}
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
        />
        <CreateFolderModal
          open={createFolderParent !== undefined}
          onOpenChange={(open) => { if (!open) setCreateFolderParent(undefined); }}
          onConfirm={(name) => createFolderMutation.mutate(name)}
        />
      </div>
    );
  }

  return (
    <div className="page-full-bleed flex min-h-0">
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
          onRequestCreateFolder={setCreateFolderParent}
        />

        {/* Storage usage bar */}
        {storage && (
          <div className="px-4 py-3 border-t border-[var(--border-color)]">
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-1.5">
              <span>Armazenamento</span>
              <span>
                {storage.quota_bytes
                  ? `${formatBytes(storage.used_bytes)} de ${formatBytes(storage.quota_bytes)}`
                  : formatBytes(storage.used_bytes)}
              </span>
            </div>
            {storage.quota_bytes > 0 && (
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
            )}
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
            isLoading={isLoading}
          />

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Upload */}
            <button
              className="flex items-center gap-2 px-3 py-1.5 rounded-sm text-sm font-medium bg-[var(--primary-color)] text-[#12151a] hover:opacity-90 transition-opacity"
              onClick={() => uploaderRef.current?.openFilePicker()}
            >
              <Upload className="h-4 w-4" />
              Upload
            </button>

            {/* New folder for current location */}
            <button
              onClick={() => setCreateFolderParent(currentFolderId)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-sm text-sm font-medium border border-[var(--border-color)] text-[var(--text-main)] hover:bg-[var(--surface-hover)] transition-colors"
            >
              <FolderPlus className="h-4 w-4" />
              Nova pasta
            </button>

            {/* Sort dropdown */}
            <div className="flex items-center gap-1.5 border border-[var(--border-color)] rounded-sm px-2.5 py-1.5">
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
            <div className="flex items-center border border-[var(--border-color)] rounded-sm overflow-hidden">
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
          onUploadComplete={() => {
            queryClient.invalidateQueries({ queryKey: ['folder-contents', currentFolderId] });
            queryClient.invalidateQueries({ queryKey: ['folder-tree', currentFolderId] });
          }}
          triggerRef={uploaderRef}
        >
          <div className="flex-1 overflow-y-auto p-5">
            <FileGrid
              files={files}
              subfolders={subfolders}
              onOpenFolder={setCurrentFolderId}
              onFileAction={handleFileAction}
              viewMode={viewMode}
              onActionComplete={() => {
                queryClient.invalidateQueries({ queryKey: ['folder-contents', currentFolderId] });
                queryClient.invalidateQueries({ queryKey: ['folder-tree'] });
              }}
              sortBy={sortBy}
              isLoading={isLoading}
              currentFolderId={currentFolderId}
            />
          </div>
        </FileUploader>
      </main>

      <PostMediaLightbox
        media={lightboxMedia}
        initialIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
      />
      <CreateFolderModal
        open={createFolderParent !== undefined}
        onOpenChange={(open) => { if (!open) setCreateFolderParent(undefined); }}
        onConfirm={(name) => createFolderMutation.mutate(name)}
      />
    </div>
  );
}
