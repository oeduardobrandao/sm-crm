import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Folder, Home } from 'lucide-react';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { getTreeChildren } from '@/services/fileService';
import type { Folder as FolderType } from '../types';

export interface PhoneFolderPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Mover 3 itens". */
  title: string;
  /** "Mover", "Copiar". */
  confirmLabel: string;
  onConfirm: (destinationId: number | null) => void;
  isLoading?: boolean;
  /** Folders being moved: neither they nor anything inside them can be the destination. */
  sourceFolderIds: number[];
  /** Where the items are now: not a destination for a move (null = the root). */
  currentFolderId: number | null;
}

interface Crumb {
  id: number | null;
  name: string;
}

const ROOT: Crumb = { id: null, name: 'Arquivos' };

/**
 * Phone face of FolderPickerModal (same rules, same callbacks): a sheet that drills into
 * folders like iOS Files' "Mover" picker. Tapping a folder opens it; the header button
 * picks the folder being shown. The folders being moved can't be opened, and the place
 * the items already are can't be picked.
 */
export function PhoneFolderPickerSheet({
  open,
  onOpenChange,
  title,
  confirmLabel,
  onConfirm,
  isLoading = false,
  sourceFolderIds,
  currentFolderId,
}: PhoneFolderPickerSheetProps) {
  const [path, setPath] = useState<Crumb[]>([ROOT]);
  useEffect(() => {
    if (open) setPath([ROOT]);
  }, [open]);
  const location = path[path.length - 1];

  const { data: children = [], isLoading: loadingChildren } = useQuery({
    queryKey: ['folder-tree', location.id],
    queryFn: () => getTreeChildren(location.id),
    enabled: open,
  });

  const canPickHere =
    location.id !== currentFolderId && !sourceFolderIds.includes(location.id ?? -1);
  const parent = path.length > 1 ? path[path.length - 2] : null;

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      detents={['large']}
      headerLeading={
        parent ? (
          <button
            type="button"
            className="phone-text-button"
            onClick={() => setPath((p) => p.slice(0, -1))}
          >
            <ChevronLeft aria-hidden="true" />
            {parent.name}
          </button>
        ) : (
          <button type="button" className="phone-text-button" onClick={() => onOpenChange(false)}>
            Cancelar
          </button>
        )
      }
      headerTrailing={
        <button
          type="button"
          className="phone-text-button phone-text-button--strong"
          disabled={!canPickHere || isLoading}
          onClick={() => onConfirm(location.id)}
        >
          {confirmLabel}
        </button>
      }
    >
      <div className="phone-arq-picker">
        <p className="phone-arq-picker__where" aria-live="polite">
          {location.id === null ? <Home aria-hidden="true" /> : <Folder aria-hidden="true" />}
          <span>
            {confirmLabel} para <strong>{location.name}</strong>
          </span>
        </p>
        {!canPickHere && (
          <p className="phone-arq-picker__hint">
            {location.id === currentFolderId
              ? 'Não é possível escolher esta pasta. Escolha outra.'
              : 'Não é possível escolher uma pasta que está sendo movida.'}
          </p>
        )}
        {loadingChildren ? (
          <p className="phone-arq-picker__hint" role="status">
            Carregando pastas…
          </p>
        ) : (children as FolderType[]).length === 0 ? (
          <p className="phone-arq-picker__hint">Nenhuma subpasta.</p>
        ) : (
          <GroupedList header="Pastas">
            {(children as FolderType[]).map((folder) => {
              const isSource = sourceFolderIds.includes(folder.id);
              return (
                <Cell
                  key={folder.id}
                  label={folder.name}
                  subtitle={folder.source === 'system' ? 'Pasta do sistema' : undefined}
                  icon={<Folder aria-hidden="true" />}
                  chevron={!isSource}
                  disabled={isSource}
                  onClick={() => setPath((p) => [...p, { id: folder.id, name: folder.name }])}
                />
              );
            })}
          </GroupedList>
        )}
      </div>
    </BottomSheet>
  );
}
