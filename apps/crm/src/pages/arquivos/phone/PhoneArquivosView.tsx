import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '@mesaas/i18n';
import {
  ArrowRight,
  ArrowUpDown,
  Check,
  ChevronRight,
  Copy,
  Download,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import { LargeTitleHeader, PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { Chip, ChipRow } from '@/components/mobile/ChipRow';
import { ActionSheet, type ActionSheetAction } from '@/components/mobile/ActionSheet';
import { BottomActionBar } from '@/components/mobile/BottomActionBar';
import type { ContextMenuTriggerProps } from '@/components/mobile/ContextMenu';
import { UsageMeter } from '@/components/usage/UsageMeter';
import { formatStorageBytes } from '@/components/usage/usage-meter-state';
import { FileContextMenu } from '../components/FileContextMenu';
import { formatBytes, sortFiles, sortFolders, type SortBy } from '../components/FileGrid';
import type { FileRecord, Folder as FolderType } from '../types';
import './arquivosPhone.css';

type TypeFilter = 'todos' | 'imagens' | 'videos' | 'docs';

const TYPE_FILTERS: { id: TypeFilter; kind?: FileRecord['kind'] }[] = [
  { id: 'todos' },
  { id: 'imagens', kind: 'image' },
  { id: 'videos', kind: 'video' },
  { id: 'docs', kind: 'document' },
];

const PHONE_SORT_KEYS: SortBy[] = ['name', 'size', 'date'];

/** Sort field label ("Nome", "Tamanho", "Data"), resolved in the current language. */
export function phoneSortLabel(sortBy: SortBy): string {
  return i18n.t(`filesPhone:phoneView.sort.${sortBy}`);
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

function FileKindIcon({ kind }: { kind: FileRecord['kind'] }) {
  if (kind === 'image') return <FileImage aria-hidden="true" />;
  if (kind === 'video') return <FileVideo aria-hidden="true" />;
  return <FileText aria-hidden="true" />;
}

function thumbOf(file: FileRecord): string | null {
  if (file.kind !== 'image' && file.kind !== 'video') return null;
  return file.thumbnail_url ?? file.url ?? null;
}

function fileMeta(file: FileRecord) {
  return `${mimeExt(file.mime_type)} · ${formatBytes(file.size_bytes)}`;
}

function folderMeta(folder: FolderType) {
  return i18n.t('filesPhone:shared.fileCount', { count: folder.file_count ?? 0 });
}

function SelectCheck({ checked }: { checked: boolean }) {
  return (
    <span className="phone-arq-check" data-checked={checked || undefined} aria-hidden="true">
      {checked && <Check />}
    </span>
  );
}

function FilePreview({ file, place }: { file: FileRecord; place: string }) {
  const thumb = thumbOf(file);
  return (
    <div className="phone-arq-preview">
      <div className="phone-arq-preview__media">
        {thumb ? <img src={thumb} alt="" /> : <FileKindIcon kind={file.kind} />}
      </div>
      <div className="phone-arq-preview__text">
        <span className="phone-arq-preview__name">{file.name}</span>
        <span className="phone-arq-preview__meta">
          {fileMeta(file)} · {place}
        </span>
      </div>
    </div>
  );
}

function FolderPreview({ folder }: { folder: FolderType }) {
  return (
    <div className="phone-arq-preview">
      <div className="phone-arq-preview__media phone-arq-preview__media--folder">
        <Folder aria-hidden="true" />
      </div>
      <div className="phone-arq-preview__text">
        <span className="phone-arq-preview__name">{folder.name}</span>
        <span className="phone-arq-preview__meta">{folderMeta(folder)}</span>
      </div>
    </div>
  );
}

/** One list row: the open/toggle button plus the explicit "…" menu trigger. */
function RowBody({
  name,
  meta,
  thumb,
  selecting,
  selected,
  isFolder,
  onActivate,
  triggerProps,
}: {
  name: string;
  meta: string;
  thumb: ReactNode;
  selecting: boolean;
  selected: boolean;
  isFolder: boolean;
  onActivate: () => void;
  triggerProps?: ContextMenuTriggerProps;
}) {
  const { t } = useTranslation('filesPhone');
  return (
    <div className="phone-arq-row__inner">
      <button
        type="button"
        className="phone-arq-row__main"
        aria-pressed={selecting ? selected : undefined}
        aria-label={selecting ? t('phoneView.selectItem', { name }) : undefined}
        onClick={onActivate}
      >
        {selecting && <SelectCheck checked={selected} />}
        {thumb}
        <span className="phone-arq-row__text">
          <span className="phone-arq-row__name">{name}</span>
          <span className="phone-arq-row__meta">{meta}</span>
        </span>
        {isFolder && !selecting && !triggerProps && (
          <ChevronRight className="phone-arq-row__chevron" aria-hidden="true" />
        )}
      </button>
      {triggerProps && !selecting && (
        <button
          {...triggerProps}
          className="phone-arq-row__more"
          aria-label={t('phoneView.itemActions', { name })}
        >
          <MoreHorizontal aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export interface PhoneArquivosViewProps {
  breadcrumbs: { id: number; name: string }[];
  subfolders: FolderType[];
  files: FileRecord[];
  storage?: { used_bytes: number; quota_bytes: number };
  isLoading: boolean;
  currentFolderId: number | null;
  /** Opens a subfolder (a pushed screen with its own history entry). */
  onOpenFolder: (id: number) => void;
  /** Back from inside a folder. */
  onBack: () => void;
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
  /** Per-item Mover para… / Copiar para…, the same handlers the desktop grid gets. */
  onRequestMove: (id: number, type: 'folder' | 'file') => void;
  onRequestCopy: (id: number, type: 'folder' | 'file') => void;
  sortBy: SortBy;
  onSortChange: (sortBy: SortBy) => void;
  /** `can('arquivos', 'editar') === true`: upload, new folder, rename, move, copy, delete. */
  canEdit: boolean;
  /** Workspace owner: the storage meter offers the upgrade. */
  isOwner: boolean;
}

/**
 * /arquivos on phones (FArquivos, FArquivoMenu, FArquivosSelecao mockups). The root is a
 * page with PhonePageHeader; inside a folder the screen is pushed (PhoneNavBar, Back to
 * the parent). "+" offers Enviar arquivo / Nova pasta at every level, "…" sorts and
 * switches list/grid, a long-press (or the row's "…") opens the item menu, and
 * Selecionar turns rows into checkboxes with the bulk bar above the tab bar. Every action
 * is the page's (the same mutations the desktop toolbar and grid use).
 */
export function PhoneArquivosView({
  breadcrumbs,
  subfolders,
  files,
  storage,
  isLoading,
  currentFolderId,
  onOpenFolder,
  onBack,
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
  onRequestMove,
  onRequestCopy,
  sortBy,
  onSortChange,
  canEdit,
  isOwner,
}: PhoneArquivosViewProps) {
  const { t } = useTranslation('filesPhone');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('todos');
  const [selecting, setSelecting] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const sortRef = useRef<HTMLButtonElement>(null);
  const bulkFiredRef = useRef(false);

  const inFolder = currentFolderId !== null;
  const currentName = inFolder
    ? (breadcrumbs[breadcrumbs.length - 1]?.name ?? t('shared.folderFallback'))
    : t('shared.filesTitle');
  const parentName =
    breadcrumbs.length >= 2 ? breadcrumbs[breadcrumbs.length - 2].name : t('shared.filesTitle');

  // Leaving a folder ends selection (the page clears the selected ids there too).
  useEffect(() => {
    setSelecting(false);
    setTypeFilter('todos');
  }, [currentFolderId]);

  // A bulk move, copy or delete that went through clears the selection: leave the mode,
  // as iOS Files does. A cancelled confirm keeps the selection, and the mode with it.
  useEffect(() => {
    if (selecting && bulkFiredRef.current && selectionCount === 0) {
      bulkFiredRef.current = false;
      setSelecting(false);
    }
  }, [selecting, selectionCount]);

  const counts = useMemo(
    () => ({
      todos: files.length,
      imagens: files.filter((f) => f.kind === 'image').length,
      videos: files.filter((f) => f.kind === 'video').length,
      docs: files.filter((f) => f.kind === 'document').length,
    }),
    [files],
  );
  const activeKind = TYPE_FILTERS.find((t) => t.id === typeFilter)?.kind;
  const sortedFolders = useMemo(() => sortFolders(subfolders, sortBy), [subfolders, sortBy]);
  const sortedFiles = useMemo(
    () => sortFiles(activeKind ? files.filter((f) => f.kind === activeKind) : files, sortBy),
    [files, activeKind, sortBy],
  );
  const isEmpty = !isLoading && subfolders.length === 0 && files.length === 0;

  const startSelecting = () => {
    onClearSelection();
    bulkFiredRef.current = false;
    setSelecting(true);
  };
  const stopSelecting = () => {
    onClearSelection();
    setSelecting(false);
  };
  const runBulk = (fn: () => void) => () => {
    bulkFiredRef.current = true;
    fn();
  };

  const countsLine = [
    subfolders.length > 0 ? t('shared.folderCount', { count: subfolders.length }) : null,
    t('shared.fileCount', { count: files.length }),
    storage ? t('shared.used', { size: formatStorageBytes(storage.used_bytes) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const subtitle = selecting ? (
    <strong aria-live="polite">
      {selectionCount > 0
        ? t('shared.selectedCount', { count: selectionCount })
        : t('phoneView.tapToSelect')}
    </strong>
  ) : isLoading ? null : (
    countsLine
  );

  const actions = selecting ? (
    <button type="button" className="phone-arq-pill phone-arq-pill--ink" onClick={stopSelecting}>
      {t('actions.cancel')}
    </button>
  ) : (
    <>
      {!isEmpty && !isLoading && (
        <button type="button" className="phone-arq-pill" onClick={startSelecting}>
          {t('phoneView.select')}
        </button>
      )}
      <PhoneIconButton
        ref={sortRef}
        label={t('phoneView.sortAndView')}
        aria-haspopup="dialog"
        onClick={() => setSortOpen(true)}
      >
        <MoreHorizontal aria-hidden="true" />
      </PhoneIconButton>
      {canEdit && (
        <PhoneIconButton
          ref={addRef}
          label={t('phoneView.add')}
          variant="ink"
          aria-haspopup="dialog"
          onClick={() => setAddOpen(true)}
        >
          <Plus aria-hidden="true" />
        </PhoneIconButton>
      )}
    </>
  );

  const chips =
    files.length > 0 && !isLoading ? (
      <ChipRow
        aria-label={t('phoneView.fileType')}
        semantics="tablist"
        className="phone-arq__chips"
      >
        {TYPE_FILTERS.map((filter) => (
          <Chip
            key={filter.id}
            label={t(`shared.filters.${filter.id}`)}
            count={counts[filter.id]}
            selected={typeFilter === filter.id}
            onClick={() => setTypeFilter(filter.id)}
          />
        ))}
      </ChipRow>
    ) : null;

  const folderRow = (folder: FolderType) => {
    const selected = selectedIds.has(folder.id);
    const activate = () => (selecting ? onToggleSelect(folder.id) : onOpenFolder(folder.id));
    return (
      <li
        key={`folder-${folder.id}`}
        className="phone-arq-row"
        data-selected={selected || undefined}
      >
        <FileContextMenu
          variant="phone"
          item={folder}
          type="folder"
          canEdit={canEdit}
          disabled={selecting}
          onActionComplete={onActionComplete}
          onRequestMove={() => onRequestMove(folder.id, 'folder')}
          onRequestCopy={() => onRequestCopy(folder.id, 'folder')}
          preview={<FolderPreview folder={folder} />}
        >
          {({ triggerProps }) => (
            <RowBody
              name={folder.name}
              meta={folderMeta(folder)}
              thumb={
                <span className="phone-arq-thumb phone-arq-thumb--folder" aria-hidden="true">
                  {selected ? <FolderOpen /> : <Folder />}
                </span>
              }
              selecting={selecting}
              selected={selected}
              isFolder
              onActivate={activate}
              triggerProps={triggerProps}
            />
          )}
        </FileContextMenu>
      </li>
    );
  };

  const fileRow = (file: FileRecord) => {
    const selected = selectedIds.has(file.id);
    const thumb = thumbOf(file);
    const activate = () => (selecting ? onToggleSelect(file.id) : onFileAction('open', file));
    return (
      <li key={`file-${file.id}`} className="phone-arq-row" data-selected={selected || undefined}>
        <FileContextMenu
          variant="phone"
          item={file}
          type="file"
          canEdit={canEdit}
          disabled={selecting}
          onActionComplete={onActionComplete}
          onRequestMove={() => onRequestMove(file.id, 'file')}
          onRequestCopy={() => onRequestCopy(file.id, 'file')}
          preview={<FilePreview file={file} place={currentName} />}
        >
          {({ triggerProps }) => (
            <RowBody
              name={file.name}
              meta={fileMeta(file)}
              thumb={
                <span className="phone-arq-thumb" aria-hidden="true">
                  {thumb ? (
                    <img src={thumb} alt="" loading="lazy" />
                  ) : (
                    <FileKindIcon kind={file.kind} />
                  )}
                </span>
              }
              selecting={selecting}
              selected={selected}
              isFolder={false}
              onActivate={activate}
              triggerProps={triggerProps}
            />
          )}
        </FileContextMenu>
      </li>
    );
  };

  const fileTile = (file: FileRecord) => {
    const selected = selectedIds.has(file.id);
    const thumb = thumbOf(file);
    return (
      <li key={`file-${file.id}`} className="phone-arq-tile" data-selected={selected || undefined}>
        <FileContextMenu
          variant="phone"
          item={file}
          type="file"
          canEdit={canEdit}
          disabled={selecting}
          onActionComplete={onActionComplete}
          onRequestMove={() => onRequestMove(file.id, 'file')}
          onRequestCopy={() => onRequestCopy(file.id, 'file')}
          preview={<FilePreview file={file} place={currentName} />}
        >
          <button
            type="button"
            className="phone-arq-tile__main"
            aria-pressed={selecting ? selected : undefined}
            aria-label={selecting ? t('phoneView.selectItem', { name: file.name }) : file.name}
            onClick={() => (selecting ? onToggleSelect(file.id) : onFileAction('open', file))}
          >
            <span className="phone-arq-tile__thumb">
              {thumb ? (
                <img src={thumb} alt="" loading="lazy" />
              ) : (
                <FileKindIcon kind={file.kind} />
              )}
              {selecting && <SelectCheck checked={selected} />}
            </span>
            <span className="phone-arq-tile__name" aria-hidden="true">
              {file.name}
            </span>
          </button>
        </FileContextMenu>
      </li>
    );
  };

  const addActions: ActionSheetAction[] = [
    {
      label: t('phoneView.uploadFile'),
      icon: <Upload aria-hidden="true" />,
      // The file picker only opens from inside the tap on iOS.
      immediate: true,
      onSelect: onUploadClick,
    },
    {
      label: t('phoneView.newFolder'),
      icon: <FolderPlus aria-hidden="true" />,
      onSelect: onCreateFolder,
    },
  ];
  const check = <Check aria-hidden="true" />;
  const sortActions: ActionSheetAction[] = [
    ...PHONE_SORT_KEYS.map((key) => ({
      label: t('phoneView.sortBy', { field: phoneSortLabel(key).toLowerCase() }),
      icon: sortBy === key ? check : <ArrowUpDown aria-hidden="true" />,
      onSelect: () => onSortChange(key),
    })),
    viewMode === 'list'
      ? {
          label: t('phoneView.viewGrid'),
          icon: <LayoutGrid aria-hidden="true" />,
          onSelect: () => setViewMode('grid'),
        }
      : {
          label: t('phoneView.viewList'),
          icon: <List aria-hidden="true" />,
          onSelect: () => setViewMode('list'),
        },
  ];

  return (
    <div className="phone-arq">
      {inFolder ? (
        <>
          <PhoneNavBar
            backLabel={t('phoneView.backTo', { name: parentName })}
            onBack={onBack}
            trailing={actions}
          />
          <LargeTitleHeader title={currentName} subtitle={subtitle}>
            {chips}
          </LargeTitleHeader>
        </>
      ) : (
        <PhonePageHeader title={t('shared.filesTitle')} subtitle={subtitle} actions={actions}>
          {chips}
        </PhonePageHeader>
      )}

      {isLoading ? (
        <div className="phone-arq-empty" role="status">
          {t('phoneView.loadingFiles')}
        </div>
      ) : isEmpty ? (
        <div className="phone-arq-empty">
          <FolderOpen aria-hidden="true" />
          <strong>{t('phoneView.emptyFolder')}</strong>
          {canEdit && <span>{t('phoneView.emptyFolderHint')}</span>}
        </div>
      ) : (
        <>
          {sortedFolders.length > 0 && (
            <section className="phone-arq-section" aria-labelledby="phone-arq-pastas">
              <div className="phone-arq-section__head">
                <h2 id="phone-arq-pastas" className="phone-arq-section__title">
                  {t('shared.folders')}
                </h2>
              </div>
              <ul className="phone-kit phone-arq-list">{sortedFolders.map(folderRow)}</ul>
            </section>
          )}
          {files.length > 0 && (
            <section className="phone-arq-section" aria-labelledby="phone-arq-arquivos">
              <div className="phone-arq-section__head">
                <h2 id="phone-arq-arquivos" className="phone-arq-section__title">
                  {t('shared.filesTitle')}
                </h2>
                <button
                  type="button"
                  className="phone-arq-sort"
                  aria-label={t('phoneView.sortedBy', {
                    field: phoneSortLabel(sortBy).toLowerCase(),
                  })}
                  onClick={() => setSortOpen(true)}
                >
                  <ArrowUpDown aria-hidden="true" />
                  {phoneSortLabel(sortBy)}
                </button>
              </div>
              {sortedFiles.length === 0 ? (
                <div className="phone-arq-empty">{t('phoneView.noFilesOfType')}</div>
              ) : viewMode === 'list' ? (
                <ul className="phone-kit phone-arq-list">{sortedFiles.map(fileRow)}</ul>
              ) : (
                <ul className="phone-kit phone-arq-grid">{sortedFiles.map(fileTile)}</ul>
              )}
            </section>
          )}
        </>
      )}

      {storage && !selecting && (
        <div className="phone-arq-storage">
          <UsageMeter
            label={t('shared.storage')}
            used={storage.used_bytes}
            limit={storage.quota_bytes > 0 ? storage.quota_bytes : null}
            format={formatStorageBytes}
            unlimitedBadge={false}
            showUpgradeCta={isOwner}
            subText={
              storage.quota_bytes > 0
                ? t('shared.percentUsed', {
                    pct: Math.min(
                      100,
                      Math.round((storage.used_bytes / storage.quota_bytes) * 100),
                    ),
                  })
                : undefined
            }
          />
        </div>
      )}

      {selecting && (
        <BottomActionBar aboveTabBar className="phone-arq-bulk">
          <div
            className="phone-arq-bulk__group"
            role="toolbar"
            aria-label={t('phoneView.bulkActions', { count: selectionCount })}
          >
            {canEdit && (
              <button
                type="button"
                className="phone-arq-bulk__button"
                disabled={selectionCount === 0 || isBusy}
                onClick={runBulk(onBulkMove)}
              >
                <ArrowRight aria-hidden="true" />
                {t('shared.move')}
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                className="phone-arq-bulk__button"
                disabled={selectionCount === 0 || isBusy}
                onClick={runBulk(onBulkCopy)}
              >
                <Copy aria-hidden="true" />
                {t('shared.copy')}
              </button>
            )}
            <button
              type="button"
              className="phone-arq-bulk__button"
              disabled={selectionCount === 0 || isBusy}
              onClick={onBulkZip}
            >
              <Download aria-hidden="true" />
              {t('shared.zip')}
            </button>
            {canEdit && (
              <button
                type="button"
                className="phone-arq-bulk__button phone-arq-bulk__button--destructive"
                disabled={selectionCount === 0 || isBusy}
                onClick={runBulk(onBulkDelete)}
              >
                <Trash2 aria-hidden="true" />
                {t('shared.delete')}
              </button>
            )}
          </div>
        </BottomActionBar>
      )}

      <ActionSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        title={t('phoneView.add')}
        hideTitle
        actions={addActions}
        returnFocusRef={addRef}
      />
      <ActionSheet
        open={sortOpen}
        onOpenChange={setSortOpen}
        title={t('phoneView.sortAndView')}
        actions={sortActions}
        returnFocusRef={sortRef}
      />
    </div>
  );
}
