# Arquivos Power Workbench (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six file-management features to the Arquivos page — multi-select & bulk actions, inline rename, type filter, move via picker & drag-and-drop, copy/duplicate, and ZIP download — transforming it from a single-file viewer into a multi-file workbench.

**Architecture:** Frontend hooks (`useSelection`, `useDragDrop`) manage selection and drag state. New components (`BulkActionBar`, `FolderPickerModal`, `FilterPopover`, `InlineRenameInput`) compose into the existing `ArquivosPage`. Backend gets bulk-move/bulk-delete/copy endpoints in the existing `file-manage` handler plus a new `file-zip` edge function for streaming ZIP downloads. A Postgres RPC handles atomic bulk moves; R2 server-side COPY handles file duplication.

**Tech Stack:** React 19, TanStack Query, TypeScript, Tailwind CSS, shadcn/ui, lucide-react, Deno edge functions, Postgres RPC, Cloudflare R2 (`CopyObjectCommand`), `@zip-js/zip-js`

**Spec:** `docs/superpowers/specs/2026-04-30-arquivos-power-workbench-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `apps/crm/src/pages/arquivos/hooks/useSelection.ts` | Generic multi-select state: selectedIds Set, anchor tracking, toggle, toggleRange, prune, clear |
| `apps/crm/src/pages/arquivos/hooks/useDragDrop.ts` | HTML5 native drag-and-drop wiring; drag ghost creation; internal vs external drag disambiguation |
| `apps/crm/src/pages/arquivos/components/BulkActionBar.tsx` | Floating action pill (desktop) / docked bottom bar (mobile) with bulk action buttons |
| `apps/crm/src/pages/arquivos/components/FolderPickerModal.tsx` | Tree-based folder destination picker; shared by Move and Copy; disables invalid targets per validity matrix |
| `apps/crm/src/pages/arquivos/components/FilterPopover.tsx` | Type-filter popover (desktop) / bottom-sheet (mobile) with checkboxes and active-count badge |
| `apps/crm/src/pages/arquivos/components/InlineRenameInput.tsx` | Auto-focused input replacing name label; commits on blur/Enter, reverts on Escape |
| `apps/crm/src/pages/arquivos/utils/validityMatrix.ts` | `isValidDropTarget()` and `getDescendantIds()` helpers encoding the folder move/copy validity rules |
| `supabase/migrations/20260501000001_bulk_move_items_rpc.sql` | Postgres RPC `bulk_move_items` for atomic bulk folder/file moves |
| `supabase/functions/file-zip/index.ts` | New edge function: HMAC token verification + streaming ZIP assembly from R2 |
| `apps/crm/src/pages/arquivos/__tests__/useSelection.test.ts` | Unit tests for the selection hook |
| `apps/crm/src/pages/arquivos/__tests__/validityMatrix.test.ts` | Table-driven tests for `isValidDropTarget` |
| `supabase/functions/__tests__/file-manage-bulk_test.ts` | Deno tests for bulk-move, bulk-delete, copy endpoints |
| `supabase/functions/__tests__/file-zip_test.ts` | Deno tests for ZIP token + streaming |

### Modified files

| File | Change |
|------|--------|
| `apps/crm/src/services/fileService.ts` | Add `bulkMove`, `bulkDelete`, `copyFile`, `copyFolder`, `requestZipToken` functions |
| `apps/crm/src/pages/arquivos/ArquivosPage.tsx` | Wire selection state, filter state, bulk bar, picker modal, drag context |
| `apps/crm/src/pages/arquivos/components/FileGrid.tsx` | Add hover checkbox, selection ring, drag source, double-click rename target |
| `apps/crm/src/pages/arquivos/components/FolderTree.tsx` | Add drop targets on tree nodes; expand-on-hover-during-drag |
| `apps/crm/src/pages/arquivos/components/FileContextMenu.tsx` | Add "Mover para…", "Copiar para…" items; route rename to inline on desktop; add `isMobile` prop |
| `apps/crm/src/pages/arquivos/components/MobileArquivosView.tsx` | Long-press selection mode; mobile pill bar; bottom-sheet filter |
| `supabase/functions/file-manage/handler.ts` | Add bulk-move, bulk-delete, copy, zip-token routes; extract shared validation helpers |
| `supabase/functions/_shared/r2.ts` | Add `copyObject()` and `getObject()` helpers |

---

## Task 1: `useSelection` hook + tests

**Files:**
- Create: `apps/crm/src/pages/arquivos/hooks/useSelection.ts`
- Test: `apps/crm/src/pages/arquivos/__tests__/useSelection.test.ts`

- [ ] **Step 1: Write the test file**

Create `apps/crm/src/pages/arquivos/__tests__/useSelection.test.ts`:

```typescript
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSelection } from '../hooks/useSelection';

describe('useSelection', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useSelection());
    expect(result.current.count).toBe(0);
    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.anchor).toBeNull();
  });

  it('toggle adds and removes an id', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggle(1));
    expect(result.current.isSelected(1)).toBe(true);
    expect(result.current.anchor).toBe(1);
    expect(result.current.count).toBe(1);

    act(() => result.current.toggle(1));
    expect(result.current.isSelected(1)).toBe(false);
    expect(result.current.count).toBe(0);
  });

  it('toggle sets anchor to last toggled id', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggle(5));
    act(() => result.current.toggle(10));
    expect(result.current.anchor).toBe(10);
  });

  it('toggleRange selects from anchor to target in display order', () => {
    const { result } = renderHook(() => useSelection());
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];

    act(() => result.current.toggle(2));
    act(() => result.current.toggleRange(4, items));

    expect(result.current.isSelected(2)).toBe(true);
    expect(result.current.isSelected(3)).toBe(true);
    expect(result.current.isSelected(4)).toBe(true);
    expect(result.current.isSelected(1)).toBe(false);
    expect(result.current.isSelected(5)).toBe(false);
  });

  it('toggleRange works backward (target before anchor)', () => {
    const { result } = renderHook(() => useSelection());
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];

    act(() => result.current.toggle(4));
    act(() => result.current.toggleRange(2, items));

    expect(result.current.isSelected(2)).toBe(true);
    expect(result.current.isSelected(3)).toBe(true);
    expect(result.current.isSelected(4)).toBe(true);
  });

  it('toggleRange with no anchor behaves like toggle', () => {
    const { result } = renderHook(() => useSelection());
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];

    act(() => result.current.toggleRange(2, items));
    expect(result.current.isSelected(2)).toBe(true);
    expect(result.current.count).toBe(1);
  });

  it('prune removes stale ids and preserves valid ones', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggle(1));
    act(() => result.current.toggle(2));
    act(() => result.current.toggle(3));

    act(() => result.current.prune(new Set([1, 3, 5])));

    expect(result.current.isSelected(1)).toBe(true);
    expect(result.current.isSelected(2)).toBe(false);
    expect(result.current.isSelected(3)).toBe(true);
    expect(result.current.count).toBe(2);
  });

  it('prune resets anchor if anchor was pruned', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggle(5));
    expect(result.current.anchor).toBe(5);

    act(() => result.current.prune(new Set([1, 2, 3])));
    expect(result.current.anchor).toBeNull();
  });

  it('clear resets everything', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggle(1));
    act(() => result.current.toggle(2));
    act(() => result.current.clear());

    expect(result.current.count).toBe(0);
    expect(result.current.anchor).toBeNull();
    expect(result.current.selectedIds.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- --run apps/crm/src/pages/arquivos/__tests__/useSelection.test.ts`

Expected: FAIL — module `../hooks/useSelection` not found.

- [ ] **Step 3: Implement the hook**

Create `apps/crm/src/pages/arquivos/hooks/useSelection.ts`:

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- --run apps/crm/src/pages/arquivos/__tests__/useSelection.test.ts`

Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/arquivos/hooks/useSelection.ts apps/crm/src/pages/arquivos/__tests__/useSelection.test.ts
git commit -m "feat(arquivos): add useSelection hook with tests"
```

---

## Task 2: Validity matrix utility + tests

**Files:**
- Create: `apps/crm/src/pages/arquivos/utils/validityMatrix.ts`
- Test: `apps/crm/src/pages/arquivos/__tests__/validityMatrix.test.ts`

- [ ] **Step 1: Write the test file**

Create `apps/crm/src/pages/arquivos/__tests__/validityMatrix.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  isValidDropTarget,
  getDescendantIds,
} from '../utils/validityMatrix';
import type { Folder } from '../types';

function makeFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: 1,
    conta_id: 'conta-1',
    parent_id: null,
    name: 'Test',
    source: 'user',
    source_type: null,
    source_id: null,
    name_overridden: false,
    position: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('getDescendantIds', () => {
  it('returns empty set for leaf folder', () => {
    const tree = [makeFolder({ id: 1 })];
    expect(getDescendantIds(1, tree).size).toBe(0);
  });

  it('returns all descendants recursively', () => {
    const tree = [
      makeFolder({ id: 1, parent_id: null }),
      makeFolder({ id: 2, parent_id: 1 }),
      makeFolder({ id: 3, parent_id: 2 }),
      makeFolder({ id: 4, parent_id: 1 }),
      makeFolder({ id: 5, parent_id: null }),
    ];
    const desc = getDescendantIds(1, tree);
    expect(desc).toEqual(new Set([2, 3, 4]));
  });
});

