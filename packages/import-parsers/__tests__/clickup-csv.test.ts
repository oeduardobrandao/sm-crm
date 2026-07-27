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
});
