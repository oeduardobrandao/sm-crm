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

  test('rejects zip expanding beyond the cap', () => {
    const big = 'A,B\n' + '1,2\n'.repeat(400);
    const zip = makeZip({ 'x.csv': big });
    const { warnings } = parseNotionExport('export.zip', zip, /* maxBytes */ 100);
    expect(warnings.some((w) => w.includes('grande'))).toBe(true);
  });
});