describe('isValidDropTarget', () => {
  it('allows user file to any folder', () => {
    const target = makeFolder({ id: 10, source: 'system', source_type: 'post' });
    expect(
      isValidDropTarget({
        sourceFileIds: [100],
        sourceFolderIds: [],
        target,
        currentFolderId: 5,
        allFolders: [target],
      }),
    ).toBe(true);
  });

  it('allows user folder into client system folder', () => {
    const target = makeFolder({ id: 10, source: 'system', source_type: 'client' });
    const source = makeFolder({ id: 20, source: 'user' });
    expect(
      isValidDropTarget({
        sourceFileIds: [],
        sourceFolderIds: [20],
        target,
        currentFolderId: 5,
        allFolders: [target, source],
      }),
    ).toBe(true);
  });

  it('rejects user folder into post system folder', () => {
    const target = makeFolder({ id: 10, source: 'system', source_type: 'post' });
    const source = makeFolder({ id: 20, source: 'user' });
    expect(
      isValidDropTarget({
        sourceFileIds: [],
        sourceFolderIds: [20],
        target,
        currentFolderId: 5,
        allFolders: [target, source],
      }),
    ).toBe(false);
  });

  it('rejects moving system folder', () => {
    const source = makeFolder({ id: 20, source: 'system', source_type: 'client' });
    const target = makeFolder({ id: 10, source: 'user' });
    expect(
      isValidDropTarget({
        sourceFileIds: [],
        sourceFolderIds: [20],
        target,
        currentFolderId: 5,
        allFolders: [target, source],
      }),
    ).toBe(false);
  });

  it('rejects dropping into source folder (same folder)', () => {
    const target = makeFolder({ id: 5, source: 'user' });
    expect(
      isValidDropTarget({
        sourceFileIds: [100],
        sourceFolderIds: [],
        target,
        currentFolderId: 5,
        allFolders: [target],
      }),
    ).toBe(false);
  });

  it('rejects dropping folder into its own descendant (cycle)', () => {
    const allFolders = [
      makeFolder({ id: 1, parent_id: null }),
      makeFolder({ id: 2, parent_id: 1 }),
      makeFolder({ id: 3, parent_id: 2 }),
    ];
    const target = allFolders[2]; // id: 3, descendant of 1
    expect(
      isValidDropTarget({
        sourceFileIds: [],
        sourceFolderIds: [1],
        target,
        currentFolderId: 5,
        allFolders,
      }),
    ).toBe(false);
  });

  it('rejects dropping folder into itself', () => {
    const folder = makeFolder({ id: 1 });
    expect(
      isValidDropTarget({
        sourceFileIds: [],
        sourceFolderIds: [1],
        target: folder,
        currentFolderId: 5,
        allFolders: [folder],
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- --run apps/crm/src/pages/arquivos/__tests__/validityMatrix.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the utility**

Create `apps/crm/src/pages/arquivos/utils/validityMatrix.ts`:

```typescript
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

  if (target.id === currentFolderId) return false;

  if (sourceFolderIds.includes(target.id)) return false;

  const sourceFolders = allFolders.filter((f) => sourceFolderIds.includes(f.id));

  for (const sf of sourceFolders) {
    if (sf.source === 'system') return false;
  }

  if (sourceFolderIds.length > 0 && target.source === 'system' && target.source_type === 'post') {
    return false;
  }

  for (const folderId of sourceFolderIds) {
    const descendants = getDescendantIds(folderId, allFolders);
    if (descendants.has(target.id)) return false;
  }

  return true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- --run apps/crm/src/pages/arquivos/__tests__/validityMatrix.test.ts`

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/arquivos/utils/validityMatrix.ts apps/crm/src/pages/arquivos/__tests__/validityMatrix.test.ts
git commit -m "feat(arquivos): add validity matrix utility with tests"
```

---

## Task 3: InlineRenameInput component

**Files:**
- Create: `apps/crm/src/pages/arquivos/components/InlineRenameInput.tsx`

- [ ] **Step 1: Create the component**

Create `apps/crm/src/pages/arquivos/components/InlineRenameInput.tsx`:

```typescript
import { useState, useRef, useEffect, useCallback } from 'react';

interface InlineRenameInputProps {
  currentName: string;
  onCommit: (newName: string) => void;
  onCancel: () => void;
}

export function InlineRenameInput({ currentName, onCommit, onCancel }: InlineRenameInputProps) {
  const [value, setValue] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);
  const committed = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      const dotIndex = currentName.lastIndexOf('.');
      if (dotIndex > 0) {
        input.setSelectionRange(0, dotIndex);
      } else {
        input.select();
      }
    }
  }, [currentName]);

  const commit = useCallback(() => {
    if (committed.current) return;
    committed.current = true;
    const trimmed = value.trim();
    if (!trimmed || trimmed === currentName) {
      onCancel();
    } else {
      onCommit(trimmed);
    }
  }, [value, currentName, onCommit, onCancel]);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          committed.current = true;
          onCancel();
        }
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="w-full bg-[var(--surface-main)] text-[var(--text-main)] text-xs font-medium border border-[var(--primary-color)] rounded px-1.5 py-0.5 outline-none font-[var(--font-mono)]"
      spellCheck={false}
    />
  );
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build 2>&1 | tail -5`

Expected: Build succeeds (new file is valid TypeScript, though unused at this point).

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/arquivos/components/InlineRenameInput.tsx
git commit -m "feat(arquivos): add InlineRenameInput component"
```

---

## Task 4: Wire inline rename into FileGrid

**Files:**
- Modify: `apps/crm/src/pages/arquivos/components/FileGrid.tsx`
- Modify: `apps/crm/src/services/fileService.ts` (no new functions needed — `renameFile`/`renameFolder` already exist)

- [ ] **Step 1: Add rename state and handlers to FileGrid**

Read `FileGrid.tsx` and modify it to:

1. Add state for tracking which item is being renamed:
   ```typescript
   const [renamingId, setRenamingId] = useState<{ id: number; type: 'file' | 'folder' } | null>(null);
   ```

2. Add a `renameMutation` using `useMutation`:
   ```typescript
   const renameMutation = useMutation({
     mutationFn: async ({ id, type, name }: { id: number; type: 'file' | 'folder'; name: string }) => {
       if (type === 'folder') return renameFolder(id, name);
       return renameFile(id, name);
     },
     onMutate: async ({ id, type, name }) => {
       const queryKey = ['folder-contents', props.currentFolderId ?? null];
       await queryClient.cancelQueries({ queryKey });
       const prev = queryClient.getQueryData<FolderContents>(queryKey);
       if (prev) {
         queryClient.setQueryData(queryKey, {
           ...prev,
           ...(type === 'folder'
             ? { subfolders: prev.subfolders.map((f) => (f.id === id ? { ...f, name } : f)) }
             : { files: prev.files.map((f) => (f.id === id ? { ...f, name } : f)) }),
         });
       }
       return { prev };
     },
     onError: (_err, _vars, ctx) => {
       if (ctx?.prev) queryClient.setQueryData(['folder-contents', props.currentFolderId ?? null], ctx.prev);
       toast.error('Erro ao renomear');
     },
     onSettled: () => {
       queryClient.invalidateQueries({ queryKey: ['folder-contents'] });
       queryClient.invalidateQueries({ queryKey: ['folder-tree'] });
     },
     onSuccess: () => toast.success('Nome atualizado'),
   });
   ```

3. Add `currentFolderId` to `FileGridProps`:
   ```typescript
   currentFolderId?: number | null;
   ```

4. Add keyboard handler for F2 on focused tiles and double-click on name labels — when triggered, set `renamingId`. When rendering the name label, if `renamingId` matches, render `<InlineRenameInput>` instead of the text span.

5. On `InlineRenameInput` commit: call `renameMutation.mutate(...)` and set `renamingId` to `null`. On cancel: set `renamingId` to `null`.

- [ ] **Step 2: Pass `currentFolderId` from ArquivosPage**

In `ArquivosPage.tsx`, add `currentFolderId={currentFolderId}` to the `<FileGrid>` props.

- [ ] **Step 3: Test manually**

Run: `npm run dev`

1. Navigate to a folder with files
2. Double-click a file name — inline input should appear with the file name selected (extension excluded)
3. Press Enter — name should update with a toast
4. Press Escape — should revert without API call
5. Press F2 on a focused tile — should enter rename mode

- [ ] **Step 4: Run the build**

Run: `npm run build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 5: Run existing tests**

Run: `npm run test -- --run`

Expected: All existing tests pass (new rename behavior doesn't break anything — FileContextMenu mock still works).

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/arquivos/components/FileGrid.tsx apps/crm/src/pages/arquivos/ArquivosPage.tsx
git commit -m "feat(arquivos): wire inline rename via F2 and double-click on name"
```

---

## Task 5: FilterPopover component + wire into ArquivosPage

**Files:**
- Create: `apps/crm/src/pages/arquivos/components/FilterPopover.tsx`
- Modify: `apps/crm/src/pages/arquivos/ArquivosPage.tsx`
- Modify: `apps/crm/src/pages/arquivos/components/FileGrid.tsx`

- [ ] **Step 1: Create FilterPopover**

Create `apps/crm/src/pages/arquivos/components/FilterPopover.tsx`:

```typescript
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SlidersHorizontal } from 'lucide-react';

export type FileKind = 'image' | 'video' | 'document';

export interface FilterState {
  types: Set<FileKind>;
}

export const EMPTY_FILTER: FilterState = { types: new Set() };

export function isFilterActive(filter: FilterState): boolean {
  return filter.types.size > 0;
}

export function activeFilterCount(filter: FilterState): number {
  return filter.types.size;
}

interface FilterPopoverProps {
  filter: FilterState;
  onChange: (filter: FilterState) => void;
}

const TYPE_OPTIONS: { value: FileKind; label: string; icon: string }[] = [
  { value: 'image', label: 'Imagens', icon: '🖼' },
  { value: 'video', label: 'Vídeos', icon: '🎥' },
  { value: 'document', label: 'Documentos', icon: '📄' },
];

export function FilterPopover({ filter, onChange }: FilterPopoverProps) {
  const count = activeFilterCount(filter);

  function toggleType(type: FileKind) {
    const next = new Set(filter.types);
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    onChange({ ...filter, types: next });
  }

  function clearAll() {
    onChange({ ...filter, types: new Set() });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-[var(--border-color)] bg-[var(--surface-main)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] transition-colors"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span>Filtros</span>
          {count > 0 && (
            <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-[var(--primary-color)] text-[#12151a] text-[0.6rem] font-bold">
              {count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="end">
        <div className="px-3 py-2 border-b border-[var(--border-color)]">
          <div className="flex items-center justify-between">
            <span className="text-[0.65rem] uppercase tracking-wide font-semibold text-[var(--text-muted)]">
              Tipo
            </span>
            {count > 0 && (
              <button
                onClick={clearAll}
                className="text-[0.65rem] text-[var(--primary-color)] hover:underline"
              >
                Limpar
              </button>
            )}
          </div>
        </div>
        <div className="p-1.5">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => toggleType(opt.value)}
              className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md text-sm hover:bg-[var(--surface-hover)] transition-colors"
            >
              <div
                className={`w-4 h-4 rounded border flex items-center justify-center text-[0.6rem] font-bold transition-colors ${
                  filter.types.has(opt.value)
                    ? 'bg-[var(--primary-color)] border-[var(--primary-color)] text-[#12151a]'
                    : 'border-[var(--text-muted)]'
                }`}
              >
                {filter.types.has(opt.value) && '✓'}
              </div>
              <span className="text-xs">{opt.icon}</span>
              <span className="text-xs text-[var(--text-main)]">{opt.label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Add filter state to ArquivosPage and wire it**

In `ArquivosPage.tsx`:

1. Add filter state:
   ```typescript
   const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
   ```

2. Add the filter function to derive filtered files:
   ```typescript
   const filteredFiles = useMemo(() => {
     if (!isFilterActive(filter) || !data?.files) return data?.files ?? [];
     return data.files.filter((f) => filter.types.has(f.kind));
   }, [data?.files, filter]);
   ```

3. Add `<FilterPopover>` to the desktop toolbar (next to the sort/view controls).

4. Pass `filteredFiles` to `<FileGrid>` instead of `data?.files`.

5. Show empty state with "Limpar filtros" CTA when `filteredFiles.length === 0 && isFilterActive(filter)`.

- [ ] **Step 3: Test manually**

Run: `npm run dev`

1. Navigate to a folder with mixed file types
2. Click "Filtros" → popover should appear with 3 checkboxes
3. Check "Imagens" — only images should show
4. Check "Vídeos" too — images + videos should show
5. Navigate to another folder — filter should persist
6. Uncheck all — empty state with "Limpar filtros" should appear
7. Click "Limpar" — all files should show again

- [ ] **Step 4: Run the build**

Run: `npm run build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/arquivos/components/FilterPopover.tsx apps/crm/src/pages/arquivos/ArquivosPage.tsx
git commit -m "feat(arquivos): add filter-by-type popover with persistent state"
```

---

## Task 6: Hover checkbox + selection ring in FileGrid

**Files:**
- Modify: `apps/crm/src/pages/arquivos/components/FileGrid.tsx`
- Modify: `apps/crm/src/pages/arquivos/ArquivosPage.tsx`

- [ ] **Step 1: Add selection props to FileGrid**

Add to `FileGridProps`:
```typescript
selectedIds: Set<number>;
onToggleSelect: (id: number) => void;
onToggleRangeSelect: (id: number) => void;
selectionCount: number;
```

- [ ] **Step 2: Render hover checkbox on each tile**

In `FileGrid`, for each folder card and file tile in grid mode:

1. Add a checkbox element positioned absolutely at top-left, visible on hover or when selected:
   ```tsx
   <div
     className={`absolute top-2 left-2 w-5 h-5 rounded border-[1.5px] flex items-center justify-center text-[0.6rem] font-bold cursor-pointer z-10 transition-all ${
       isSelected
         ? 'bg-[var(--primary-color)] border-[var(--primary-color)] text-[#12151a] opacity-100'
         : 'border-white/60 bg-black/40 opacity-0 group-hover:opacity-100'
     }`}
     onClick={(e) => {
       e.stopPropagation();
       if (e.shiftKey) {
         onToggleRangeSelect(item.id);
       } else {
         onToggleSelect(item.id);
       }
     }}
   >
     {isSelected && '✓'}
   </div>
   ```

2. Add `group` class to each tile wrapper for the hover reveal.

3. Add a selection ring (outline) when the item is selected:
   ```tsx
   className={`... ${isSelected ? 'ring-2 ring-[var(--primary-color)]' : ''}`}
   ```

4. Modify click behavior: if `selectionCount > 0`, clicking a tile toggles selection instead of opening the file/folder. If `selectionCount === 0`, clicking works as before (opens file / navigates to folder).

- [ ] **Step 3: Wire selection from ArquivosPage**

In `ArquivosPage.tsx`:

1. Import and use `useSelection`:
   ```typescript
   const selection = useSelection();
   ```

2. Clear selection when `currentFolderId` changes:
   ```typescript
   useEffect(() => { selection.clear(); }, [currentFolderId]);
   ```

3. Build the flat items array for range selection:
   ```typescript
   const displayItems = useMemo(() => {
     const sorted = [
       ...sortFolders(data?.subfolders ?? [], sortBy).map((f) => ({ id: f.id })),
       ...sortFiles(filteredFiles, sortBy).map((f) => ({ id: f.id })),
     ];
     return sorted;
   }, [data?.subfolders, filteredFiles, sortBy]);
   ```

4. Pass selection props to `<FileGrid>`:
   ```typescript
   <FileGrid
     selectedIds={selection.selectedIds}
     onToggleSelect={selection.toggle}
     onToggleRangeSelect={(id) => selection.toggleRange(id, displayItems)}
     selectionCount={selection.count}
     ...
   />
   ```

- [ ] **Step 4: Test manually**

Run: `npm run dev`

1. Hover over a file tile — checkbox should appear at top-left
2. Click the checkbox — tile gets a yellow ring, checkbox stays visible and filled
3. Click another file's checkbox — both selected
4. Shift-click a third file — range from last clicked to this one should be selected
5. With items selected, click on a file tile body — should toggle selection (not open file)
6. Navigate to another folder — selection should clear

- [ ] **Step 5: Run tests and build**

Run: `npm run test -- --run && npm run build 2>&1 | tail -5`

Expected: All tests pass, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/arquivos/components/FileGrid.tsx apps/crm/src/pages/arquivos/ArquivosPage.tsx
git commit -m "feat(arquivos): add hover checkbox and selection ring to FileGrid"
```

---

## Task 7: BulkActionBar component

**Files:**
- Create: `apps/crm/src/pages/arquivos/components/BulkActionBar.tsx`
- Modify: `apps/crm/src/pages/arquivos/ArquivosPage.tsx`

- [ ] **Step 1: Create the BulkActionBar**

Create `apps/crm/src/pages/arquivos/components/BulkActionBar.tsx`:

```typescript
import { ArrowRight, Download, Copy, Trash2, X } from 'lucide-react';

interface BulkActionBarProps {
  count: number;
  onMove: () => void;
  onCopy: () => void;
  onZip: () => void;
  onDelete: () => void;
  onClear: () => void;
  isMoving?: boolean;
  isCopying?: boolean;
  isDeleting?: boolean;
  isZipping?: boolean;
}

export function BulkActionBar({
  count,
  onMove,
  onCopy,
  onZip,
  onDelete,
  onClear,
  isMoving,
  isCopying,
  isDeleting,
  isZipping,
}: BulkActionBarProps) {
  if (count === 0) return null;

  const busy = isMoving || isCopying || isDeleting || isZipping;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-full bg-[var(--surface-main)] border border-[var(--border-color)] shadow-lg">
      <span className="text-sm font-bold text-[var(--primary-color)] tabular-nums min-w-[24px] text-center">
        {count}
      </span>

      <div className="w-px h-5 bg-[var(--border-color)]" />

      <button
        onClick={onMove}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full bg-[var(--surface-hover)] hover:bg-[var(--surface-darker)] transition-colors disabled:opacity-40"
      >
        <ArrowRight className="h-3.5 w-3.5" />
        Mover
      </button>

      <button
        onClick={onCopy}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full bg-[var(--surface-hover)] hover:bg-[var(--surface-darker)] transition-colors disabled:opacity-40"
      >
        <Copy className="h-3.5 w-3.5" />
        Copiar
      </button>

      <button
        onClick={onZip}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full bg-[var(--surface-hover)] hover:bg-[var(--surface-darker)] transition-colors disabled:opacity-40"
      >
        <Download className="h-3.5 w-3.5" />
        ZIP
      </button>

      <button
        onClick={onDelete}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full bg-[rgba(245,90,66,0.1)] text-[var(--danger)] hover:bg-[rgba(245,90,66,0.2)] transition-colors disabled:opacity-40"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Excluir
      </button>

      <div className="w-px h-5 bg-[var(--border-color)]" />

      <button
        onClick={onClear}
        className="p-1 rounded-full hover:bg-[var(--surface-hover)] text-[var(--text-muted)] transition-colors"
        title="Limpar seleção"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Wire into ArquivosPage**

In `ArquivosPage.tsx`:

1. Import and render `<BulkActionBar>` at the bottom of the desktop layout:
   ```tsx
   <BulkActionBar
     count={selection.count}
     onMove={() => {/* wired in Task 9 */}}
     onCopy={() => {/* wired in Task 14 */}}
     onZip={() => {/* wired in Task 16 */}}
     onDelete={() => {/* wired in Task 12 */}}
     onClear={selection.clear}
   />
   ```

2. Add Escape key handler to clear selection:
   ```typescript
   useEffect(() => {
     function handleKeyDown(e: KeyboardEvent) {
       if (e.key === 'Escape' && selection.count > 0) {
         selection.clear();
       }
     }
     window.addEventListener('keydown', handleKeyDown);
     return () => window.removeEventListener('keydown', handleKeyDown);
   }, [selection.count, selection.clear]);
   ```

- [ ] **Step 3: Test manually**

Run: `npm run dev`

1. Select a few items via hover checkbox
2. Floating pill should appear at the bottom center with count + action buttons
3. Press Escape — selection clears, pill disappears
4. Select items again, click the X in the pill — same behavior

- [ ] **Step 4: Build**

Run: `npm run build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/arquivos/components/BulkActionBar.tsx apps/crm/src/pages/arquivos/ArquivosPage.tsx
git commit -m "feat(arquivos): add BulkActionBar floating pill with selection actions"
```

---

## Task 8: Backend — bulk-move RPC + endpoint

**Files:**
- Create: `supabase/migrations/20260501000001_bulk_move_items_rpc.sql`
- Modify: `supabase/functions/file-manage/handler.ts`
- Modify: `apps/crm/src/services/fileService.ts`

- [ ] **Step 1: Create the Postgres RPC migration**

Create `supabase/migrations/20260501000001_bulk_move_items_rpc.sql`:

```sql
CREATE OR REPLACE FUNCTION bulk_move_items(
  p_conta_id uuid,
  p_file_ids bigint[],
  p_folder_ids bigint[],
  p_destination_id bigint DEFAULT NULL
)
RETURNS json AS $$
DECLARE
  v_file_count int;
  v_folder_count int;
  v_folder_id bigint;
  v_ancestors bigint[];
BEGIN
  -- Validate all files belong to conta_id
  IF coalesce(array_length(p_file_ids, 1), 0) > 0 THEN
    SELECT count(*) INTO v_file_count
    FROM files
    WHERE id = ANY(p_file_ids) AND conta_id = p_conta_id;

    IF v_file_count <> array_length(p_file_ids, 1) THEN
      RETURN json_build_object('error', 'Some files not found or not owned', 'code', 'invalid_files');
    END IF;
  END IF;

  -- Validate all folders belong to conta_id and are not system folders
  IF coalesce(array_length(p_folder_ids, 1), 0) > 0 THEN
    SELECT count(*) INTO v_folder_count
    FROM folders
    WHERE id = ANY(p_folder_ids) AND conta_id = p_conta_id AND source = 'user';

    IF v_folder_count <> array_length(p_folder_ids, 1) THEN
      RETURN json_build_object('error', 'Some folders not found, not owned, or are system folders', 'code', 'invalid_folders');
    END IF;
  END IF;

  -- Validate destination exists and belongs to conta_id (if not null / root)
  IF p_destination_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM folders WHERE id = p_destination_id AND conta_id = p_conta_id) THEN
      RETURN json_build_object('error', 'Destination folder not found', 'code', 'invalid_destination');
    END IF;

    -- Check destination is not a post system folder when moving folders
    IF array_length(p_folder_ids, 1) > 0 THEN
      IF EXISTS (SELECT 1 FROM folders WHERE id = p_destination_id AND source = 'system' AND source_type = 'post') THEN
        RETURN json_build_object('error', 'Cannot move folders into post folders', 'code', 'post_folder_restriction');
      END IF;
    END IF;

    -- Check no folder is being moved into itself or a descendant
    FOREACH v_folder_id IN ARRAY p_folder_ids LOOP
      -- Build ancestor chain from destination up to root
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id FROM folders WHERE id = p_destination_id
        UNION ALL
        SELECT f.id, f.parent_id FROM folders f JOIN ancestors a ON f.id = a.parent_id
      )
      SELECT array_agg(id) INTO v_ancestors FROM ancestors;

      IF v_folder_id = ANY(v_ancestors) THEN
        RETURN json_build_object(
          'error', 'Cannot move folder into itself or a descendant',
          'code', 'cycle_detected',
          'folder_id', v_folder_id
        );
      END IF;
    END LOOP;
  END IF;

  -- Perform the moves
  IF array_length(p_file_ids, 1) > 0 THEN
    UPDATE files SET folder_id = p_destination_id WHERE id = ANY(p_file_ids) AND conta_id = p_conta_id;
  END IF;

  IF coalesce(array_length(p_folder_ids, 1), 0) > 0 THEN
    UPDATE folders SET parent_id = p_destination_id, updated_at = now() WHERE id = ANY(p_folder_ids) AND conta_id = p_conta_id;
  END IF;

  RETURN json_build_object('ok', true, 'files_moved', coalesce(array_length(p_file_ids, 1), 0), 'folders_moved', coalesce(array_length(p_folder_ids, 1), 0));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 2: Add bulk-move route to handler.ts**

