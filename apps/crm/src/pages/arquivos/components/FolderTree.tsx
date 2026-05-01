import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Folder, FolderOpen, ChevronRight, ChevronDown, Plus } from 'lucide-react';
import { getTreeChildren } from '@/services/fileService';
import type { TreeNode } from '@/services/fileService';

interface FolderNodeProps {
  folder: TreeNode;
  selectedFolderId: number | null;
  onSelectFolder: (id: number | null) => void;
  onRequestCreateFolder: (parentId: number | null) => void;
  depth: number;
  onDrop?: (targetFolderId: number, payload: { fileIds: number[]; folderIds: number[] }) => void;
}

function FolderNode({ folder, selectedFolderId, onSelectFolder, onRequestCreateFolder, depth, onDrop }: FolderNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const expandTimerRef = useRef<number | undefined>(undefined);

  const { data: subfolders = [] } = useQuery({
    queryKey: ['folder-tree', folder.id],
    queryFn: () => getTreeChildren(folder.id),
    enabled: expanded,
  });

  const isSelected = selectedFolderId === folder.id;

  return (
    <div>
      <div
        className={`flex items-center gap-1 rounded-sm px-2 py-1.5 cursor-pointer group transition-colors duration-150 ${
          isSelected
            ? 'bg-[var(--primary-color)] text-[#12151a]'
            : isDragOver
              ? 'bg-[rgba(234,179,8,0.15)] border-l-2 border-l-[var(--primary-color)] text-[var(--text-main)]'
              : 'hover:bg-[var(--surface-hover)] text-[var(--text-main)]'
        }`}
        style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-arquivos')) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            setIsDragOver(true);
          }
        }}
        onDragEnter={(e) => {
          if (e.dataTransfer.types.includes('application/x-arquivos')) {
            if (folder.has_children && !expanded) {
              expandTimerRef.current = window.setTimeout(() => {
                setExpanded(true);
              }, 500);
            }
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragOver(false);
            if (expandTimerRef.current) {
              clearTimeout(expandTimerRef.current);
              expandTimerRef.current = undefined;
            }
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragOver(false);
          if (expandTimerRef.current) {
            clearTimeout(expandTimerRef.current);
            expandTimerRef.current = undefined;
          }
          const raw = e.dataTransfer.getData('application/x-arquivos');
          if (raw) {
            try {
              const payload = JSON.parse(raw);
              onDrop?.(folder.id, payload);
            } catch {}
          }
        }}
      >
        {folder.has_children ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            className="flex-shrink-0 w-4 flex items-center justify-center opacity-60 hover:opacity-100"
            aria-label={expanded ? 'Recolher' : 'Expandir'}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="flex-shrink-0 w-4" />
        )}

        <button
          onClick={() => onSelectFolder(folder.id)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          {isSelected || expanded ? (
            <FolderOpen className="h-4 w-4 flex-shrink-0" />
          ) : (
            <Folder className="h-4 w-4 flex-shrink-0" />
          )}
          <span className="truncate text-sm font-medium">{folder.name}</span>
          {folder.source === 'system' && (
            <span
              className={`flex-shrink-0 text-[0.6rem] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${
                isSelected
                  ? 'bg-[rgba(0,0,0,0.15)] text-[#12151a]'
                  : 'bg-[var(--surface-hover)] text-[var(--text-muted)]'
              }`}
            >
              AUTO
            </span>
          )}
        </button>

        {folder.source !== 'system' && (
          <button
            onClick={(e) => { e.stopPropagation(); onRequestCreateFolder(folder.id); }}
            className="flex-shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 p-0.5 rounded transition-opacity"
            aria-label="Nova subpasta"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {expanded && subfolders.length > 0 && (
        <div>
          {subfolders.map((sub) => (
            <FolderNode
              key={sub.id}
              folder={sub}
              selectedFolderId={selectedFolderId}
              onSelectFolder={onSelectFolder}
              onRequestCreateFolder={onRequestCreateFolder}
              depth={depth + 1}
              onDrop={onDrop}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FolderTreeProps {
  selectedFolderId: number | null;
  onSelectFolder: (id: number | null) => void;
  onRequestCreateFolder: (parentId: number | null) => void;
  onDrop?: (targetFolderId: number, payload: { fileIds: number[]; folderIds: number[] }) => void;
}

export function FolderTree({ selectedFolderId, onSelectFolder, onRequestCreateFolder, onDrop }: FolderTreeProps) {
  const { data: rootFolders = [], isLoading } = useQuery({
    queryKey: ['folder-tree', null],
    queryFn: () => getTreeChildren(null),
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto py-2 space-y-0.5">
        {isLoading && (
          <div className="px-3 py-4 text-sm text-[var(--text-muted)] text-center">
            Carregando...
          </div>
        )}

        {rootFolders.map((folder) => (
          <FolderNode
            key={folder.id}
            folder={folder}
            selectedFolderId={selectedFolderId}
            onSelectFolder={onSelectFolder}
            onRequestCreateFolder={onRequestCreateFolder}
            depth={0}
            onDrop={onDrop}
          />
        ))}

        {!isLoading && rootFolders.length === 0 && (
          <div className="px-3 py-4 text-sm text-[var(--text-muted)] text-center">
            Nenhuma pasta
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border-color)] p-2">
        <button
          onClick={() => onRequestCreateFolder(null)}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-sm text-sm text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--surface-hover)] transition-colors duration-150"
        >
          <Plus className="h-4 w-4" />
          Nova pasta
        </button>
      </div>
    </div>
  );
}
