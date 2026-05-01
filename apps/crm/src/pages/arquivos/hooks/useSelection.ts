import { useState, useCallback, useMemo } from 'react';

interface HasId {
  id: number;
}

export function useSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [anchor, setAnchor] = useState<number | null>(null);

  const isSelected = useCallback((id: number) => selectedIds.has(id), [selectedIds]);

  const toggle = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setAnchor(id);
  }, []);

  const toggleRange = useCallback(
    (targetId: number, items: HasId[]) => {
      if (anchor === null) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.add(targetId);
          return next;
        });
        setAnchor(targetId);
        return;
      }

      const anchorIdx = items.findIndex((item) => item.id === anchor);
      const targetIdx = items.findIndex((item) => item.id === targetId);

      if (anchorIdx === -1 || targetIdx === -1) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.add(targetId);
          return next;
        });
        setAnchor(targetId);
        return;
      }

      const start = Math.min(anchorIdx, targetIdx);
      const end = Math.max(anchorIdx, targetIdx);

      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          next.add(items[i].id);
        }
        return next;
      });
    },
    [anchor],
  );

  const prune = useCallback((displayedIds: Set<number>) => {
    setSelectedIds((prev) => {
      const next = new Set<number>();
      for (const id of prev) {
        if (displayedIds.has(id)) next.add(id);
      }
      if (next.size === prev.size) return prev;
      return next;
    });
    setAnchor((prev) => (prev !== null && !displayedIds.has(prev) ? null : prev));
  }, []);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
    setAnchor(null);
  }, []);

  const count = useMemo(() => selectedIds.size, [selectedIds]);

  return { selectedIds, anchor, isSelected, toggle, toggleRange, prune, clear, count };
}
