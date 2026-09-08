import { describe, it, expect, vi } from 'vitest';

// Mocked in its own file, not inside convert-hub-pages-richtext.test.ts, so it
// does not affect the other tests there, which need the real `generateJSON`
// to exercise a genuine conversion. Mirrors
// apps/crm/src/pages/cliente-detalhe/hub/__tests__/pageContent.fallback.test.ts,
// which mocks the same module for the same reason.
vi.mock('@tiptap/html', () => ({
  generateJSON: () => {
    throw new Error('simulated generateJSON failure');
  },
}));

import { convert, type PageRow } from '../convert-hub-pages-richtext';

function fakeDb(rows: PageRow[]) {
  const db = {
    updates: [] as { id: string; content: any }[],
    selectPages: async () => rows,
    updateIfUnchanged: async (id: string, _expected: unknown, next: any) => {
      db.updates.push({ id, content: next });
      return { rowsAffected: 1 };
    },
  };
  return db;
}

describe('convert -- readPageDocResult converted:false is a hard failure', () => {
  it('registra em failed e não escreve quando a conversão do markdown falha', async () => {
    const db = fakeDb([{ id: 'p1', content: [{ type: 'markdown', content: '# A' }] }]);
    const r = await convert(db, { dryRun: false });

    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].id).toBe('p1');
    expect(r.converted).toEqual([]);
    expect(r.raced).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(db.updates).toHaveLength(0);
  });

  it('também não escreve em dry-run quando a conversão falha', async () => {
    const db = fakeDb([{ id: 'p1', content: [{ type: 'markdown', content: '# A' }] }]);
    const r = await convert(db, { dryRun: true });

    expect(r.failed).toHaveLength(1);
    expect(r.converted).toEqual([]);
    expect(db.updates).toHaveLength(0);
  });
});
