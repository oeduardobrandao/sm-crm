import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFrom, mockGetUserId } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetUserId: vi.fn(),
}));

vi.mock('../core', () => ({
  supabase: { from: mockFrom },
  getUserId: mockGetUserId,
}));

import {
  importSavedViews,
  listSavedViews,
  removeSavedView,
  renameSavedView,
  reorderSavedViews,
  saveSavedView,
  updateSavedViewQuery,
} from '../savedViews';

type Result = { data?: unknown; error: unknown };

/** A thenable PostgREST builder: every chain method records its call and
 * returns the builder; awaiting it (or `.single()`) resolves to `result`. */
function builder(result: Result = { data: null, error: null }) {
  const calls: [string, unknown[]][] = [];
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'order']) {
    b[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return b;
    };
  }
  b.single = () => {
    calls.push(['single', []]);
    return Promise.resolve(result);
  };
  b.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return { b, calls };
}

describe('store/savedViews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserId.mockResolvedValue('user-1');
  });

  it('lists the workspace rows by position, then creation', async () => {
    const rows = [{ id: 'a', name: 'A', query: 'view=list', position: 0 }];
    const { b, calls } = builder({ data: rows, error: null });
    mockFrom.mockReturnValue(b);

    await expect(listSavedViews('conta-1')).resolves.toEqual(rows);
    expect(mockFrom).toHaveBeenCalledWith('entregas_saved_views');
    expect(calls).toEqual([
      ['select', ['id, name, query, position']],
      ['eq', ['conta_id', 'conta-1']],
      ['order', ['position', { ascending: true }]],
      ['order', ['created_at', { ascending: true }]],
    ]);
  });

  it('throws the list error', async () => {
    mockFrom.mockReturnValue(builder({ data: null, error: { message: 'boom' } }).b);
    await expect(listSavedViews('conta-1')).rejects.toEqual({ message: 'boom' });
  });

  it('saves with an upsert on (user_id, conta_id, name) that replaces the query and position', async () => {
    const row = { id: 'a', name: 'A', query: 'q', position: 3 };
    const { b, calls } = builder({ data: row, error: null });
    mockFrom.mockReturnValue(b);

    await expect(saveSavedView('conta-1', { name: 'A', query: 'q', position: 3 })).resolves.toEqual(
      row,
    );
    expect(calls[0]).toEqual([
      'upsert',
      [
        { conta_id: 'conta-1', user_id: 'user-1', name: 'A', query: 'q', position: 3 },
        { onConflict: 'user_id,conta_id,name' },
      ],
    ]);
    expect(calls.map(([m]) => m)).toEqual(['upsert', 'select', 'single']);
  });

  it('updates the query by id', async () => {
    const { b, calls } = builder();
    mockFrom.mockReturnValue(b);
    await updateSavedViewQuery('a', 'view=chart');
    expect(calls).toEqual([
      ['update', [{ query: 'view=chart' }]],
      ['eq', ['id', 'a']],
    ]);
  });

  it('renames by id; renaming onto another view deletes that one first', async () => {
    const del = builder();
    const upd = builder();
    mockFrom.mockReturnValueOnce(del.b).mockReturnValueOnce(upd.b);

    await renameSavedView('a', 'Alvo', 'b');
    expect(del.calls).toEqual([
      ['delete', []],
      ['eq', ['id', 'b']],
    ]);
    expect(upd.calls).toEqual([
      ['update', [{ name: 'Alvo' }]],
      ['eq', ['id', 'a']],
    ]);
  });

  it('a plain rename sends only the update', async () => {
    const upd = builder();
    mockFrom.mockReturnValue(upd.b);
    await renameSavedView('a', 'Nova', null);
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(upd.calls[0]).toEqual(['update', [{ name: 'Nova' }]]);
  });

  it('does not rename when deleting the replaced view fails', async () => {
    mockFrom.mockReturnValueOnce(builder({ error: { message: 'nope' } }).b);
    await expect(renameSavedView('a', 'Alvo', 'b')).rejects.toEqual({ message: 'nope' });
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('removes by id', async () => {
    const { b, calls } = builder();
    mockFrom.mockReturnValue(b);
    await removeSavedView('a');
    expect(calls).toEqual([
      ['delete', []],
      ['eq', ['id', 'a']],
    ]);
  });

  it('reorders by writing position = index', async () => {
    const one = builder();
    const two = builder();
    mockFrom.mockReturnValueOnce(one.b).mockReturnValueOnce(two.b);
    await reorderSavedViews(['b', 'a']);
    expect(one.calls).toEqual([
      ['update', [{ position: 0 }]],
      ['eq', ['id', 'b']],
    ]);
    expect(two.calls).toEqual([
      ['update', [{ position: 1 }]],
      ['eq', ['id', 'a']],
    ]);
  });

  it('imports with ON CONFLICT DO NOTHING (ignoreDuplicates)', async () => {
    const { b, calls } = builder();
    mockFrom.mockReturnValue(b);
    await importSavedViews('conta-1', [
      { name: 'A', query: 'q1', position: 0 },
      { name: 'B', query: 'q2', position: 1 },
    ]);
    expect(calls).toEqual([
      [
        'upsert',
        [
          [
            { conta_id: 'conta-1', user_id: 'user-1', name: 'A', query: 'q1', position: 0 },
            { conta_id: 'conta-1', user_id: 'user-1', name: 'B', query: 'q2', position: 1 },
          ],
          { onConflict: 'user_id,conta_id,name', ignoreDuplicates: true },
        ],
      ],
    ]);
  });

  it('an empty import sends nothing', async () => {
    await importSavedViews('conta-1', []);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
