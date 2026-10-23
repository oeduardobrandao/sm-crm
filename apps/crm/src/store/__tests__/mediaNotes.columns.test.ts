import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import { NOTE_COLUMNS, REPLY_COLUMNS } from '../mediaNotes';

// The CRM reads these relations with explicit column lists, and a wrong name there is
// a 42703 the drawers would surface only in production. Pin every name to the migration.
const MIGRATION = readFileSync(
  path.resolve(__dirname, '../../../../../supabase/migrations/20261025000001_post_media_notes.sql'),
  'utf8',
);

function tableColumns(table: string): string[] {
  const body = MIGRATION.match(new RegExp(`CREATE TABLE ${table} \\(\\n([\\s\\S]*?)\\n\\);`))?.[1];
  if (!body) throw new Error(`CREATE TABLE ${table} not found`);
  // Column definitions sit at exactly two spaces; constraint continuations are deeper.
  return body
    .split('\n')
    .filter((l) => /^ {2}[a-z_]+\s/.test(l))
    .map((l) => l.trim().split(/\s+/)[0]);
}

function viewColumns(): string[] {
  const select = MIGRATION.match(
    /CREATE VIEW post_media_notes_v[\s\S]*?SELECT\n([\s\S]*?)\nFROM post_media_notes n/,
  )?.[1];
  if (!select) throw new Error('CREATE VIEW post_media_notes_v not found');
  return select
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.match(/\bAS\s+(\w+)$/i)?.[1] ?? item.replace(/^n\./, ''));
}

const list = (columns: string) => columns.split(',').map((c) => c.trim());

describe('media-note column lists match the migration', () => {
  it('NOTE_COLUMNS are all view columns, and none is hub_token', () => {
    const view = viewColumns();
    expect(view).not.toContain('hub_token');
    expect(list(NOTE_COLUMNS).filter((c) => !view.includes(c))).toEqual([]);
  });

  it('REPLY_COLUMNS are all reply-table columns, and none is hub_token', () => {
    const replies = tableColumns('post_media_note_replies');
    expect(list(REPLY_COLUMNS)).not.toContain('hub_token');
    expect(list(REPLY_COLUMNS).filter((c) => !replies.includes(c))).toEqual([]);
  });

  it('the getPostApprovals embed reads a real join-table column', () => {
    const posts = readFileSync(path.resolve(__dirname, '../posts.ts'), 'utf8');
    const embedded = [...posts.matchAll(/post_approval_media_notes\(([^)]*)\)/g)].flatMap((m) =>
      list(m[1]),
    );
    expect(embedded.length).toBeGreaterThan(0);
    const join = tableColumns('post_approval_media_notes');
    expect(embedded.filter((c) => !join.includes(c))).toEqual([]);
  });
});
