import { describe, it, expect } from 'vitest';
import { convert, type PageRow } from '../convert-hub-pages-richtext';

function fakeDb(rows: PageRow[]) {
  const db = {
    updates: [] as { id: string; content: any }[],
    onUpdate: undefined as undefined | (() => { rowsAffected: number }),
    selectPages: async () => rows,
    updateIfUnchanged: async (id: string, _expected: unknown, next: any) => {
      const forced = db.onUpdate?.();
      if (forced) return forced;
      db.updates.push({ id, content: next });
      return { rowsAffected: 1 };
    },
  };
  return db;
}

describe('convert', () => {
  it('pula linha que já está em richtext', async () => {
    const db = fakeDb([{ id: 'p1', content: [{ type: 'richtext', doc: {} }] }]);
    const r = await convert(db, { dryRun: false });
    expect(r.skipped).toEqual(['p1']);
    expect(db.updates).toHaveLength(0);
  });

  it('não escreve quando o content mudou entre a leitura e a escrita', async () => {
    const db = fakeDb([{ id: 'p1', content: [{ type: 'markdown', content: '# A' }] }]);
    db.onUpdate = () => ({ rowsAffected: 0 }); // outra escrita ganhou a corrida
    const r = await convert(db, { dryRun: false });
    expect(r.converted).toEqual([]);
    expect(r.raced).toEqual(['p1']);
  });

  it('converte uma linha legada e registra o id', async () => {
    const db = fakeDb([{ id: 'p1', content: [{ type: 'markdown', content: '# A' }] }]);
    const r = await convert(db, { dryRun: false });
    expect(r.converted).toEqual(['p1']);
    expect(db.updates[0].content[0].type).toBe('richtext');
  });

  it('dryRun não escreve nada', async () => {
    const db = fakeDb([{ id: 'p1', content: [{ type: 'markdown', content: '# A' }] }]);
    await convert(db, { dryRun: true });
    expect(db.updates).toHaveLength(0);
  });

  it('pula array vazio e content não-array sem tentar converter', async () => {
    const db = fakeDb([
      { id: 'p-empty', content: [] },
      { id: 'p-null', content: null },
    ]);
    const r = await convert(db, { dryRun: false });
    expect(r.skipped.sort()).toEqual(['p-empty', 'p-null']);
    expect(db.updates).toHaveLength(0);
  });

  it('registra falha e não escreve quando a conversão lança', async () => {
    const db = fakeDb([{ id: 'p1', content: [{ type: 'markdown', content: '# A' }] }]);
    db.updateIfUnchanged = async () => {
      throw new Error('boom');
    };
    const r = await convert(db, { dryRun: false });
    expect(r.failed).toEqual([{ id: 'p1', error: 'boom' }]);
    expect(r.converted).toEqual([]);
    expect(r.raced).toEqual([]);
  });

  it('registra falha (não converte parcial) quando a linha mistura richtext com bloco legado', async () => {
    // isLegacyContent() é true (há um bloco não-richtext), mas readPageDocResult()
    // devolveria só o doc do primeiro bloco richtext, descartando o bloco de
    // markdown em silêncio. Isso tem que virar failed, nunca converted.
    const db = fakeDb([
      {
        id: 'p1',
        content: [
          { type: 'richtext', doc: { type: 'doc', content: [] } },
          { type: 'markdown', content: '# A' },
        ],
      },
    ]);
    const r = await convert(db, { dryRun: false });
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].id).toBe('p1');
    expect(r.converted).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(db.updates).toHaveLength(0);
  });
});
