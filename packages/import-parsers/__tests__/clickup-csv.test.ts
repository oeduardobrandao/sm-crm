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