In `supabase/functions/file-manage/handler.ts`, add a new route block for `POST /bulk-move`:

```typescript
// After the existing routes, before the 404 fallback:

if (resource === "bulk-move" && req.method === "POST") {
  const body = await req.json().catch(() => ({}));
  const { file_ids, folder_ids, destination_id } = body as {
    file_ids?: number[];
    folder_ids?: number[];
    destination_id?: number | null;
  };

  if ((!file_ids || file_ids.length === 0) && (!folder_ids || folder_ids.length === 0)) {
    return json({ error: "No items to move" }, 400);
  }

  const { data: result, error: rpcError } = await svc.rpc("bulk_move_items", {
    p_conta_id: contaId,
    p_file_ids: file_ids ?? [],
    p_folder_ids: folder_ids ?? [],
    p_destination_id: destination_id ?? null,
  });

  if (rpcError) return json({ error: rpcError.message }, 500);
  if (result?.error) return json(result, 400);

  await insertAuditLog(svc, {
    conta_id: contaId,
    actor_user_id: user.id,
    action: "bulk_move",
    resource_type: "files_and_folders",
    metadata: { file_ids, folder_ids, destination_id, result },
  });

  return json(result);
}
```

Import `insertAuditLog` at the top of `handler.ts`:
```typescript
import { insertAuditLog } from "../_shared/audit.ts";
```

