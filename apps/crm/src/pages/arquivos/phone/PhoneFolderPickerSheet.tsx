import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
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

/** The root's name is resolved at render (crumbNameOf), so a language switch reaches it. */
const ROOT: Crumb = { id: null, name: '' };

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
  const { t } = useTranslation('filesPhone');
  const crumbNameOf = (crumb: Crumb) => (crumb.id === null ? t('shared.filesTitle') : crumb.name);
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
            {crumbNameOf(parent)}
          </button>
        ) : (
          <button type="button" className="phone-text-button" onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
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
            <Trans
              t={t}
              i18nKey="folderPicker.destination"
              values={{ action: confirmLabel, place: crumbNameOf(location) }}
              components={{ b: <strong /> }}
            />
          </span>
        </p>
        {!canPickHere && (
          <p className="phone-arq-picker__hint">
            {location.id === currentFolderId
              ? t('folderPicker.cannotPickCurrent')
              : t('folderPicker.cannotPickSource')}
          </p>
        )}
        {loadingChildren ? (
          <p className="phone-arq-picker__hint" role="status">
            {t('folderPicker.loadingFolders')}
          </p>
        ) : (children as FolderType[]).length === 0 ? (
          <p className="phone-arq-picker__hint">{t('folderPicker.noSubfolders')}</p>
        ) : (
          <GroupedList header={t('shared.folders')}>
            {(children as FolderType[]).map((folder) => {
              const isSource = sourceFolderIds.includes(folder.id);
              return (
                <Cell
                  key={folder.id}
                  label={folder.name}
                  subtitle={folder.source === 'system' ? t('folderPicker.systemFolder') : undefined}
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
