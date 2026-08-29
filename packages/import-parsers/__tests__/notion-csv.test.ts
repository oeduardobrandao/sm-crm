import { strToU8, zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';
import { parseNotionExport } from '../src/notion-csv';

// fflate's strToU8 goes through a module-level TextEncoder singleton, whose
// output Uint8Array can belong to a different realm than the one active in
// this test file under Vitest's jsdom environment (each jsdom test file gets
// its own vm-context intrinsics). Re-wrapping in a Uint8Array constructed in
// this realm matches what happens in production, where bytes come from
// `File.arrayBuffer()` -> `new Uint8Array(buffer)` in the browser (already
// realm-correct) — so this wrap is the honest fix, not a workaround.
const u = (s: string) => new Uint8Array(strToU8(s));

function makeZip(entries: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, u(v)])));
}

describe('parseNotionExport', () => {
  test('extracts each csv as a collection, strips the notion hash, prefers _all.csv', () => {
    const zip = makeZip({
      'Export/Calendário 0a1b2c3d4e5f60718293a4b5c6d7e8f9.csv': 'Name,Data\nPost A,2026-08-01',
      'Export/Calendário 0a1b2c3d4e5f60718293a4b5c6d7e8f9_all.csv':
        'Name,Data\nPost A,2026-08-01\nPost B,2026-08-02',
      'Export/Página solta 99998888777766665555444433332222.md': '# ignora',
    });
    const { collections, warnings } = parseNotionExport('export.zip', zip);
    expect(warnings).toEqual([]);
    expect(collections).toHaveLength(1);
    expect(collections[0].name).toBe('Calendário');
    expect(collections[0].source).toBe('notion');
    expect(collections[0].rows).toHaveLength(2);
  });

  test('accepts a bare csv file', () => {
    const { collections } = parseNotionExport(
      'Clientes 0a1b2c3d4e5f60718293a4b5c6d7e8f9.csv',
      u('Nome,Email\nAna,a@x.com'),
    );
    expect(collections[0].name).toBe('Clientes');
    expect(collections[0].rows).toHaveLength(1);
  });

  test('zip with only markdown files warns about missing CSV databases', () => {
    const zip = makeZip({
      'Export/Página do cliente abc123def456789012345678abcdef01.md': '# Cliente A',
      'Export/Notas 11112222333344445555666677778888.md': '# Notas',
    });
    const { collections, warnings } = parseNotionExport('export.zip', zip);
    expect(collections).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Markdown & CSV');
    expect(warnings[0]).toContain('Incluir subpáginas');
  });

  test('rejects zip expanding beyond the cap', () => {
    const big = 'A,B\n' + '1,2\n'.repeat(400);
    const zip = makeZip({ 'x.csv': big });
    const { warnings } = parseNotionExport('export.zip', zip, /* maxBytes */ 100);
    expect(warnings.some((w) => w.includes('grande'))).toBe(true);
  });

  test('two distinct databases sharing a title both survive, with distinct names and rows', () => {
    const zip = makeZip({
      'Export/Tarefas 11112222333344445555666677778888.csv':
        'Nome,Data\nTarefa Cliente A,2026-08-01',
      'Export/Cliente A/Tarefas aaaabbbbccccddddeeeeffff00001111.csv':
        'Nome,Data\nTarefa Cliente B,2026-08-02',
    });
    const { collections, warnings } = parseNotionExport('export.zip', zip);
    expect(warnings).toEqual([]);
    expect(collections).toHaveLength(2);
    const names = collections.map((c) => c.name).sort();
    expect(names).toEqual(['Tarefas', 'Tarefas (2)']);
    // each keeps its own row — no cross-contamination / silent overwrite
    const allRows = collections.flatMap((c) => c.rows.map((r) => r.cells.Nome));
    expect(allRows).toContain('Tarefa Cliente A');
    expect(allRows).toContain('Tarefa Cliente B');
  });

  test('_all.csv preference wins within one database regardless of entry order (all-then-plain)', () => {
    const zip = makeZip({
      'Export/Calendário 0a1b2c3d4e5f60718293a4b5c6d7e8f9_all.csv':
        'Name,Data\nPost A,2026-08-01\nPost B,2026-08-02',
      'Export/Calendário 0a1b2c3d4e5f60718293a4b5c6d7e8f9.csv': 'Name,Data\nPost A,2026-08-01',
    });
    const { collections, warnings } = parseNotionExport('export.zip', zip);
    expect(warnings).toEqual([]);
    expect(collections).toHaveLength(1);
    expect(collections[0].name).toBe('Calendário');
    expect(collections[0].rows).toHaveLength(2);
  });

  test('non-csv entries (e.g. large attachments) do not count against the size cap', () => {
    const bigAttachment = 'x'.repeat(5000);
    const zip = makeZip({
      'Export/imagem-grande.png': bigAttachment,
      'Export/Notas.md': bigAttachment,
      'Export/Clientes 0a1b2c3d4e5f60718293a4b5c6d7e8f9.csv': 'Nome,Email\nAna,a@x.com',
    });
    const { collections, warnings } = parseNotionExport('export.zip', zip, /* maxBytes */ 200);
    expect(warnings).toEqual([]);
    expect(collections).toHaveLength(1);
    expect(collections[0].rows).toHaveLength(1);
  });

  test('zip whose actual decompressed csv content exceeds the cap: no collections, warning names what was dropped', () => {
    const big = 'A,B\n' + '1,2\n'.repeat(400);
    const zip = makeZip({ 'Export/Calendário 0a1b2c3d4e5f60718293a4b5c6d7e8f9.csv': big });
    const { collections, warnings } = parseNotionExport('export.zip', zip, /* maxBytes */ 100);
    expect(collections).toHaveLength(0);
    expect(warnings.some((w) => w.includes('grande') && w.includes('Calendário'))).toBe(true);
  });

  test('a single entry whose declared size alone exceeds the cap is rejected before decompression: warning, no collections', () => {
    const big = 'A,B\n' + '1,2\n'.repeat(400);
    const zip = makeZip({ 'Export/Grande 0a1b2c3d4e5f60718293a4b5c6d7e8f9.csv': big });
    // maxBytes far below the declared size of this single entry — the
    // per-entry guard must reject it on its own, without needing any other
    // entry to push a running total over the cap.
    const { collections, warnings } = parseNotionExport('export.zip', zip, /* maxBytes */ 50);
    expect(collections).toHaveLength(0);
    expect(warnings.some((w) => w.includes('grande'))).toBe(true);
  });
});