- [ ] **Step 3: Add `bulkMove` to fileService.ts**

In `apps/crm/src/services/fileService.ts`, add:

```typescript
export async function bulkMove(
  fileIds: number[],
  folderIds: number[],
  destinationId: number | null,
): Promise<{ ok: boolean; files_moved: number; folders_moved: number }> {
  return callFn('file-manage', 'POST', {
    file_ids: fileIds,
    folder_ids: folderIds,
    destination_id: destinationId,
  }, undefined, '/bulk-move');
}
```

- [ ] **Step 4: Run the build**

Run: `npm run build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260501000001_bulk_move_items_rpc.sql supabase/functions/file-manage/handler.ts apps/crm/src/services/fileService.ts
git commit -m "feat(arquivos): add bulk-move RPC and endpoint"
```

---

## Task 9: FolderPickerModal component + Move wiring

**Files:**
- Create: `apps/crm/src/pages/arquivos/components/FolderPickerModal.tsx`
- Modify: `apps/crm/src/pages/arquivos/ArquivosPage.tsx`
- Modify: `apps/crm/src/pages/arquivos/components/FileContextMenu.tsx`

- [ ] **Step 1: Create FolderPickerModal**

Create `apps/crm/src/pages/arquivos/components/FolderPickerModal.tsx`:

```typescript
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

  // A node is disabled if it's in the static disabledIds set OR if its
  // parent chain contains a source folder (detected by checking if this
  // node's parent_id is a source folder — since PickerNode recursion
  // passes sourceFolderIds through, child nodes of a disabled folder
  // also get disabled via the disabledIds set which is rebuilt to include
  // all children of source folders as they are fetched).
  const childDisabledIds = useMemo(() => {
    if (!sourceFolderIds.includes(folder.id)) return disabledIds;
    // This folder is a source — all its children must be disabled too
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

  // Collect all known folders across the tree (root level is always fetched;
  // child levels are fetched lazily as PickerNodes expand). We pass the
  // source folder IDs as always-disabled and let PickerNode check its own
  // children against the source IDs on expand. The backend re-validates
  // on the actual move/copy call, so this is a best-effort UX guard.
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
```

- [ ] **Step 2: Wire Move into ArquivosPage**

In `ArquivosPage.tsx`:

1. Add state for the picker:
   ```typescript
   const [pickerMode, setPickerMode] = useState<'move' | 'copy' | null>(null);
   ```

2. Add bulk move mutation:
   ```typescript
   const bulkMoveMutation = useMutation({
     mutationFn: ({ fileIds, folderIds, destinationId }: { fileIds: number[]; folderIds: number[]; destinationId: number | null }) =>
       bulkMove(fileIds, folderIds, destinationId),
     onSuccess: () => {
       toast.success('Itens movidos com sucesso');
       selection.clear();
       queryClient.invalidateQueries({ queryKey: ['folder-contents'] });
       queryClient.invalidateQueries({ queryKey: ['folder-tree'] });
     },
     onError: () => toast.error('Erro ao mover itens'),
   });
   ```

3. Wire `onMove` in `<BulkActionBar>` to open the picker:
   ```typescript
   onMove={() => setPickerMode('move')}
   ```

4. Render the `<FolderPickerModal>`:
   ```tsx
   <FolderPickerModal
     open={pickerMode === 'move'}
     onOpenChange={(open) => { if (!open) setPickerMode(null); }}
     title={`Mover ${selection.count} ${selection.count === 1 ? 'item' : 'itens'}`}
     confirmLabel="Mover"
     isLoading={bulkMoveMutation.isPending}
     sourceFolderIds={[...selection.selectedIds].filter((id) =>
       data?.subfolders.some((f) => f.id === id)
     )}
     currentFolderId={currentFolderId}
     onConfirm={(destId) => {
       const fileIds = [...selection.selectedIds].filter((id) =>
         data?.files.some((f) => f.id === id)
       );
       const folderIds = [...selection.selectedIds].filter((id) =>
         data?.subfolders.some((f) => f.id === id)
       );
       bulkMoveMutation.mutate({ fileIds, folderIds, destinationId: destId });
       setPickerMode(null);
     }}
   />
   ```

- [ ] **Step 3: Add "Mover para…" to FileContextMenu**

In `FileContextMenu.tsx`:

1. Add `onRequestMove` prop:
   ```typescript
   onRequestMove?: (id: number, type: 'file' | 'folder') => void;
   ```

2. Add a "Mover para…" menu item (with `ArrowRight` icon) above the separator before Delete.

3. In `ArquivosPage.tsx`, pass `onRequestMove` that selects just that one item and opens the picker.

- [ ] **Step 4: Test manually**

Run: `npm run dev`

1. Select 2 files → click "Mover" in the bulk bar → picker opens
2. Pick a destination folder → click "Mover" → items disappear from current view, toast "Itens movidos com sucesso"
3. Navigate to destination → items should be there
4. Right-click a single file → "Mover para…" → same picker behavior for one item
5. Try to move a folder into itself → destination should be greyed out

- [ ] **Step 5: Build + tests**

Run: `npm run build 2>&1 | tail -5 && npm run test -- --run`

