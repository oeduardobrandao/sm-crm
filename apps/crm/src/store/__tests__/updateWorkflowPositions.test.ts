import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import {
  __resetSupabaseMock,
  __getSupabaseCalls,
  __queueSupabaseRpc,
} from '../../lib/__mocks__/supabase';
import { updateWorkflowPositions } from '../workflows';

describe('updateWorkflowPositions', () => {
  beforeEach(() => {
    __resetSupabaseMock();
  });

  it('grava o lote inteiro numa única RPC', async () => {
    __queueSupabaseRpc('reorder_workflow_positions', { data: null });
    await updateWorkflowPositions([
      { id: 30, position: 0 },
      { id: 10, position: 1 },
      { id: 20, position: 2 },
    ]);
    const calls = __getSupabaseCalls();
    expect(calls).toHaveLength(1);
    expect(calls.some((c) => c.table === 'workflows')).toBe(false);
    const rpcCall = calls.find((c) => c.table === 'rpc:reorder_workflow_positions');
    expect(rpcCall).toBeDefined();
    expect(rpcCall?.payload).toEqual({
      p_workflow_ids: [30, 10, 20],
      p_positions: [0, 1, 2],
    });
  });

  it('propaga o erro da RPC', async () => {
    __queueSupabaseRpc('reorder_workflow_positions', {
      error: { message: 'workflow_not_found' },
    });
    await expect(updateWorkflowPositions([{ id: 1, position: 0 }])).rejects.toMatchObject({
      message: 'workflow_not_found',
    });
  });

  it('não chama nada com lista vazia', async () => {
    await updateWorkflowPositions([]);
    const calls = __getSupabaseCalls();
    const rpcCall = calls.find((c) => c.table === 'rpc:reorder_workflow_positions');
    expect(rpcCall).toBeUndefined();
  });
});
