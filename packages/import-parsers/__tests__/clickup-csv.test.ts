import { describe, expect, test } from 'vitest';
import { parseClickupCsv } from '../src/clickup-csv';

const CSV = [
  'Task ID,Task Name,Status,Due Date,List Name,Task Content,Assignee',
  '86abc1,Post lançamento,em revisão,1754179200000,Calendário,Texto do post,Ana',
  '86abc2,Reels dicas,aprovado,,Calendário,,Bia',
].join('\n');

describe('parseClickupCsv', () => {
  const col = parseClickupCsv('tasks.csv', CSV);

  test('maps clickup columns onto row fields', () => {
    expect(col.source).toBe('clickup');
    expect(col.listNames).toEqual(['em revisão', 'aprovado']);
    expect(col.rows[0]).toMatchObject({
      key: '86abc1',
      listName: 'em revisão',
      dueDate: new Date(1754179200000).toISOString(),
      description: 'Texto do post',
    });
    expect(col.rows[0].cells).toMatchObject({ 'Task Name': 'Post lançamento', Assignee: 'Ana' });
    expect(col.rows[1].dueDate).toBeNull();
  });

  test('a duplicate "Status" custom field does not collide with the kanban status column', () => {
    const csv = [
      'Task ID,Status,Due Date,Task Content,Status',
      '86abc1,em andamento,,Texto,custom-value',
    ].join('\n');
    const result = parseClickupCsv('dup-status.csv', csv);
    expect(result.rows[0].listName).toBe('em andamento');
    expect(result.columns).toEqual(['Status (2)']);
    expect(result.rows[0].cells).toMatchObject({ 'Status (2)': 'custom-value' });
    expect(result.rows[0].cells['Status']).toBeUndefined();
  });

  test('a data row with more fields than the header preserves the overflow value', () => {
    const csv = ['Task ID,Status', '1,open,extra1,extra2'].join('\n');
    const result = parseClickupCsv('overflow.csv', csv);
    expect(result.columns).toEqual(['Coluna 3', 'Coluna 4']);
    expect(result.rows[0].cells).toEqual({ 'Coluna 3': 'extra1', 'Coluna 4': 'extra2' });
  });

  test('a Due Date holding an ISO date string parses to a valid ISO timestamp', () => {
    const csv = ['Task ID,Due Date', '1,2026-08-03'].join('\n');
    const result = parseClickupCsv('iso-date.csv', csv);
    expect(result.rows[0].dueDate).toBe(new Date('2026-08-03').toISOString());
  });

  test('a Due Date holding unparseable text yields null', () => {
    const csv = ['Task ID,Due Date', '1,not-a-real-date'].join('\n');
    const result = parseClickupCsv('bad-date.csv', csv);
    expect(result.rows[0].dueDate).toBeNull();
  });

  // `new Date('2026-02-31')` silently normalizes to 2026-03-03 instead of
  // failing -- an invalid Due Date cell must not become a real, wrong
  // deadline. Same hazard, same fix as apps/crm's buildCommitRows.ts.
  test.each(['2026-02-31', '2026-04-31', '2026-02-29'])(
    'a Due Date holding the calendar-invalid ISO date %s yields null',
    (due) => {
      const csv = ['Task ID,Due Date', `1,${due}`].join('\n');
      const result = parseClickupCsv('calendar-invalid.csv', csv);
      expect(result.rows[0].dueDate).toBeNull();
    },
  );

  test('a Due Date holding a real leap day (2028-02-29) parses to a valid ISO timestamp', () => {
    const csv = ['Task ID,Due Date', '1,2028-02-29'].join('\n');
    const result = parseClickupCsv('leap-day.csv', csv);
    expect(result.rows[0].dueDate).toBe(new Date('2028-02-29').toISOString());
  });

  test('a Due Date holding a valid full ISO timestamp parses through', () => {
    const csv = ['Task ID,Due Date', '1,2026-08-03T12:00:00Z'].join('\n');
    const result = parseClickupCsv('full-timestamp.csv', csv);
    expect(result.rows[0].dueDate).toBe(new Date('2026-08-03T12:00:00Z').toISOString());
  });

  test('a Due Date holding a calendar-invalid full ISO timestamp yields null', () => {
    const csv = ['Task ID,Due Date', '1,2026-02-31T12:00:00Z'].join('\n');
    const result = parseClickupCsv('bad-full-timestamp.csv', csv);
    expect(result.rows[0].dueDate).toBeNull();
  });

  test('a Due Date holding epoch milliseconds still parses unchanged (not routed through calendar validation)', () => {
    // 13-digit epoch ms for 2026-08-03T00:00:00.000Z; must NOT be treated as
    // ISO-shaped text (it isn't) and must still resolve via `new Date(n)`.
    const csv = ['Task ID,Due Date', '1,1785715200000'].join('\n');
    const result = parseClickupCsv('epoch.csv', csv);
    expect(result.rows[0].dueDate).toBe(new Date(1785715200000).toISOString());
  });

  test('a CSV with no Task ID column falls back to fileName:n keys', () => {
    const csv = ['Status,Due Date,Task Content', 'aprovado,,Texto 1', 'aprovado,,Texto 2'].join(
      '\n',
    );
    const result = parseClickupCsv('no-task-id.csv', csv);
    expect(result.rows[0].key).toBe('no-task-id.csv:1');
    expect(result.rows[1].key).toBe('no-task-id.csv:2');
  });

  test('rows sharing the same status contribute it once to listNames', () => {
    const csv = ['Task ID,Status', '86abc1,aprovado', '86abc2,aprovado', '86abc3,em revisão'].join(
      '\n',
    );
    const result = parseClickupCsv('shared-status.csv', csv);
    expect(result.listNames).toEqual(['aprovado', 'em revisão']);
  });
});