Expected: Build and tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/arquivos/components/FolderPickerModal.tsx apps/crm/src/pages/arquivos/ArquivosPage.tsx apps/crm/src/pages/arquivos/components/FileContextMenu.tsx
git commit -m "feat(arquivos): add FolderPickerModal and wire move via picker"
```

---

## Task 10: Drag-and-drop move (desktop)

**Files:**
- Create: `apps/crm/src/pages/arquivos/hooks/useDragDrop.ts`
- Modify: `apps/crm/src/pages/arquivos/components/FileGrid.tsx`
- Modify: `apps/crm/src/pages/arquivos/components/FolderTree.tsx`
- Modify: `apps/crm/src/pages/arquivos/ArquivosPage.tsx`

- [ ] **Step 1: Create useDragDrop hook**

Create `apps/crm/src/pages/arquivos/hooks/useDragDrop.ts`:

```typescript
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
```

- [ ] **Step 2: Add drag source to FileGrid tiles**

In `FileGrid.tsx`, for each tile wrapper:

1. Import `useDragSource`, `isInternalDrag`.
2. For each folder card and file tile, spread the drag source props onto the wrapper `div`. The item is only draggable when selection count is 0 OR the item is in the selection.

- [ ] **Step 3: Add drop targets to FolderTree nodes**

In `FolderTree.tsx`:

1. Add props to `FolderTree`:
   ```typescript
   onDrop?: (targetFolderId: number, payload: DragPayload) => void;
   dragActive?: boolean;
   ```

2. On each `FolderNode`, add `onDragOver`, `onDragLeave`, `onDrop` handlers:
   - `onDragOver`: if internal drag and valid target, `preventDefault()` + set highlight state
   - `onDrop`: parse payload, call `onDrop` prop
   - Auto-expand: when dragging over a collapsed node for >500ms, expand it

3. Visual highlight: add a colored left border or background tint when `isDragOver` is true.

- [ ] **Step 4: Add drop targets to FileGrid folder cards**

In `FileGrid.tsx`, folder cards also act as drop targets. Add the same `onDragOver`/`onDrop` handling. Users can drop items onto a folder card in the grid to move into that folder.

- [ ] **Step 5: Wire ArquivosPage**

In `ArquivosPage.tsx`:

1. Add a `handleDrop` callback that calls `bulkMoveMutation.mutate`:
   ```typescript
   const handleDrop = useCallback(
     (targetFolderId: number, payload: DragPayload) => {
       // If the dragged item was in the selection, use the full selection
       let fileIds = payload.fileIds;
       let folderIds = payload.folderIds;

       if (
         selection.count > 1 &&
         (fileIds.some((id) => selection.selectedIds.has(id)) ||
          folderIds.some((id) => selection.selectedIds.has(id)))
       ) {
         fileIds = [...selection.selectedIds].filter((id) => data?.files.some((f) => f.id === id));
         folderIds = [...selection.selectedIds].filter((id) => data?.subfolders.some((f) => f.id === id));
       }

       bulkMoveMutation.mutate({ fileIds, folderIds, destinationId: targetFolderId });
     },
     [selection, data, bulkMoveMutation],
   );
   ```

2. Pass `onDrop={handleDrop}` to `<FolderTree>` and `<FileGrid>`.

- [ ] **Step 6: Disambiguate internal drag from external file upload**

In `FileUploader.tsx`, update `handleDragOver` and `handleDrop` to check `isExternalFileDrag(e)` — only activate the upload drop zone for external file drags, not internal move drags.

- [ ] **Step 7: Test manually**

Run: `npm run dev`

1. Drag a single file tile → folder card in grid → file moves to that folder
2. Select 3 items → drag one of them → drag ghost says "Mover 3 itens" → drop on a tree node → all 3 move
3. Hover over a collapsed tree node while dragging → after 500ms it expands
4. Drag an external file from Finder → upload drop zone activates (not a move)
5. Try to drag a system folder → should not be draggable (or if dragged, no valid targets accept it)

- [ ] **Step 8: Build + tests**

Run: `npm run build 2>&1 | tail -5 && npm run test -- --run`

- [ ] **Step 9: Commit**

```bash
git add apps/crm/src/pages/arquivos/hooks/useDragDrop.ts apps/crm/src/pages/arquivos/components/FileGrid.tsx apps/crm/src/pages/arquivos/components/FolderTree.tsx apps/crm/src/pages/arquivos/ArquivosPage.tsx apps/crm/src/pages/arquivos/components/FileUploader.tsx
git commit -m "feat(arquivos): add drag-and-drop move with ghost and tree drop targets"
```

---

## Task 11: Backend — bulk-delete endpoint

**Files:**
- Modify: `supabase/functions/file-manage/handler.ts`
- Modify: `apps/crm/src/services/fileService.ts`

- [ ] **Step 1: Add bulk-delete route to handler.ts**

In `handler.ts`, add a new route block for `POST /bulk-delete`:

```typescript
if (resource === "bulk-delete" && req.method === "POST") {
  const body = await req.json().catch(() => ({}));
  const { file_ids, folder_ids } = body as { file_ids?: number[]; folder_ids?: number[] };

  if ((!file_ids || file_ids.length === 0) && (!folder_ids || folder_ids.length === 0)) {
    return json({ error: "No items to delete" }, 400);
  }

  const blocked: { id: number; type: string; reason: string }[] = [];
  const deletableFileIds: number[] = [];
  const deletableFolderIds: number[] = [];

  // Partition files
  if (file_ids && file_ids.length > 0) {
    const { data: files } = await svc
      .from("files")
      .select("id, reference_count, size_bytes")
      .eq("conta_id", contaId)
      .in("id", file_ids);

    for (const f of files ?? []) {
      if (f.reference_count > 0) {
        blocked.push({ id: f.id, type: "file", reason: "file_in_use" });
      } else {
        deletableFileIds.push(f.id);
      }
    }

    const foundIds = new Set((files ?? []).map((f: { id: number }) => f.id));
    for (const id of file_ids) {
      if (!foundIds.has(id)) blocked.push({ id, type: "file", reason: "not_found" });
    }
  }

  // Partition folders
  if (folder_ids && folder_ids.length > 0) {
    const { data: folders } = await svc
      .from("folders")
      .select("id, source")
      .eq("conta_id", contaId)
      .in("id", folder_ids);

    for (const f of folders ?? []) {
      if (f.source === "system") {
        blocked.push({ id: f.id, type: "folder", reason: "system_folder" });
      } else {
        deletableFolderIds.push(f.id);
      }
    }

    const foundIds = new Set((folders ?? []).map((f: { id: number }) => f.id));
    for (const id of folder_ids) {
      if (!foundIds.has(id)) blocked.push({ id, type: "folder", reason: "not_found" });
    }
  }

  // If anything is blocked, return 409 without deleting
  if (blocked.length > 0) {
    return json({ blocked, deletable: { file_ids: deletableFileIds, folder_ids: deletableFolderIds } }, 409);
  }

  // Delete files — deleting the DB rows triggers the existing
  // file_deletions insert trigger, which queues the R2 keys for
  // cleanup by the post-media-cleanup-cron. No manual R2 deletion needed.
  let totalBytesFreed = 0;
  if (deletableFileIds.length > 0) {
    const { data: filesToDelete } = await svc
      .from("files")
      .select("size_bytes")
      .in("id", deletableFileIds);

    totalBytesFreed = (filesToDelete ?? []).reduce((sum: number, f: { size_bytes: number }) => sum + f.size_bytes, 0);

    const { error: delErr } = await svc.from("files").delete().in("id", deletableFileIds);
    if (delErr) return json({ error: delErr.message }, 500);
  }

  // Delete folders
  if (deletableFolderIds.length > 0) {
    const { error: delErr } = await svc.from("folders").delete().in("id", deletableFolderIds);
    if (delErr) return json({ error: delErr.message }, 500);
  }

  // Decrement storage usage
  if (totalBytesFreed > 0) {
    await svc.rpc("decrement_storage", { p_conta_id: contaId, p_bytes: totalBytesFreed }).catch(() => {});
  }

  await insertAuditLog(svc, {
    conta_id: contaId,
    actor_user_id: user.id,
    action: "bulk_delete",
    resource_type: "files_and_folders",
    metadata: { file_ids: deletableFileIds, folder_ids: deletableFolderIds, bytes_freed: totalBytesFreed },
  });

  return json({ ok: true, files_deleted: deletableFileIds.length, folders_deleted: deletableFolderIds.length });
}
```

- [ ] **Step 2: Add `bulkDelete` to fileService.ts**

In `apps/crm/src/services/fileService.ts`:

```typescript
export interface BulkDeleteResult {
  ok?: boolean;
  files_deleted?: number;
  folders_deleted?: number;
  blocked?: { id: number; type: string; reason: string }[];
  deletable?: { file_ids: number[]; folder_ids: number[] };
}

export async function bulkDelete(
  fileIds: number[],
  folderIds: number[],
): Promise<BulkDeleteResult> {
  // Use a raw fetch instead of callFn because we need to handle 409 as a
  // valid (non-error) response that returns structured data.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const url = new URL(`${SUPABASE_URL}/functions/v1/file-manage/bulk-delete`);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file_ids: fileIds, folder_ids: folderIds }),
  });

  const data = await res.json();
  if (res.status === 409) return data as BulkDeleteResult;
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as BulkDeleteResult;
}
```

- [ ] **Step 3: Build**

Run: `npm run build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/file-manage/handler.ts apps/crm/src/services/fileService.ts
git commit -m "feat(arquivos): add bulk-delete endpoint with partial-blocking"
```

---

## Task 12: Wire bulk delete into ArquivosPage

**Files:**
- Modify: `apps/crm/src/pages/arquivos/ArquivosPage.tsx`

- [ ] **Step 1: Add bulk delete mutation and dialog**

In `ArquivosPage.tsx`:

1. Add state for the delete confirmation flow:
   ```typescript
   const [deleteConfirm, setDeleteConfirm] = useState<{
     fileIds: number[];
     folderIds: number[];
     blocked?: { id: number; type: string; reason: string }[];
     stage: 'confirm' | 'partial';
   } | null>(null);
   ```

2. Add the bulk delete mutation:
   ```typescript
   const bulkDeleteMutation = useMutation({
     mutationFn: ({ fileIds, folderIds }: { fileIds: number[]; folderIds: number[] }) =>
       bulkDelete(fileIds, folderIds),
     onSuccess: (result) => {
       if (result.blocked && result.blocked.length > 0) {
         setDeleteConfirm({
           fileIds: result.deletable?.file_ids ?? [],
           folderIds: result.deletable?.folder_ids ?? [],
           blocked: result.blocked,
           stage: 'partial',
         });
       } else {
         toast.success(`${(result.files_deleted ?? 0) + (result.folders_deleted ?? 0)} itens excluídos`);
         selection.clear();
         setDeleteConfirm(null);
         queryClient.invalidateQueries({ queryKey: ['folder-contents'] });
         queryClient.invalidateQueries({ queryKey: ['folder-tree'] });
       }
     },
     onError: () => toast.error('Erro ao excluir itens'),
   });
   ```

3. Wire `onDelete` in `<BulkActionBar>`:
   ```typescript
   onDelete={() => {
     const fileIds = [...selection.selectedIds].filter((id) => data?.files.some((f) => f.id === id));
     const folderIds = [...selection.selectedIds].filter((id) => data?.subfolders.some((f) => f.id === id));
     setDeleteConfirm({ fileIds, folderIds, stage: 'confirm' });
   }}
   ```

4. Add an `<AlertDialog>` for the confirmation flows (initial confirm + partial-blocking re-confirm).

- [ ] **Step 2: Test manually**

Run: `npm run dev`

1. Select files that are NOT linked to posts → click "Excluir" → confirmation dialog → confirm → items deleted
2. Select a mix including a file linked to a post → click "Excluir" → 409 response → partial dialog: "X itens não podem ser excluídos. Excluir os outros Y?" → confirm → only deletable items deleted
3. Try to delete a system folder → it should be blocked

- [ ] **Step 3: Build + tests**

Run: `npm run build 2>&1 | tail -5 && npm run test -- --run`

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/arquivos/ArquivosPage.tsx
git commit -m "feat(arquivos): wire bulk delete with partial-blocking confirmation dialog"
```

---

## Task 13: Backend — copy endpoints + R2 copyObject

**Files:**
- Modify: `supabase/functions/_shared/r2.ts`
- Modify: `supabase/functions/file-manage/handler.ts`
- Modify: `apps/crm/src/services/fileService.ts`

- [ ] **Step 1: Add copyObject to r2.ts**

In `supabase/functions/_shared/r2.ts`:

