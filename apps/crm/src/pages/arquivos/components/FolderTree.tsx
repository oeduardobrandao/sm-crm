import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Folder, FolderOpen, ChevronRight, ChevronDown, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { getFolderContents, createFolder } from '@/services/fileService';
import type { Folder as FolderType } from '../types';

interface FolderNodeProps {
  folder: FolderType;
  selectedFolderId: number | null;
  onSelectFolder: (id: number | null) => void;
  depth: number;
}

function FolderNode({ folder, selectedFolderId, onSelectFolder, depth }: FolderNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['folders', folder.id],
    queryFn: () => getFolderContents(folder.id),
    enabled: expanded,
  });

  const subfolders = data?.subfolders ?? [];
  const isSelected = selectedFolderId === folder.id;

  async function handleCreateSubfolder() {
    const name = window.prompt('Nome da nova pasta:');
    if (!name?.trim()) return;
    try {
      await createFolder(name.trim(), folder.id);
      await queryClient.invalidateQueries({ queryKey: ['folders', folder.id] });
      await queryClient.invalidateQueries({ queryKey: ['folder-contents'] });
      setExpanded(true);
      toast.success('Pasta criada');
    } catch {
      toast.error('Erro ao criar pasta');
    }
  }

  return (
    <div>
      <div
        className={`flex items-center gap-1 rounded-lg px-2 py-1.5 cursor-pointer group transition-colors duration-150 ${
          isSelected
            ? 'bg-[var(--primary-color)] text-[#12151a]'
            : 'hover:bg-[var(--surface-hover)] text-[var(--text-main)]'
        }`}
        style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          className="flex-shrink-0 p-0.5 rounded opacity-60 hover:opacity-100"
          aria-label={expanded ? 'Recolher' : 'Expandir'}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>

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
            onClick={(e) => { e.stopPropagation(); handleCreateSubfolder(); }}
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
              depth={depth + 1}
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
}

export function FolderTree({ selectedFolderId, onSelectFolder }: FolderTreeProps) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['folders', null],
    queryFn: () => getFolderContents(null),
  });

  const rootFolders = data?.subfolders ?? [];

  async function handleCreateRootFolder() {
    const name = window.prompt('Nome da nova pasta:');
    if (!name?.trim()) return;
    try {
      await createFolder(name.trim(), null);
      await queryClient.invalidateQueries({ queryKey: ['folders', null] });
      await queryClient.invalidateQueries({ queryKey: ['folder-contents'] });
      toast.success('Pasta criada');
    } catch {
      toast.error('Erro ao criar pasta');
    }
  }

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
            depth={0}
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
          onClick={handleCreateRootFolder}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--surface-hover)] transition-colors duration-150"
        >
          <Plus className="h-4 w-4" />
          Nova pasta
        </button>
      </div>
    </div>
  );
}
