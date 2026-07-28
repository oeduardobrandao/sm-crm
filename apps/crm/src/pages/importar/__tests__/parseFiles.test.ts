import { describe, expect, test } from 'vitest';
import { parseFiles } from '../parseFiles';

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