1. Add the import:
   ```typescript
   import { CopyObjectCommand } from "npm:@aws-sdk/client-s3@3.637.0";
   ```

2. Add the function:
   ```typescript
   export async function copyObject(sourceKey: string, destKey: string): Promise<void> {
     await r2.send(new CopyObjectCommand({
       Bucket: R2_BUCKET,
       CopySource: `${R2_BUCKET}/${sourceKey}`,
       Key: destKey,
     }));
   }
   ```

- [ ] **Step 2: Add `getObject` to r2.ts for ZIP streaming**

```typescript
export async function getObject(key: string): Promise<ReadableStream<Uint8Array> | null> {
  try {
    const res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return (res.Body as ReadableStream<Uint8Array>) ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Add file copy route to handler.ts**

Add `POST /files/:id/copy` route:

```typescript
if (resource === "files" && idStr && subResource === "copy" && req.method === "POST") {
  const fileId = Number(idStr);
  const body = await req.json().catch(() => ({}));
  const { destination_folder_id } = body as { destination_folder_id?: number | null };

  // Fetch source file
  const { data: source } = await svc.from("files").select("*").eq("id", fileId).single();
  if (!source || source.conta_id !== contaId) return json({ error: "File not found" }, 404);

  // Validate destination
  if (destination_folder_id !== null && destination_folder_id !== undefined) {
    const { data: destFolder } = await svc.from("folders").select("conta_id").eq("id", destination_folder_id).single();
    if (!destFolder || destFolder.conta_id !== contaId) return json({ error: "Destination not found" }, 404);
  }

  // Quota check
  const { data: ws } = await svc.from("workspaces").select("storage_used_bytes, storage_quota_bytes").eq("conta_id", contaId).single();
  if (ws && (ws.storage_used_bytes + source.size_bytes) > ws.storage_quota_bytes) {
    return json({ error: "quota_exceeded", used: ws.storage_used_bytes, quota: ws.storage_quota_bytes, copy_bytes: source.size_bytes }, 413);
  }

  // Generate new R2 key
  const newR2Key = `${contaId}/${crypto.randomUUID()}-${source.name}`;
  let newThumbKey: string | null = null;

  // R2 copy
  try {
    await copyObject(source.r2_key, newR2Key);
    if (source.thumbnail_r2_key) {
      newThumbKey = `${contaId}/thumb-${crypto.randomUUID()}-${source.name}`;
      await copyObject(source.thumbnail_r2_key, newThumbKey);
    }
  } catch (err) {
    return json({ error: "R2 copy failed" }, 500);
  }

  // Insert new file row
  const { data: newFile, error: insertErr } = await svc.from("files").insert({
    conta_id: contaId,
    folder_id: destination_folder_id ?? null,
    r2_key: newR2Key,
    thumbnail_r2_key: newThumbKey,
    name: source.name,
    kind: source.kind,
    mime_type: source.mime_type,
    size_bytes: source.size_bytes,
    width: source.width,
    height: source.height,
    duration_seconds: source.duration_seconds,
    blur_data_url: source.blur_data_url,
    uploaded_by: user.id,
    reference_count: 0,
  }).select().single();

  if (insertErr) return json({ error: insertErr.message }, 500);

  // Update storage usage
  await svc.from("workspaces").update({ storage_used_bytes: (ws?.storage_used_bytes ?? 0) + source.size_bytes }).eq("conta_id", contaId);

  await insertAuditLog(svc, {
    conta_id: contaId,
    actor_user_id: user.id,
    action: "copy_file",
    resource_type: "file",
    resource_id: String(newFile.id),
    metadata: { source_file_id: fileId, destination_folder_id },
  });

  return json(newFile, 201);
}
```

Import `copyObject` at the top:
```typescript
import { copyObject } from "../_shared/r2.ts";
```

Note: Parsing `subResource` — update the URL parsing at the top of the handler to extract a sub-resource after the ID. The existing URL parsing splits on `/` segments like `/files/123`. Add support for `/files/123/copy` by checking `segments[2]`.

- [ ] **Step 4: Add folder copy route to handler.ts**

Add `POST /folders/:id/copy` route. This is the recursive operation with depth/item limits:

```typescript
if (resource === "folders" && idStr && subResource === "copy" && req.method === "POST") {
  const folderId = Number(idStr);
  const body = await req.json().catch(() => ({}));
  const { destination_folder_id } = body as { destination_folder_id?: number | null };

  const { data: source } = await svc.from("folders").select("*").eq("id", folderId).single();
  if (!source || source.conta_id !== contaId) return json({ error: "Folder not found" }, 404);

  // Pre-compute: recursive file count and total bytes
  const { data: sizeInfo } = await svc.rpc("folder_sizes_batch", { p_folder_ids: [folderId] });
  const totalFiles = sizeInfo?.[0]?.file_count ?? 0;
  const totalBytes = sizeInfo?.[0]?.total_size_bytes ?? 0;

  if (totalFiles > 200) {
    return json({ error: "copy_limit_exceeded", file_count: totalFiles, limit: 200 }, 413);
  }

  // Quota check
  const { data: ws } = await svc.from("workspaces").select("storage_used_bytes, storage_quota_bytes").eq("conta_id", contaId).single();
  if (ws && (ws.storage_used_bytes + totalBytes) > ws.storage_quota_bytes) {
    return json({ error: "quota_exceeded", used: ws.storage_used_bytes, quota: ws.storage_quota_bytes, copy_bytes: totalBytes }, 413);
  }

  // Recursive copy (depth-first)
  let copiedCount = 0;
  let failedCount = 0;

  async function copyFolderRecursive(srcId: number, destParentId: number | null, depth: number): Promise<void> {
    if (depth > 10) {
      console.error(`[copy] Depth limit exceeded for folder ${srcId}`);
      return;
    }

    const { data: srcFolder } = await svc.from("folders").select("name").eq("id", srcId).single();
    if (!srcFolder) return;

    const { data: newFolder } = await svc.from("folders").insert({
      conta_id: contaId,
      parent_id: destParentId,
      name: srcFolder.name,
      source: "user",
    }).select().single();
    if (!newFolder) return;

    // Copy files in this folder
    const { data: files } = await svc.from("files").select("*").eq("folder_id", srcId).eq("conta_id", contaId);
    for (const f of (files ?? [])) {
      const newR2Key = `${contaId}/${crypto.randomUUID()}-${f.name}`;
      let newThumbKey: string | null = null;

      try {
        await copyObject(f.r2_key, newR2Key);
        if (f.thumbnail_r2_key) {
          newThumbKey = `${contaId}/thumb-${crypto.randomUUID()}-${f.name}`;
          await copyObject(f.thumbnail_r2_key, newThumbKey);
        }

        await svc.from("files").insert({
          conta_id: contaId,
          folder_id: newFolder.id,
          r2_key: newR2Key,
          thumbnail_r2_key: newThumbKey,
          name: f.name,
          kind: f.kind,
          mime_type: f.mime_type,
          size_bytes: f.size_bytes,
          width: f.width,
          height: f.height,
          duration_seconds: f.duration_seconds,
          blur_data_url: f.blur_data_url,
          uploaded_by: user.id,
          reference_count: 0,
        });
        copiedCount++;
      } catch (err) {
        console.error(`[copy] Failed to copy file ${f.id}:`, err);
        failedCount++;
      }
    }

    // Recurse into subfolders
    const { data: subfolders } = await svc.from("folders").select("id").eq("parent_id", srcId).eq("conta_id", contaId);
    for (const sub of (subfolders ?? [])) {
      await copyFolderRecursive(sub.id, newFolder.id, depth + 1);
    }
  }

  await copyFolderRecursive(folderId, destination_folder_id ?? null, 0);

  // Update storage usage
  if (copiedCount > 0) {
    await svc.from("workspaces").update({ storage_used_bytes: (ws?.storage_used_bytes ?? 0) + totalBytes }).eq("conta_id", contaId);
  }

  await insertAuditLog(svc, {
    conta_id: contaId,
    actor_user_id: user.id,
    action: "copy_folder",
    resource_type: "folder",
    resource_id: String(folderId),
    metadata: { destination_folder_id, copied: copiedCount, failed: failedCount },
  });

  return json({ ok: true, copied: copiedCount, failed: failedCount }, 201);
}
```

- [ ] **Step 5: Add `copyFile` and `copyFolder` to fileService.ts**

```typescript
export async function copyFile(fileId: number, destinationFolderId: number | null): Promise<FileRecord> {
  return callFn<FileRecord>('file-manage', 'POST', { destination_folder_id: destinationFolderId }, undefined, `/files/${fileId}/copy`);
}

export async function copyFolder(folderId: number, destinationFolderId: number | null): Promise<{ ok: boolean; copied: number; failed: number }> {
  return callFn('file-manage', 'POST', { destination_folder_id: destinationFolderId }, undefined, `/folders/${folderId}/copy`);
}
```

- [ ] **Step 6: Build**

Run: `npm run build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/r2.ts supabase/functions/file-manage/handler.ts apps/crm/src/services/fileService.ts
git commit -m "feat(arquivos): add copy endpoints with R2 server-side COPY and quota checks"
```

---

## Task 14: Wire copy into ArquivosPage + context menu

**Files:**
- Modify: `apps/crm/src/pages/arquivos/ArquivosPage.tsx`
- Modify: `apps/crm/src/pages/arquivos/components/FileContextMenu.tsx`

- [ ] **Step 1: Add copy mutations to ArquivosPage**

In `ArquivosPage.tsx`:

1. Add copy mutations:
   ```typescript
   const copyFileMutation = useMutation({
     mutationFn: ({ fileId, destinationId }: { fileId: number; destinationId: number | null }) =>
       copyFile(fileId, destinationId),
     onSuccess: () => {
       toast.success('Arquivo copiado');
       queryClient.invalidateQueries({ queryKey: ['folder-contents'] });
     },
     onError: (err) => {
       if (err.message.includes('quota_exceeded')) {
         toast.error('Cópia excederia o armazenamento. Libere espaço ou faça upgrade.');
       } else {
         toast.error('Erro ao copiar arquivo');
       }
     },
   });

   const copyFolderMutation = useMutation({
     mutationFn: ({ folderId, destinationId }: { folderId: number; destinationId: number | null }) =>
       copyFolder(folderId, destinationId),
     onSuccess: (result) => {
       if (result.failed > 0) {
         toast.warning(`${result.copied} de ${result.copied + result.failed} arquivos copiados`);
       } else {
         toast.success(`${result.copied} arquivo${result.copied !== 1 ? 's' : ''} copiado${result.copied !== 1 ? 's' : ''}`);
       }
       queryClient.invalidateQueries({ queryKey: ['folder-contents'] });
       queryClient.invalidateQueries({ queryKey: ['folder-tree'] });
     },
     onError: (err) => {
       if (err.message.includes('quota_exceeded')) {
         toast.error('Cópia excederia o armazenamento. Libere espaço ou faça upgrade.');
       } else if (err.message.includes('copy_limit_exceeded')) {
         toast.error('Pasta muito grande para copiar (máximo 200 arquivos).');
       } else {
         toast.error('Erro ao copiar pasta');
       }
     },
   });
   ```

2. Wire `onCopy` in `<BulkActionBar>` to open the picker in copy mode:
   ```typescript
   onCopy={() => setPickerMode('copy')}
   ```

3. Reuse `<FolderPickerModal>` for copy — when `pickerMode === 'copy'`, render with `title="Copiar..."` and `confirmLabel="Copiar"`, and on confirm call the appropriate copy mutation for each selected item.

- [ ] **Step 2: Add "Copiar para…" to FileContextMenu**

Add an `onRequestCopy` prop and a "Copiar para…" menu item with a `Copy` icon.

- [ ] **Step 3: Test manually**

Run: `npm run dev`

1. Right-click a file → "Copiar para…" → pick a destination → confirm → file is copied
2. Navigate to destination → copy should be there with the same name
3. Rename the copy → original stays unchanged (independent)
4. Select multiple items → "Copiar" in bulk bar → pick destination → copies created
5. Try copying a large folder exceeding 200 files → should get an error toast

- [ ] **Step 4: Build + tests**

Run: `npm run build 2>&1 | tail -5 && npm run test -- --run`

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/arquivos/ArquivosPage.tsx apps/crm/src/pages/arquivos/components/FileContextMenu.tsx
git commit -m "feat(arquivos): wire copy into bulk bar and context menu"
```

