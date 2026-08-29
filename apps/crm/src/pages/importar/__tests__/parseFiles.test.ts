import { strToU8, zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';
import { ParseFilesError, parseFiles } from '../parseFiles';

function makeZip(entries: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])));
}

function zipFile(name: string, entries: Record<string, string>): File {
  const bytes = makeZip(entries);
  return new File([bytes], name);
}

describe('parseFiles — duplicate collection ids', () => {
  test('two generic CSVs with the same filename get distinct collection ids and rewritten row keys', async () => {
    const fileA = new File(['Nome\nAna'], 'dados.csv', { type: 'text/csv' });
    const fileB = new File(['Nome\nBia'], 'dados.csv', { type: 'text/csv' });

    const bundle = await parseFiles('csv', [fileA, fileB]);

    expect(bundle.collections).toHaveLength(2);
    const [first, second] = bundle.collections;

    // ids are unique...
    expect(first.id).toBe('dados.csv');
    expect(second.id).toBe('dados.csv (2)');
    expect(first.id).not.toBe(second.id);

    // ...but the human-readable name is untouched for both.
    expect(first.name).toBe('dados');
    expect(second.name).toBe('dados');

    // row keys are rewritten in lockstep so provenance.sourceKey never
    // collides between the two files either.
    expect(first.rows[0].key).toBe('dados.csv:1');
    expect(second.rows[0].key).toBe('dados.csv (2):1');
  });

  test('a file already named like a generated id does not collide with a renamed one', async () => {
    // Counting occurrences of the original id would rename the third file to
    // 'dados.csv (2)' — the literal name the second file already has — and its
    // row keys would collide too, so the commit RPC's idempotency check would
    // treat one file's rows as an already-imported duplicate of the other's.
    const files = [
      new File(['Nome\nAna'], 'dados.csv', { type: 'text/csv' }),
      new File(['Nome\nBia'], 'dados.csv (2)', { type: 'text/csv' }),
      new File(['Nome\nCau'], 'dados.csv', { type: 'text/csv' }),
    ];

    const bundle = await parseFiles('csv', files);
    const ids = bundle.collections.map((c) => c.id);

    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe('dados.csv');
    expect(ids[1]).toBe('dados.csv (2)');
    expect(ids[2]).toBe('dados.csv (3)');

    const keys = bundle.collections.flatMap((c) => c.rows.map((r) => r.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('three same-named files each get their own suffixed id', async () => {
    const files = [
      new File(['Nome\nAna'], 'dados.csv', { type: 'text/csv' }),
      new File(['Nome\nBia'], 'dados.csv', { type: 'text/csv' }),
      new File(['Nome\nCaio'], 'dados.csv', { type: 'text/csv' }),
    ];

    const bundle = await parseFiles('csv', files);

    expect(bundle.collections.map((c) => c.id)).toEqual([
      'dados.csv',
      'dados.csv (2)',
      'dados.csv (3)',
    ]);
  });

  test('distinctly named files keep their own ids untouched', async () => {
    const fileA = new File(['Nome\nAna'], 'clientes.csv', { type: 'text/csv' });
    const fileB = new File(['Nome\nBia'], 'posts.csv', { type: 'text/csv' });

    const bundle = await parseFiles('csv', [fileA, fileB]);

    expect(bundle.collections.map((c) => c.id)).toEqual(['clientes.csv', 'posts.csv']);
  });
});

describe('parseFiles — source/content mismatch sniffing', () => {
  test('trello + zip file suggests Notion', async () => {
    const file = zipFile('export.zip', { 'data.csv': 'Nome\nAna' });
    await expect(parseFiles('trello', [file])).rejects.toThrow(ParseFilesError);
    try {
      await parseFiles('trello', [file]);
    } catch (err) {
      expect((err as ParseFilesError).message).toContain('Notion');
      expect((err as ParseFilesError).message).toContain('.zip');
    }
  });

  test('trello + CSV file suggests Planilha', async () => {
    const file = new File(['Nome\nAna'], 'data.csv');
    await expect(parseFiles('trello', [file])).rejects.toThrow(ParseFilesError);
    try {
      await parseFiles('trello', [file]);
    } catch (err) {
      expect((err as ParseFilesError).message).toContain('Planilha (CSV)');
    }
  });

  test('trello + non-board JSON gives specific "quadro a quadro" message', async () => {
    const file = new File([JSON.stringify({ name: 'Workspace' })], 'workspace.json');
    await expect(parseFiles('trello', [file])).rejects.toThrow(ParseFilesError);
    try {
      await parseFiles('trello', [file]);
    } catch (err) {
      expect((err as ParseFilesError).message).toContain('quadro a quadro');
    }
  });

  test('clickup + .xlsx file tells user to re-export as CSV', async () => {
    const file = zipFile('dados.xlsx', { 'Sheet1.xml': '<xml/>' });
    await expect(parseFiles('clickup', [file])).rejects.toThrow(ParseFilesError);
    try {
      await parseFiles('clickup', [file]);
    } catch (err) {
      expect((err as ParseFilesError).message).toContain('Excel (.xlsx)');
      expect((err as ParseFilesError).message).toContain('CSV');
    }
  });

  test('csv + zip file suggests Notion', async () => {
    const file = zipFile('export.zip', { 'data.csv': 'Nome\nAna' });
    await expect(parseFiles('csv', [file])).rejects.toThrow(ParseFilesError);
    try {
      await parseFiles('csv', [file]);
    } catch (err) {
      expect((err as ParseFilesError).message).toContain('Notion');
    }
  });

  test('clickup + JSON suggests Trello', async () => {
    const file = new File([JSON.stringify({ cards: [] })], 'board.json');
    await expect(parseFiles('clickup', [file])).rejects.toThrow(ParseFilesError);
    try {
      await parseFiles('clickup', [file]);
    } catch (err) {
      expect((err as ParseFilesError).message).toContain('Trello');
    }
  });

  test('csv + valid JSON suggests Trello', async () => {
    const file = new File([JSON.stringify({ cards: [] })], 'board.json');
    await expect(parseFiles('csv', [file])).rejects.toThrow(ParseFilesError);
    try {
      await parseFiles('csv', [file]);
    } catch (err) {
      expect((err as ParseFilesError).message).toContain('Trello');
    }
  });

  test('unreadable file error carries the filename when the parser throws', async () => {
    // Content sniffs as JSON (starts with {) but is not valid JSON, so
    // JSON.parse inside the Trello parser throws a SyntaxError which
    // the catch block maps to the unreadableFile message with filename.
    const file = new File(['{invalid json!!!'], 'corrupto.json');
    await expect(parseFiles('trello', [file])).rejects.toThrow(ParseFilesError);
    try {
      await parseFiles('trello', [file]);
    } catch (err) {
      expect((err as ParseFilesError).message).toContain('corrupto.json');
    }
  });
});

describe('parseFiles — surfaced warnings on 0 rows', () => {
  test('notion markdown-only zip surfaces warnings as details', async () => {
    const file = zipFile('export.zip', {
      'Export/Pagina abc12345678901234567890abcdef01.md': '# just text',
    });
    await expect(parseFiles('notion', [file])).rejects.toThrow(ParseFilesError);
    try {
      await parseFiles('notion', [file]);
    } catch (err) {
      const e = err as ParseFilesError;
      expect(e.message).toBe('Nenhuma tabela foi encontrada nos arquivos enviados.');
      expect(e.details.length).toBeGreaterThan(0);
      expect(e.details[0]).toContain('Markdown & CSV');
    }
  });

  test('header-only CSV falls back to UNREADABLE_MESSAGE', async () => {
    const file = new File(['Nome,Email'], 'vazio.csv');
    await expect(parseFiles('csv', [file])).rejects.toThrow(ParseFilesError);
    try {
      await parseFiles('csv', [file]);
    } catch (err) {
      expect((err as ParseFilesError).message).toContain('Confira o passo a passo');
    }
  });
});
