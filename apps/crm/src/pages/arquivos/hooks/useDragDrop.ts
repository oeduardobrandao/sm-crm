import { useRef, useCallback } from 'react';

const DRAG_TYPE = 'application/x-arquivos';

export interface DragPayload {
  fileIds: number[];
  folderIds: number[];
}

export function isInternalDrag(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(DRAG_TYPE);
}

export function isExternalFileDrag(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes(DRAG_TYPE);
}

export function useDragSource(
  itemId: number,
  itemType: 'file' | 'folder',
  selectedIds: Set<number>,
  classifySelection: () => { fileIds: number[]; folderIds: number[] },
) {
  const ghostRef = useRef<HTMLDivElement | null>(null);

  const onDragStart = useCallback(
    (e: React.DragEvent) => {
      let fileIds: number[];
      let folderIds: number[];

      if (selectedIds.has(itemId) && selectedIds.size > 1) {
        const classified = classifySelection();
        fileIds = classified.fileIds;
        folderIds = classified.folderIds;
      } else {
        fileIds = itemType === 'file' ? [itemId] : [];
        folderIds = itemType === 'folder' ? [itemId] : [];
      }

      const payload: DragPayload = { fileIds, folderIds };
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'move';

      const ghost = document.createElement('div');
      const count = fileIds.length + folderIds.length;
      ghost.textContent = `Mover ${count} ${count === 1 ? 'item' : 'itens'}`;
      ghost.style.cssText =
        'position:fixed;top:-100px;left:-100px;padding:6px 12px;border-radius:8px;background:#1a1e26;color:#eab308;font-size:12px;font-weight:700;border:1px solid rgba(234,179,8,0.4);white-space:nowrap;pointer-events:none;z-index:9999;';
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 0, 0);
      ghostRef.current = ghost;
    },
    [itemId, itemType, selectedIds, classifySelection],
  );

  const onDragEnd = useCallback(() => {
    if (ghostRef.current) {
      document.body.removeChild(ghostRef.current);
      ghostRef.current = null;
    }
  }, []);

  return { onDragStart, onDragEnd, draggable: true };
}

export function parseDragPayload(e: React.DragEvent): DragPayload | null {
  const raw = e.dataTransfer.getData(DRAG_TYPE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}