---

## Task 15: Backend — ZIP token + file-zip edge function

**Files:**
- Modify: `supabase/functions/file-manage/handler.ts`
- Create: `supabase/functions/file-zip/index.ts`
- Modify: `apps/crm/src/services/fileService.ts`

- [ ] **Step 1: Add HMAC utility for ZIP tokens**

In `handler.ts`, add HMAC helpers (or create a shared utility):

```typescript
async function signZipToken(payload: Record<string, unknown>, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const payloadStr = JSON.stringify(payload);
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadStr));
  const sigHex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return btoa(JSON.stringify({ payload: payloadStr, sig: sigHex }));
}

async function verifyZipToken(token: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const { payload: payloadStr, sig: sigHex } = JSON.parse(atob(token));
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)));
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(payloadStr));
    if (!valid) return null;
    const payload = JSON.parse(payloadStr);
    if (payload.expires_at && new Date(payload.expires_at) < new Date()) return null;
    return payload;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Add zip-token route to handler.ts**

```typescript
if (resource === "zip-token" && req.method === "POST") {
  const ZIP_TOKEN_SECRET = Deno.env.get("ZIP_TOKEN_SECRET");
  if (!ZIP_TOKEN_SECRET) throw new Error("ZIP_TOKEN_SECRET is required");

  const body = await req.json().catch(() => ({}));
  const { folder_id, file_ids } = body as { folder_id?: number; file_ids?: number[] };

  if (!folder_id && (!file_ids || file_ids.length === 0)) {
    return json({ error: "folder_id or file_ids required" }, 400);
  }

  // Cap pre-check
  let totalBytes = 0;
  let fileCount = 0;

  if (folder_id) {
    const { data: sizeInfo } = await svc.rpc("folder_sizes_batch", { p_folder_ids: [folder_id] });
    totalBytes = sizeInfo?.[0]?.total_size_bytes ?? 0;
    fileCount = sizeInfo?.[0]?.file_count ?? 0;
  } else if (file_ids) {
    const { data: files } = await svc.from("files").select("size_bytes").eq("conta_id", contaId).in("id", file_ids);
    totalBytes = (files ?? []).reduce((sum: number, f: { size_bytes: number }) => sum + f.size_bytes, 0);
    fileCount = file_ids.length;
  }

  const LIMIT_BYTES = 1024 * 1024 * 1024; // 1 GB
  const LIMIT_FILES = 500;

  if (totalBytes > LIMIT_BYTES || fileCount > LIMIT_FILES) {
    return json({
      error: "zip_limit_exceeded",
      total_bytes: totalBytes,
      file_count: fileCount,
      limit_bytes: LIMIT_BYTES,
      limit_files: LIMIT_FILES,
    }, 413);
  }

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const tokenPayload = {
    conta_id: contaId,
    ...(folder_id ? { folder_id } : { file_ids }),
    expires_at: expiresAt,
  };

  const token = await signZipToken(tokenPayload, ZIP_TOKEN_SECRET);
  const baseUrl = Deno.env.get("SUPABASE_URL")!;
  const downloadUrl = `${baseUrl}/functions/v1/file-zip?token=${encodeURIComponent(token)}`;

  return json({ token, download_url: downloadUrl });
}
```

- [ ] **Step 3: Create the file-zip edge function**

Create `supabase/functions/file-zip/index.ts`:

```typescript
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { getObject } from "../_shared/r2.ts";
import { ZipWriter, BlobReader } from "npm:@zip-js/zip-js@2.7.52";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ZIP_TOKEN_SECRET = Deno.env.get("ZIP_TOKEN_SECRET");

if (!ZIP_TOKEN_SECRET) throw new Error("ZIP_TOKEN_SECRET is required");

