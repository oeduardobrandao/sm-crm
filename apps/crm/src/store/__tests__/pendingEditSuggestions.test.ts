import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import {
  __resetSupabaseMock,
  __getSupabaseCalls,
  __queueSupabaseResult,
} from '../../lib/__mocks__/supabase';
import { countPendingEditSuggestionsInWorkflow, hasPendingEditSuggestion } from '../posts';

describe('hasPendingEditSuggestion', () => {
  beforeEach(() => __resetSupabaseMock());

  it('conta só a sugestão pendente do post, sem trazer linhas', async () => {
    __queueSupabaseResult('post_edit_suggestions', 'select', { count: 1 });
    await expect(hasPendingEditSuggestion(42)).resolves.toBe(true);
    const call = __getSupabaseCalls().find((c) => c.table === 'post_edit_suggestions');
    expect(call?.selectArgs[0]).toEqual(['id', { count: 'exact', head: true }]);
    expect(call?.modifiers).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['post_id', 42] },
        { method: 'eq', args: ['status', 'pending'] },
      ]),
    );
  });

  it('é falso quando não há sugestão pendente', async () => {
    __queueSupabaseResult('post_edit_suggestions', 'select', { count: 0 });
    await expect(hasPendingEditSuggestion(42)).resolves.toBe(false);
  });

  it('propaga o erro da leitura', async () => {
    __queueSupabaseResult('post_edit_suggestions', 'select', {
      error: { message: 'boom' },
    });
    await expect(hasPendingEditSuggestion(42)).rejects.toMatchObject({ message: 'boom' });
  });
});

describe('countPendingEditSuggestionsInWorkflow', () => {
  beforeEach(() => __resetSupabaseMock());

  it('conta as pendentes dos posts que o aprovar todos mexe', async () => {
    __queueSupabaseResult('post_edit_suggestions', 'select', { count: 3 });
    await expect(countPendingEditSuggestionsInWorkflow(7)).resolves.toBe(3);
    const call = __getSupabaseCalls().find((c) => c.table === 'post_edit_suggestions');
    expect(call?.selectArgs[0]).toEqual([
      'id, workflow_posts!inner(workflow_id, status)',
      { count: 'exact', head: true },
    ]);
    expect(call?.modifiers).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['status', 'pending'] },
        { method: 'eq', args: ['workflow_posts.workflow_id', 7] },
        {
          method: 'not',
          args: [
            'workflow_posts.status',
            'in',
            '(aprovado_cliente,agendado,postado,falha_publicacao)',
          ],
        },
      ]),
    );
  });

  it('devolve 0 quando a contagem vem vazia', async () => {
    __queueSupabaseResult('post_edit_suggestions', 'select', { count: null });
    await expect(countPendingEditSuggestionsInWorkflow(7)).resolves.toBe(0);
  });
});
