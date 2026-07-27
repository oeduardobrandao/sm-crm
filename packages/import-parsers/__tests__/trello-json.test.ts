import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseTrelloJson } from '../src/trello-json';

const raw = readFileSync(join(__dirname, 'fixtures', 'trello-board.json'), 'utf8');

describe('parseTrelloJson', () => {
  const col = parseTrelloJson('board.json', raw);

  test('board metadata and open lists only', () => {
    expect(col.name).toBe('Calendário Dra. Marina');
    expect(col.source).toBe('trello');
    expect(col.listNames).toEqual(['Rascunho', 'Aprovado']);
    expect(col.columns).toEqual(['Nome', 'Etiquetas']);
  });

  test('open cards become rows with list, due, desc, checklist, url', () => {
    expect(col.rows).toHaveLength(2); // closed card dropped
    expect(col.rows[0]).toEqual({
      key: 'c1',
      cells: { Nome: 'Post mitos da amamentação', Etiquetas: 'Dra. Marina' },
      listName: 'Rascunho',
      dueDate: '2026-08-03T12:00:00.000Z',
      description: 'Legenda: **mitos** comuns',
      checklist: ['Arte final'],
      sourceUrl: 'https://trello.com/c/abc123',
    });
  });

  test('actions[] content never leaks into the bundle', () => {
    expect(JSON.stringify(col)).not.toContain('should never appear');
  });
});
