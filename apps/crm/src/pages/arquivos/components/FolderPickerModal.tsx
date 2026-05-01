import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Folder, FolderOpen, ChevronRight, ChevronDown, Home } from 'lucide-react';
import { getTreeChildren } from '@/services/fileService';
import type { Folder as FolderType } from '../types';

interface FolderPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  confirmLabel: string;
  onConfirm: (destinationId: number | null) => void;
  isLoading?: boolean;
  sourceFolderIds: number[];
  currentFolderId: number | null;
}

function PickerNode({
  folder,
  depth,
  disabledIds,
  sourceFolderIds,
  selected,
  onSelect,
}: {
  folder: FolderType;
  depth: number;
  disabledIds: Set<number>;
  sourceFolderIds: number[];
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data: children = [] } = useQuery({
    queryKey: ['folder-tree', folder.id],
    queryFn: () => getTreeChildren(folder.id),
    enabled: expanded,
  });

  const childDisabledIds = useMemo(() => {
    if (!sourceFolderIds.includes(folder.id)) return disabledIds;
    const extended = new Set(disabledIds);
    for (const child of children as FolderType[]) {
      extended.add(child.id);
    }
    return extended;
  }, [disabledIds, sourceFolderIds, folder.id, children]);

  const disabled = disabledIds.has(folder.id);
  const isSelected = selected === folder.id;

  return (
    <div>
      <button
        onClick={() => {
          if (!disabled) onSelect(folder.id);
        }}
        disabled={disabled}
        className={`flex items-center gap-1.5 w-full text-left py-1.5 px-2 rounded-md text-sm transition-colors ${
          disabled
            ? 'opacity-40 cursor-not-allowed'
            : isSelected
              ? 'bg-[rgba(234,179,8,0.15)] text-[var(--primary-color)]'
              : 'hover:bg-[var(--surface-hover)]'
        }`}
        style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
      >
        {folder.has_children ? (
          <span
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="cursor-pointer"
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
        ) : (
          <span className="w-3.5" />
        )}
        {isSelected || expanded ? (
          <FolderOpen className="h-4 w-4 text-[var(--primary-color)] flex-shrink-0" />
        ) : (
          <Folder className="h-4 w-4 text-[var(--text-muted)] flex-shrink-0" />
        )}
        <span className="truncate text-xs">{folder.name}</span>
        {folder.source === 'system' && (
          <span className="text-[0.55rem] uppercase tracking-wide font-semibold px-1 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-muted)] ml-auto flex-shrink-0">
            AUTO
          </span>
        )}
      </button>
      {expanded && children.length > 0 && (
        <div>
          {(children as FolderType[]).map((child) => (
            <PickerNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              disabledIds={childDisabledIds}
              sourceFolderIds={sourceFolderIds}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FolderPickerModal({
  open,
  onOpenChange,
  title,
  confirmLabel,
  onConfirm,
  isLoading,
  sourceFolderIds,
  currentFolderId,
}: FolderPickerModalProps) {
  const [selected, setSelected] = useState<number | null>(null);

  const { data: rootFolders = [] } = useQuery({
    queryKey: ['folder-tree', null],
    queryFn: () => getTreeChildren(null),
    enabled: open,
  });

  useEffect(() => {
    if (open) setSelected(null);
  }, [open]);

  const disabledIds = useMemo(() => {
    const disabled = new Set<number>();
    if (currentFolderId !== null) disabled.add(currentFolderId);
    for (const id of sourceFolderIds) {
      disabled.add(id);
    }
    return disabled;
  }, [sourceFolderIds, currentFolderId]);

  const isRootSelected = selected === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[50vh] overflow-y-auto py-2 -mx-2 px-2">
          <button
            onClick={() => setSelected(null)}
            disabled={currentFolderId === null}
            className={`flex items-center gap-2 w-full text-left py-1.5 px-2 rounded-md text-sm transition-colors ${
              currentFolderId === null
                ? 'opacity-40 cursor-not-allowed'
                : isRootSelected
                  ? 'bg-[rgba(234,179,8,0.15)] text-[var(--primary-color)]'
                  : 'hover:bg-[var(--surface-hover)]'
            }`}
          >
            <Home className="h-4 w-4" />
            <span className="text-xs font-medium">Raiz (Todos os Arquivos)</span>
          </button>

          {(rootFolders as FolderType[]).map((folder) => (
            <PickerNode
              key={folder.id}
              folder={folder}
              depth={0}
              disabledIds={disabledIds}
              sourceFolderIds={sourceFolderIds}
              selected={selected}
              onSelect={setSelected}
            />
          ))}
        </div>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-xs rounded-md border border-[var(--border-color)] hover:bg-[var(--surface-hover)] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(selected)}
            disabled={isLoading}
            className="px-4 py-2 text-xs rounded-md bg-[var(--primary-color)] text-[#12151a] font-bold hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Movendo…' : confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
