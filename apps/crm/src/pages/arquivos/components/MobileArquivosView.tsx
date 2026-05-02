import { useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  ChevronLeft,
  Search,
  Plus,
  LayoutGrid,
  List,
  Folder,
  FileText,
  FileVideo,
  FileImage,
  ArrowUpRight,
  MoreVertical,
  X,
} from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { formatBytes } from './FileGrid';
import { FileContextMenu } from './FileContextMenu';
import type { FileRecord, Folder as FolderType } from '../types';

type FileFilter = 'todos' | 'imagens' | 'videos' | 'docs';

interface MobileArquivosViewProps {
  breadcrumbs: { id: number; name: string }[];
  subfolders: FolderType[];
  files: FileRecord[];
  storage?: { used_bytes: number; quota_bytes: number };
  isLoading: boolean;
  currentFolderId: number | null;
  onNavigate: (id: number | null) => void;
  onFileAction: (action: string, file: FileRecord) => void;
  onUploadClick: () => void;
  onCreateFolder: () => void;
  onActionComplete: () => void;
  selectedIds: Set<number>;
  selectionCount: number;
  onToggleSelect: (id: number) => void;
  onClearSelection: () => void;
  onBulkMove: () => void;
  onBulkCopy: () => void;
  onBulkZip: () => void;
  onBulkDelete: () => void;
  isBusy: boolean;
}

function FileIcon({ kind, className }: { kind: FileRecord['kind']; className?: string }) {
  if (kind === 'image') return <FileImage className={className} />;
  if (kind === 'video') return <FileVideo className={className} />;
  return <FileText className={className} />;
}

function mimeExt(mime: string): string {
  const ext = mime.split('/').pop()?.toUpperCase() ?? '';
  if (ext === 'JPEG') return 'JPG';
  if (ext === 'QUICKTIME') return 'MOV';
  if (ext === 'PLAIN') return 'TXT';
  if (ext === 'VND.OPENXMLFORMATS-OFFICEDOCUMENT.SPREADSHEETML.SHEET') return 'XLSX';
  if (ext === 'VND.OPENXMLFORMATS-OFFICEDOCUMENT.WORDPROCESSINGML.DOCUMENT') return 'DOCX';
  return ext.slice(0, 4);
}

function filterFiles(files: FileRecord[], filter: FileFilter): FileRecord[] {
  if (filter === 'todos') return files;
  if (filter === 'imagens') return files.filter((f) => f.kind === 'image');
  if (filter === 'videos') return files.filter((f) => f.kind === 'video');
  return files.filter((f) => f.kind === 'document');
}

