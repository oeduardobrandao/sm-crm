import type { Folder } from '../types';

export function getDescendantIds(folderId: number, allFolders: Folder[]): Set<number> {
  const descendants = new Set<number>();
  const queue = [folderId];
  while (queue.length > 0) {
    const parentId = queue.pop()!;
    for (const folder of allFolders) {
      if (folder.parent_id === parentId && !descendants.has(folder.id)) {
        descendants.add(folder.id);
        queue.push(folder.id);
      }
    }
  }
  return descendants;
}

interface ValidDropParams {
  sourceFileIds: number[];
  sourceFolderIds: number[];
  target: Folder;
  currentFolderId: number | null;
  allFolders: Folder[];
}

export function isValidDropTarget(params: ValidDropParams): boolean {
  const { sourceFileIds, sourceFolderIds, target, currentFolderId, allFolders } = params;

  // No-op: can't drop into the same folder it's already in
  if (target.id === currentFolderId) return false;

  // Can't drop a folder into itself
  if (sourceFolderIds.includes(target.id)) return false;

  const sourceFolders = allFolders.filter((f) => sourceFolderIds.includes(f.id));

  // System folders cannot be moved
  for (const sf of sourceFolders) {
    if (sf.source === 'system') return false;
  }

  // User folders cannot be dropped into post system folders
  if (sourceFolderIds.length > 0 && target.source === 'system' && target.source_type === 'post') {
    return false;
  }

  // No cycles: can't move a folder into its own descendant
  for (const folderId of sourceFolderIds) {
    const descendants = getDescendantIds(folderId, allFolders);
    if (descendants.has(target.id)) return false;
  }

  return true;
}
