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