function FolderCards({
  folders,
  onOpen,
  selectedIds,
  isInSelectionMode,
  onToggleSelect,
  longPressTimer,
}: {
  folders: FolderType[];
  onOpen: (id: number) => void;
  selectedIds: Set<number>;
  isInSelectionMode: boolean;
  onToggleSelect: (id: number) => void;
  longPressTimer: { current: ReturnType<typeof setTimeout> | null };
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 px-3">
      {folders.map((f) => {
        const isSelected = selectedIds.has(f.id);
        return (
          <button
            key={f.id}
            onClick={() => {
              if (isInSelectionMode) {
                onToggleSelect(f.id);
              } else {
                onOpen(f.id);
              }
            }}
            onTouchStart={() => {
              longPressTimer.current = setTimeout(() => {
                onToggleSelect(f.id);
              }, 400);
            }}
            onTouchMove={() => {
              if (longPressTimer.current) {
                clearTimeout(longPressTimer.current);
                longPressTimer.current = null;
              }
            }}
            onTouchEnd={() => {
              if (longPressTimer.current) {
                clearTimeout(longPressTimer.current);
                longPressTimer.current = null;
              }
            }}
            className={`relative flex flex-col gap-2.5 p-3 rounded-lg bg-[var(--card-bg)] border text-left active:scale-[0.97] transition-transform ${
              isSelected ? 'border-[var(--primary-color)]' : 'border-[var(--border-color)]'
            }`}
            style={{ boxShadow: '0 1px 0 rgba(0,0,0,.02), 0 1px 2px rgba(28,25,23,.04)' }}
          >
            {isInSelectionMode && (
              <div
                className={`absolute top-1.5 left-1.5 w-5 h-5 rounded border-[1.5px] flex items-center justify-center text-[0.6rem] font-bold z-10 ${
                  isSelected
                    ? 'bg-[var(--primary-color)] border-[var(--primary-color)] text-[#12151a]'
                    : 'border-white/60 bg-black/40'
                }`}
              >
                {isSelected && '✓'}
              </div>
            )}
            <div className="flex items-center justify-between">
              <div
                className="w-9 h-9 rounded-sm flex items-center justify-center"
                style={{ background: 'color-mix(in srgb, var(--primary-color) 15%, transparent)' }}
              >
                <Folder className="h-[18px] w-[18px] text-[var(--primary-color)]" />
              </div>
              <ArrowUpRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-[var(--text-main)] leading-tight line-clamp-1">{f.name}</p>
              <p className="font-mono text-[10px] text-[var(--text-muted)] mt-0.5 font-semibold tracking-wide uppercase">
                {f.file_count ?? 0} arquivos
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function FolderList({
  folders,
  onOpen,
  selectedIds,
  isInSelectionMode,
  onToggleSelect,
  longPressTimer,
}: {
  folders: FolderType[];
  onOpen: (id: number) => void;
  selectedIds: Set<number>;
  isInSelectionMode: boolean;
  onToggleSelect: (id: number) => void;
  longPressTimer: { current: ReturnType<typeof setTimeout> | null };
}) {
  return (
    <div
      className="mx-3 rounded-lg bg-[var(--card-bg)] border border-[var(--border-color)] overflow-hidden"
      style={{ boxShadow: '0 1px 0 rgba(0,0,0,.02), 0 1px 2px rgba(28,25,23,.04)' }}
    >
      {folders.map((f, i) => {
        const isSelected = selectedIds.has(f.id);
        return (
          <button
            key={f.id}
            onClick={() => {
              if (isInSelectionMode) {
                onToggleSelect(f.id);
              } else {
                onOpen(f.id);
              }
            }}
            onTouchStart={() => {
              longPressTimer.current = setTimeout(() => {
                onToggleSelect(f.id);
              }, 400);
            }}
            onTouchMove={() => {
              if (longPressTimer.current) {
                clearTimeout(longPressTimer.current);
                longPressTimer.current = null;
              }
            }}
            onTouchEnd={() => {
              if (longPressTimer.current) {
                clearTimeout(longPressTimer.current);
                longPressTimer.current = null;
              }
            }}
            className={`flex items-center gap-3 px-3.5 py-3 w-full text-left active:bg-[var(--surface-hover)] ${
              isSelected ? 'bg-[color-mix(in_srgb,var(--primary-color)_8%,transparent)]' : ''
            }`}
            style={i > 0 ? { borderTop: '1px solid var(--border-color)' } : undefined}
          >
            {isInSelectionMode && (
              <div
                className={`w-5 h-5 rounded border-[1.5px] flex items-center justify-center text-[0.6rem] font-bold flex-shrink-0 ${
                  isSelected
                    ? 'bg-[var(--primary-color)] border-[var(--primary-color)] text-[#12151a]'
                    : 'border-[var(--border-color)] bg-[var(--surface-hover)]'
                }`}
              >
                {isSelected && '✓'}
              </div>
            )}
            <div
              className="w-10 h-10 rounded-sm flex items-center justify-center flex-shrink-0"
              style={{ background: 'color-mix(in srgb, var(--primary-color) 15%, transparent)' }}
            >
              <Folder className="h-[18px] w-[18px] text-[var(--primary-color)]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--text-main)] truncate">{f.name}</p>
              <p className="font-mono text-[11px] text-[var(--text-light)] mt-0.5">
                {f.file_count ?? 0} arquivos
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-[var(--text-muted)] flex-shrink-0" />
          </button>
        );
      })}
    </div>
  );
}

function StorageCard({ storage }: { storage: { used_bytes: number; quota_bytes: number } }) {
  const totalFiles = '--';
  const pct = storage.quota_bytes > 0 ? Math.round((storage.used_bytes / storage.quota_bytes) * 100) : 0;

  return (
    <div className="mx-3 mt-4">
      <p className="font-mono text-[11px] tracking-[.12em] uppercase text-[var(--text-muted)] font-semibold mb-2 px-1">
        Armazenamento
      </p>
      <div
        className="p-3.5 rounded-lg bg-[var(--card-bg)] border border-[var(--border-color)]"
        style={{ boxShadow: '0 1px 0 rgba(0,0,0,.02), 0 1px 2px rgba(28,25,23,.04)' }}
      >
        <div className="flex justify-between items-baseline mb-2">
          <span className="text-sm font-semibold text-[var(--text-main)]">
            {storage.quota_bytes > 0 ? 'Plano atual' : 'Uso'}
          </span>
          <span className="font-mono text-xs text-[var(--text-light)] font-semibold">
            {formatBytes(storage.used_bytes)}
            {storage.quota_bytes > 0 ? ` / ${formatBytes(storage.quota_bytes)}` : ''}
          </span>
        </div>
        {storage.quota_bytes > 0 && (
          <div className="h-1.5 rounded-full bg-[var(--surface-hover)] overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(pct, 100)}%`,
                backgroundColor: pct >= 100 ? 'var(--danger)' : pct >= 90 ? 'var(--warning)' : 'var(--primary-color)',
              }}
            />
          </div>
        )}
        <p className="text-xs text-[var(--text-muted)] mt-1.5">
          {totalFiles} arquivos no total{storage.quota_bytes > 0 ? ` · ${pct}% usado` : ''}
        </p>
      </div>
    </div>
  );
}

function MobileFileGrid({
  files,
  onFileAction,
  onActionComplete,
  selectedIds,
  isInSelectionMode,
  onToggleSelect,
  longPressTimer,
}: {
  files: FileRecord[];
  onFileAction: (action: string, file: FileRecord) => void;
  onActionComplete: () => void;
  selectedIds: Set<number>;
  isInSelectionMode: boolean;
  onToggleSelect: (id: number) => void;
  longPressTimer: { current: ReturnType<typeof setTimeout> | null };
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 px-3">
      {files.map((f) => {
        const isSelected = selectedIds.has(f.id);
        return (
          <FileContextMenu key={f.id} item={f} type="file" onActionComplete={onActionComplete}>
            <button
              onClick={(e) => {
                if (isInSelectionMode) {
                  e.preventDefault();
                  onToggleSelect(f.id);
                } else {
                  onFileAction('open', f);
                }
              }}
              onTouchStart={() => {
                longPressTimer.current = setTimeout(() => {
                  onToggleSelect(f.id);
                }, 400);
              }}
              onTouchMove={() => {
                if (longPressTimer.current) {
                  clearTimeout(longPressTimer.current);
                  longPressTimer.current = null;
                }
              }}
              onTouchEnd={() => {
                if (longPressTimer.current) {
                  clearTimeout(longPressTimer.current);
                  longPressTimer.current = null;
                }
              }}
              className={`relative flex flex-col rounded-lg bg-[var(--card-bg)] border overflow-hidden text-left active:scale-[0.97] transition-transform ${
                isSelected ? 'border-[var(--primary-color)]' : 'border-[var(--border-color)]'
              }`}
              style={{ boxShadow: '0 1px 0 rgba(0,0,0,.02), 0 1px 2px rgba(28,25,23,.04)' }}
            >
              <div className="relative w-full aspect-square bg-[var(--surface-hover)] flex items-center justify-center overflow-hidden">
                {(f.kind === 'image' || f.kind === 'video') && (f.thumbnail_url ?? f.url) ? (
                  <img src={(f.thumbnail_url ?? f.url)!} alt={f.name} className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <FileIcon kind={f.kind} className="h-8 w-8 text-[var(--text-muted)] opacity-40" />
                )}
                <span className="absolute top-1.5 left-1.5 px-1 py-0.5 bg-[rgba(18,21,26,.7)] text-white rounded-sm font-mono text-[9px] tracking-wider font-semibold">
                  {mimeExt(f.mime_type)}
                </span>
                {isInSelectionMode && (
                  <div
                    className={`absolute top-1.5 right-1.5 w-5 h-5 rounded border-[1.5px] flex items-center justify-center text-[0.6rem] font-bold z-10 ${
                      isSelected
                        ? 'bg-[var(--primary-color)] border-[var(--primary-color)] text-[#12151a]'
                        : 'border-white/60 bg-black/40'
                    }`}
                  >
                    {isSelected && '✓'}
                  </div>
                )}
              </div>
              <div className="px-2.5 py-1.5">
                <p className="text-xs font-medium text-[var(--text-main)] truncate">{f.name}</p>
                <p className="font-mono text-[10px] text-[var(--text-muted)] mt-0.5">{formatBytes(f.size_bytes)}</p>
              </div>
            </button>
          </FileContextMenu>
        );
      })}
    </div>
  );
}

function MobileFileList({
  files,
  onFileAction,
  onActionComplete,
  selectedIds,
  isInSelectionMode,
  onToggleSelect,
  longPressTimer,
}: {
  files: FileRecord[];
  onFileAction: (action: string, file: FileRecord) => void;
  onActionComplete: () => void;
  selectedIds: Set<number>;
  isInSelectionMode: boolean;
  onToggleSelect: (id: number) => void;
  longPressTimer: { current: ReturnType<typeof setTimeout> | null };
}) {
  return (
    <div
      className="mx-3 rounded-lg bg-[var(--card-bg)] border border-[var(--border-color)] overflow-hidden"
      style={{ boxShadow: '0 1px 0 rgba(0,0,0,.02), 0 1px 2px rgba(28,25,23,.04)' }}
    >
      {files.map((f, i) => {
        const isSelected = selectedIds.has(f.id);
        return (
          <FileContextMenu key={f.id} item={f} type="file" onActionComplete={onActionComplete}>
            <div
              onClick={(e) => {
                if (isInSelectionMode) {
                  e.preventDefault();
                  onToggleSelect(f.id);
                } else {
                  onFileAction('open', f);
                }
              }}
              onTouchStart={() => {
                longPressTimer.current = setTimeout(() => {
                  onToggleSelect(f.id);
                }, 400);
              }}
              onTouchMove={() => {
                if (longPressTimer.current) {
                  clearTimeout(longPressTimer.current);
                  longPressTimer.current = null;
                }
              }}
              onTouchEnd={() => {
                if (longPressTimer.current) {
                  clearTimeout(longPressTimer.current);
                  longPressTimer.current = null;
                }
              }}
              className={`flex items-center gap-3 px-3.5 py-3 cursor-pointer active:bg-[var(--surface-hover)] ${
                isSelected ? 'bg-[color-mix(in_srgb,var(--primary-color)_8%,transparent)]' : ''
              }`}
              style={i > 0 ? { borderTop: '1px solid var(--border-color)' } : undefined}
            >
              {isInSelectionMode && (
                <div
                  className={`w-5 h-5 rounded border-[1.5px] flex items-center justify-center text-[0.6rem] font-bold flex-shrink-0 ${
                    isSelected
                      ? 'bg-[var(--primary-color)] border-[var(--primary-color)] text-[#12151a]'
                      : 'border-[var(--border-color)] bg-[var(--surface-hover)]'
                  }`}
                >
                  {isSelected && '✓'}
                </div>
              )}
              <div className="w-10 h-10 rounded-sm bg-[var(--surface-hover)] flex items-center justify-center flex-shrink-0 overflow-hidden">
                {(f.kind === 'image' || f.kind === 'video') && (f.thumbnail_url ?? f.url) ? (
                  <img src={(f.thumbnail_url ?? f.url)!} alt={f.name} className="w-full h-full object-cover" />
                ) : (
                  <FileIcon kind={f.kind} className="h-[18px] w-[18px] text-[var(--text-muted)]" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-main)] truncate">{f.name}</p>
                <p className="font-mono text-[11px] text-[var(--text-light)] mt-0.5 flex gap-2">
                  <span>{mimeExt(f.mime_type)}</span>
                  <span>·</span>
                  <span>{formatBytes(f.size_bytes)}</span>
                </p>
              </div>
              <MoreVertical className="h-[18px] w-[18px] text-[var(--text-muted)] flex-shrink-0" />
            </div>
          </FileContextMenu>
        );
      })}
    </div>
  );
}

const FILTER_OPTIONS: { id: FileFilter; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'imagens', label: 'Imagens' },
  { id: 'videos', label: 'Vídeos' },
  { id: 'docs', label: 'Documentos' },
];

export function MobileArquivosView({
  breadcrumbs,
  subfolders,
  files,
  storage,
  isLoading,
  currentFolderId,
  onNavigate,
  onFileAction,
  onUploadClick,
  onCreateFolder,
  onActionComplete,
  selectedIds,
  selectionCount,
  onToggleSelect,
  onClearSelection,
  onBulkMove,
  onBulkCopy,
  onBulkZip,
  onBulkDelete,
  isBusy,
}: MobileArquivosViewProps) {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filter, setFilter] = useState<FileFilter>('todos');
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isInSelectionMode = selectionCount > 0;
  const isInsideFolder = currentFolderId !== null;
  const parentId = breadcrumbs.length >= 2 ? breadcrumbs[breadcrumbs.length - 2].id : null;
  const currentName = breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1].name : 'Arquivos';

  const filteredFiles = useMemo(() => filterFiles(files, filter), [files, filter]);

  const fileCounts = useMemo(() => ({
    todos: files.length,
    imagens: files.filter((f) => f.kind === 'image').length,
    videos: files.filter((f) => f.kind === 'video').length,
    docs: files.filter((f) => f.kind === 'document').length,
  }), [files]);

  const totalFileCount = files.length + subfolders.reduce((a, f) => a + (f.file_count ?? 0), 0);

  return (
    <div className="flex flex-col h-full bg-[var(--bg-color)]">
      <div className="bg-[var(--card-bg)] flex-shrink-0">
        <div className="flex items-center justify-between px-4 pt-2 pb-1">
          <div className="flex items-center gap-1 min-w-0 text-[13px]">
            {isInsideFolder ? (
              <>
                <button
                  onClick={() => onNavigate(parentId)}
                  className="flex items-center text-[var(--text-light)] active:opacity-60"
                >
                  <ChevronLeft className="h-[18px] w-[18px]" />
                </button>
                <button onClick={() => onNavigate(null)} className="text-[var(--text-light)] font-medium truncate">
                  Arquivos
                </button>
                <ChevronRight className="h-3 w-3 text-[var(--text-muted)] opacity-50 flex-shrink-0" />
                <span className="text-[var(--text-main)] font-semibold truncate">{currentName}</span>
              </>
            ) : (
              <span className="text-[var(--text-light)] font-medium pl-1">Todos os clientes</span>
            )}
          </div>
          <div className="flex gap-1.5">
            <button className="w-[34px] h-[34px] rounded-sm bg-[var(--surface-hover)] flex items-center justify-center text-[var(--text-main)]">
              <Search className="h-4 w-4" />
            </button>
            <button
              onClick={isInsideFolder ? onUploadClick : onCreateFolder}
              className="w-[34px] h-[34px] rounded-sm bg-[var(--primary-color)] flex items-center justify-center text-[#12151a]"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
        </div>

        <div className="px-4 pb-1">
          <h1
            className="text-[28px] font-extrabold text-[var(--text-main)] leading-tight tracking-tight"
            style={{ fontFamily: 'var(--font-heading, "Playfair Display", serif)' }}
          >
            {isInsideFolder ? currentName : 'Arquivos'}
          </h1>
          <div className="flex gap-3 text-xs text-[var(--text-light)] mt-1">
            <span>
              <strong className="text-[var(--text-main)] font-mono">{isInsideFolder ? files.length : totalFileCount}</strong> arquivos
            </span>
            <span className="text-[var(--text-muted)]">·</span>
            <span className="font-mono">
              {storage ? formatBytes(storage.used_bytes) : '—'} usados
            </span>
          </div>
        </div>

        {isInsideFolder && files.length > 0 && (
          <div className="flex gap-1.5 px-3.5 pt-2 pb-1 overflow-x-auto no-scrollbar">
            {FILTER_OPTIONS.map((opt) => {
              const active = filter === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setFilter(opt.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
                    active
                      ? 'bg-[var(--primary-color)] text-[#12151a] border-[var(--primary-color)] font-bold'
                      : 'bg-transparent text-[var(--text-light)] border-[var(--border-color)]'
                  }`}
                >
                  {opt.label}
                  <span className="font-mono text-[10px] opacity-70 font-semibold">{fileCounts[opt.id]}</span>
                </button>
              );
            })}
          </div>
        )}

        {isInsideFolder && (
          <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)]">
            <span className="font-mono text-[10px] tracking-[.12em] uppercase text-[var(--text-muted)] font-semibold">
              Recentes
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-sm ${viewMode === 'grid' ? 'text-[var(--primary-color)] bg-[var(--surface-hover)]' : 'text-[var(--text-muted)]'}`}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-sm ${viewMode === 'list' ? 'text-[var(--primary-color)] bg-[var(--surface-hover)]' : 'text-[var(--text-muted)]'}`}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {isInSelectionMode && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--primary-color)] bg-[var(--surface-main)]">
            <span className="text-sm font-bold text-[var(--primary-color)]">
              {selectionCount} selecionado{selectionCount !== 1 ? 's' : ''}
            </span>
            <button onClick={onClearSelection} className="ml-auto text-[var(--text-muted)]">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pt-2.5 pb-28">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : !isInsideFolder ? (
          <>
            <p className="font-mono text-[11px] tracking-[.12em] uppercase text-[var(--text-muted)] font-semibold mb-2 px-4">
              Por cliente
            </p>
            <FolderCards
              folders={subfolders}
              onOpen={onNavigate}
              selectedIds={selectedIds}
              isInSelectionMode={isInSelectionMode}
              onToggleSelect={onToggleSelect}
              longPressTimer={longPressTimer}
            />
            {storage && <StorageCard storage={storage} />}
          </>
        ) : filteredFiles.length === 0 && subfolders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-[var(--text-muted)]">
            <Folder className="h-10 w-10 mb-2 opacity-30" />
            <p className="text-sm">Nenhum arquivo</p>
          </div>
        ) : (
          <>
            {subfolders.length > 0 && (
              <div className="mb-3">
                <p className="font-mono text-[11px] tracking-[.12em] uppercase text-[var(--text-muted)] font-semibold mb-2 px-4">
                  Pastas
                </p>
                {viewMode === 'grid'
                  ? <FolderCards
                      folders={subfolders}
                      onOpen={onNavigate}
                      selectedIds={selectedIds}
                      isInSelectionMode={isInSelectionMode}
                      onToggleSelect={onToggleSelect}
                      longPressTimer={longPressTimer}
                    />
                  : <FolderList
                      folders={subfolders}
                      onOpen={onNavigate}
                      selectedIds={selectedIds}
                      isInSelectionMode={isInSelectionMode}
                      onToggleSelect={onToggleSelect}
                      longPressTimer={longPressTimer}
                    />
                }
              </div>
            )}
            {filteredFiles.length > 0 && viewMode === 'grid' && (
              <MobileFileGrid
                files={filteredFiles}
                onFileAction={onFileAction}
                onActionComplete={onActionComplete}
                selectedIds={selectedIds}
                isInSelectionMode={isInSelectionMode}
                onToggleSelect={onToggleSelect}
                longPressTimer={longPressTimer}
              />
            )}
            {filteredFiles.length > 0 && viewMode === 'list' && (
              <MobileFileList
                files={filteredFiles}
                onFileAction={onFileAction}
                onActionComplete={onActionComplete}
                selectedIds={selectedIds}
                isInSelectionMode={isInSelectionMode}
                onToggleSelect={onToggleSelect}
                longPressTimer={longPressTimer}
              />
            )}
          </>
        )}
      </div>

      {isInSelectionMode && (
        <div className="fixed bottom-[80px] left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-2 rounded-full bg-[var(--surface-main)] border border-[var(--border-color)] shadow-lg">
          <span className="text-xs font-bold text-[var(--primary-color)]">{selectionCount}</span>
          <button onClick={onBulkMove} disabled={isBusy} className="text-xs px-2.5 py-1 rounded-full bg-[var(--surface-hover)] disabled:opacity-50">Mover</button>
          <button onClick={onBulkZip} disabled={isBusy} className="text-xs px-2.5 py-1 rounded-full bg-[var(--surface-hover)] disabled:opacity-50">ZIP</button>
          <button onClick={onBulkCopy} disabled={isBusy} className="text-xs px-2.5 py-1 rounded-full bg-[var(--surface-hover)] disabled:opacity-50">Copiar</button>
          <button onClick={onBulkDelete} disabled={isBusy} className="text-xs px-2.5 py-1 rounded-full bg-[rgba(245,90,66,0.15)] text-[var(--danger)] disabled:opacity-50">Excluir</button>
          <button onClick={onClearSelection} className="text-[var(--text-muted)]"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
    </div>
  );
}