async function verifyZipToken(token: string): Promise<Record<string, unknown> | null> {
  try {
    const { payload: payloadStr, sig: sigHex } = JSON.parse(atob(token));
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(ZIP_TOKEN_SECRET!), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)));
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(payloadStr));
    if (!valid) return null;
    const payload = JSON.parse(payloadStr);
    if (payload.expires_at && new Date(payload.expires_at) < new Date()) return null;
    return payload;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return new Response(JSON.stringify({ error: "Missing token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const payload = await verifyZipToken(token);
  if (!payload) {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const contaId = payload.conta_id as string;
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Collect files to zip
  interface ZipEntry { name: string; r2Key: string; path: string }
  const entries: ZipEntry[] = [];

  if (payload.folder_id) {
    const folderId = payload.folder_id as number;

    // Get folder name for the zip file
    const { data: folder } = await svc.from("folders").select("name, conta_id").eq("id", folderId).single();
    if (!folder || folder.conta_id !== contaId) {
      return new Response(JSON.stringify({ error: "Folder not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Recursive walk
    async function walkFolder(fId: number, pathPrefix: string) {
      const { data: files } = await svc.from("files").select("name, r2_key").eq("folder_id", fId).eq("conta_id", contaId);
      for (const f of (files ?? [])) {
        entries.push({ name: f.name, r2Key: f.r2_key, path: pathPrefix + f.name });
      }
      const { data: subs } = await svc.from("folders").select("id, name").eq("parent_id", fId).eq("conta_id", contaId);
      for (const sub of (subs ?? [])) {
        await walkFolder(sub.id, pathPrefix + sub.name + "/");
      }
    }
    await walkFolder(folderId, "");

    const zipFilename = `${folder.name}.zip`;

    // Stream the ZIP via a TransformStream so we don't buffer the entire
    // archive in memory. zip-js writes into the writable side; Deno serves
    // the readable side to the client.
    const { readable, writable } = new TransformStream();
    const zipWriter = new ZipWriter(writable);

    // Run the zip assembly in the background — the response streams as
    // entries are added.
    (async () => {
      for (const entry of entries) {
        try {
          const stream = await getObject(entry.r2Key);
          if (!stream) {
            console.error(`[file-zip] Skipped missing object: ${entry.r2Key}`);
            continue;
          }
          const blob = await new Response(stream).blob();
          await zipWriter.add(entry.path, new BlobReader(blob));
        } catch (err) {
          console.error(`[file-zip] Skipped failed object: ${entry.r2Key}`, err);
        }
      }
      await zipWriter.close();
    })();

    return new Response(readable, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(zipFilename)}"`,
      },
    });
  } else if (payload.file_ids) {
    const fileIds = payload.file_ids as number[];
    const { data: files } = await svc.from("files").select("name, r2_key, conta_id").eq("conta_id", contaId).in("id", fileIds);

    const { readable, writable } = new TransformStream();
    const zipWriter = new ZipWriter(writable);

    (async () => {
      for (const f of (files ?? [])) {
        try {
          const stream = await getObject(f.r2_key);
          if (!stream) continue;
          const blob = await new Response(stream).blob();
          await zipWriter.add(f.name, new BlobReader(blob));
        } catch (err) {
          console.error(`[file-zip] Skipped: ${f.r2_key}`, err);
        }
      }
      await zipWriter.close();
    })();

    return new Response(readable, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="arquivos.zip"`,
      },
    });
  }

  return new Response(JSON.stringify({ error: "Invalid token scope" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
```

- [ ] **Step 4: Add `requestZipToken` to fileService.ts**

```typescript
export async function requestZipToken(
  params: { folder_id: number } | { file_ids: number[] },
): Promise<{ token: string; download_url: string }> {
  return callFn('file-manage', 'POST', params, undefined, '/zip-token');
}
```

- [ ] **Step 5: Build**

Run: `npm run build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/file-manage/handler.ts supabase/functions/file-zip/index.ts supabase/functions/_shared/r2.ts apps/crm/src/services/fileService.ts
git commit -m "feat(arquivos): add ZIP token endpoint and file-zip streaming edge function"
```

---

## Task 16: Wire ZIP download into ArquivosPage

**Files:**
- Modify: `apps/crm/src/pages/arquivos/ArquivosPage.tsx`

- [ ] **Step 1: Add ZIP download mutation**

In `ArquivosPage.tsx`:

```typescript
const zipMutation = useMutation({
  mutationFn: async (params: { folder_id: number } | { file_ids: number[] }) => {
    const result = await requestZipToken(params);
    const a = document.createElement('a');
    a.href = result.download_url;
    a.download = '';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return result;
  },
  retry: 1,
  onError: (err) => {
    if (err.message.includes('zip_limit_exceeded')) {
      toast.error('Pasta muito grande para download ZIP. Selecione menos arquivos.');
    } else {
      toast.error('Erro ao preparar download');
    }
  },
});
```

- [ ] **Step 2: Wire `onZip` in BulkActionBar**

```typescript
onZip={() => {
  const fileIds = [...selection.selectedIds].filter((id) => data?.files.some((f) => f.id === id));
  const folderIds = [...selection.selectedIds].filter((id) => data?.subfolders.some((f) => f.id === id));

  if (folderIds.length === 1 && fileIds.length === 0) {
    // Single folder selected → download the whole folder as zip
    zipMutation.mutate({ folder_id: folderIds[0] });
  } else {
    // Mix of files/folders → download selected files
    // For folders in selection, we'd need to expand them — for simplicity, only zip files
    zipMutation.mutate({ file_ids: fileIds });
  }
}}
```

- [ ] **Step 3: Test manually**

Run: `npm run dev`

1. Select a few files → click "ZIP" → download should start
2. Navigate to a folder, select just that folder → click "ZIP" → ZIP of entire folder downloads
3. Try with a folder exceeding 1GB or 500 files → error toast should appear

- [ ] **Step 4: Build**

Run: `npm run build 2>&1 | tail -5`

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/arquivos/ArquivosPage.tsx
git commit -m "feat(arquivos): wire ZIP download button in bulk action bar"
```

---

## Task 17: Mobile parity — long-press selection + mobile pill bar

**Files:**
- Modify: `apps/crm/src/pages/arquivos/components/MobileArquivosView.tsx`
- Modify: `apps/crm/src/pages/arquivos/ArquivosPage.tsx`

- [ ] **Step 1: Add selection mode to MobileArquivosView**

In `MobileArquivosView.tsx`:

1. Add new props:
   ```typescript
   selectedIds: Set<number>;
   selectionCount: number;
   onToggleSelect: (id: number) => void;
   onClearSelection: () => void;
   onBulkMove: () => void;
   onBulkCopy: () => void;
   onBulkZip: () => void;
   onBulkDelete: () => void;
   isBusy: boolean;
   ```

2. Add long-press detection state:
   ```typescript
   const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
   const isInSelectionMode = selectionCount > 0;
   ```

3. On each file/folder tile, add touch handlers:
   ```typescript
   onTouchStart={(e) => {
     longPressTimer.current = setTimeout(() => {
       onToggleSelect(item.id);
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
   onClick={(e) => {
     if (isInSelectionMode) {
       e.preventDefault();
       onToggleSelect(item.id);
     } else {
       // existing open/navigate behavior
     }
   }}
   ```

4. When in selection mode, replace the header with a selection header:
   ```tsx
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
   ```

5. Add checkboxes on tiles when in selection mode (similar to desktop but always visible).

6. Add mobile pill bar at the bottom when selection mode is active:
   ```tsx
   {isInSelectionMode && (
     <div className="fixed bottom-[80px] left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-2 rounded-full bg-[var(--surface-main)] border border-[var(--border-color)] shadow-lg">
       <span className="text-xs font-bold text-[var(--primary-color)]">{selectionCount}</span>
       <button onClick={onBulkMove} disabled={isBusy} className="text-xs px-2.5 py-1 rounded-full bg-[var(--surface-hover)]">Mover</button>
       <button onClick={onBulkZip} disabled={isBusy} className="text-xs px-2.5 py-1 rounded-full bg-[var(--surface-hover)]">ZIP</button>
       <button onClick={onBulkCopy} disabled={isBusy} className="text-xs px-2.5 py-1 rounded-full bg-[var(--surface-hover)]">Copiar</button>
       <button onClick={onBulkDelete} disabled={isBusy} className="text-xs px-2.5 py-1 rounded-full bg-[rgba(245,90,66,0.15)] text-[var(--danger)]">Excluir</button>
       <button onClick={onClearSelection} className="text-[var(--text-muted)]"><X className="h-3.5 w-3.5" /></button>
     </div>
   )}
   ```

- [ ] **Step 2: Pass selection props from ArquivosPage**

In `ArquivosPage.tsx`, pass all the selection-related props to `<MobileArquivosView>`, wired to the same `useSelection` hook and mutations used by the desktop layout.

- [ ] **Step 3: Add mobile filter (bottom sheet)**

Replace the existing filter pills in `MobileArquivosView` with the new `FilterState`-based filtering from `ArquivosPage`. The filter state is passed as a prop and the mobile view renders filter checkboxes in a bottom sheet (or inline as it already does with pills — adapt the existing pill-based filter to use the `FilterState` object for consistency).

- [ ] **Step 4: Add `isMobile` prop to FileContextMenu**

Pass `isMobile={true}` from `MobileArquivosView` to its `<FileContextMenu>` instances. When `isMobile` is true, hide the "Mover para…" and "Copiar para…" items (they're available from the pill bar instead), and keep using the modal-based rename.

- [ ] **Step 5: Test manually**

Run: `npm run dev` and open browser at mobile viewport (< 900px) or use devtools responsive mode.

1. Long-press a tile → selection mode activates with checkbox and selection header
2. Tap another tile → toggles selection
3. Pill bar appears at bottom → tap "Mover" → picker opens → confirm → items move
4. Tap "Excluir" → confirmation → items deleted
5. Tap X in header → selection clears
6. Scroll while long-pressing → should NOT enter selection mode (touchmove cancels)

- [ ] **Step 6: Build + tests**

Run: `npm run build 2>&1 | tail -5 && npm run test -- --run`

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/arquivos/components/MobileArquivosView.tsx apps/crm/src/pages/arquivos/ArquivosPage.tsx apps/crm/src/pages/arquivos/components/FileContextMenu.tsx
git commit -m "feat(arquivos): add mobile long-press selection mode with pill bar"
```

---

## Task 18: Backend tests for bulk operations + copy

**Files:**
- Create: `supabase/functions/__tests__/file-manage-bulk_test.ts`

- [ ] **Step 1: Write bulk-move tests**

Create `supabase/functions/__tests__/file-manage-bulk_test.ts`:

```typescript
import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createFileManageHandler } from "../file-manage/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>) {
  return createFileManageHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    signUrl: async (key) => `https://signed.example.com/${key}`,
    now: () => "2026-05-01T12:00:00.000Z",
  });
}

function setupAuth(db: ReturnType<typeof createSupabaseQueryMock>, contaId = "conta-1") {
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: contaId }, error: null });
}

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { Authorization: "Bearer valid-jwt" } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  return new Request(`https://example.test/file-manage${path}`, init);
}

// ─── BULK MOVE ──────────────────────────────────────────────

Deno.test("bulk-move: rejects when no items provided", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/bulk-move", { file_ids: [], folder_ids: [] }));
  assertEquals(res.status, 400);
});

Deno.test("bulk-move: calls RPC and returns result", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("rpc:bulk_move_items", "rpc", {
    data: { ok: true, files_moved: 2, folders_moved: 0 },
    error: null,
  });
  db.queue("audit_log", "insert", { data: null, error: null });

  const handler = makeHandler(db);
  const res = await handler(req("POST", "/bulk-move", {
    file_ids: [1, 2],
    folder_ids: [],
    destination_id: 10,
  }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.ok, true);
  assertEquals(body.files_moved, 2);
});

// ─── BULK DELETE ──────────────────────────────────────────────

Deno.test("bulk-delete: returns 409 with blocked items", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);

  // Files query — one has reference_count > 0
  db.queue("files", "select", {
    data: [
      { id: 1, reference_count: 0, size_bytes: 100 },
      { id: 2, reference_count: 3, size_bytes: 200 },
    ],
    error: null,
  });

  const handler = makeHandler(db);
  const res = await handler(req("POST", "/bulk-delete", { file_ids: [1, 2], folder_ids: [] }));
  assertEquals(res.status, 409);
  const body = await readJson(res);
  assertEquals(body.blocked.length, 1);
  assertEquals(body.blocked[0].id, 2);
  assertEquals(body.deletable.file_ids, [1]);
});
```

- [ ] **Step 2: Write copy endpoint tests**

Add to the same file tests for:
- `POST /files/:id/copy`: quota exceeded returns 413; successful copy increments `storage_used_bytes`; response has `reference_count: 0`
- `POST /folders/:id/copy`: limit exceeded (>200 files) returns 413; successful copy returns `{ ok, copied, failed }`

Follow the same mock pattern as the bulk-move/delete tests above.

- [ ] **Step 3: Write ZIP token tests**

Create `supabase/functions/__tests__/file-zip_test.ts` with tests for:
- Valid HMAC token with correct payload verifies successfully
- Expired token returns 401
- `conta_id` mismatch returns 401 even with valid signature
- Cap pre-check during token issuance returns 413 with actual totals when limit exceeded

- [ ] **Step 4: Run the tests**

Run: `deno test supabase/functions/__tests__/file-manage-bulk_test.ts supabase/functions/__tests__/file-zip_test.ts --allow-all`

Expected: Tests pass. (May need to adjust mock queue calls to match the exact query sequence in the handler.)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/__tests__/file-manage-bulk_test.ts supabase/functions/__tests__/file-zip_test.ts
git commit -m "test(arquivos): add backend tests for bulk-move, bulk-delete, copy, and ZIP"
```

---

## Task 19: Final integration test + typecheck

**Files:** None new — verification only.

- [ ] **Step 1: Full typecheck**

Run: `npm run build 2>&1 | tail -10`

Expected: Build succeeds with no type errors.

- [ ] **Step 2: Run all frontend tests**

Run: `npm run test -- --run`

Expected: All tests pass.

- [ ] **Step 3: Run all backend tests**

Run: `deno test supabase/functions/ --allow-all`

Expected: All tests pass.

- [ ] **Step 4: Push migration to staging**

Run: `npx supabase db push --linked`

Expected: Migration applies successfully.

- [ ] **Step 5: Set ZIP_TOKEN_SECRET and deploy edge functions**

Set the new env var on the Supabase project:
```bash
npx supabase secrets set ZIP_TOKEN_SECRET="$(openssl rand -hex 32)"
```

Deploy:
```bash
npx supabase functions deploy file-manage --no-verify-jwt
npx supabase functions deploy file-zip --no-verify-jwt
```

- [ ] **Step 6: Manual smoke test (staging)**

Run through the manual smoke checklist from the spec:

1. Drag a single file from the grid onto a tree node
2. Select 3 items, drag onto a folder card in the grid
3. Drag selection onto a deep tree branch (verify hover-to-expand triggers)
4. Move via picker with one invalid target visible-but-disabled
5. Copy a folder containing subfolders and a video; verify both copies are independent
6. ZIP a folder with ~50 files, ~50 MB — confirm download starts quickly
7. Trigger ZIP cap with a deliberately oversized folder — confirm friendly toast
8. Bulk delete with one file linked to a post — confirm the partial-delete dialog
9. Inline rename via F2 on focused tile, again via double-click on the name label
10. Mobile: long-press → tap to add → mover via picker → confirm
11. Filter: toggle types, navigate to a different folder, verify filter persists

- [ ] **Step 7: Commit any fixes**

If any issues are found during smoke testing, fix and commit.
