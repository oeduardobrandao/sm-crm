import { describe, expect, it } from 'vitest';

import { shouldAutoCompleteApproval } from '../autoComplete';
import type { WorkflowPost } from '../../../../store';

function post(status: string, id = Math.floor(Math.random() * 1e6)): WorkflowPost {
  return { id, workflow_id: 1, titulo: `Post ${id}`, status, ordem: 0 } as unknown as WorkflowPost;
}

describe('shouldAutoCompleteApproval', () => {
  it('fires when the last post awaiting the client becomes aprovado_cliente', () => {
    const prev = [post('aprovado_cliente', 1), post('enviado_cliente', 2)];
    const next = [post('aprovado_cliente', 1), post('aprovado_cliente', 2)];
    expect(shouldAutoCompleteApproval(prev, next)).toBe(true);
  });

  it('fires when the awaiting post was in correcao_cliente', () => {
    const prev = [post('correcao_cliente', 1)];
    const next = [post('aprovado_cliente', 1)];
    expect(shouldAutoCompleteApproval(prev, next)).toBe(true);
  });

  it('does not fire on first load (no previous snapshot)', () => {
    const next = [post('aprovado_cliente', 1), post('aprovado_cliente', 2)];
    expect(shouldAutoCompleteApproval(null, next)).toBe(false);
  });

  it('does not fire when posts were already all approved in both snapshots', () => {
    const snapshot = [post('aprovado_cliente', 1), post('aprovado_cliente', 2)];
    expect(shouldAutoCompleteApproval(snapshot, snapshot)).toBe(false);
  });

  it('does not fire while any post is still awaiting the client', () => {
    const prev = [post('enviado_cliente', 1), post('enviado_cliente', 2)];
    const next = [post('aprovado_cliente', 1), post('enviado_cliente', 2)];
    expect(shouldAutoCompleteApproval(prev, next)).toBe(false);
  });

  it('does not fire when the awaiting posts left for a non-approved status', () => {
    // e.g. the post was reverted to rascunho rather than approved
    const prev = [post('enviado_cliente', 1)];
    const next = [post('rascunho', 1)];
    expect(shouldAutoCompleteApproval(prev, next)).toBe(false);
  });

  it('does not fire when the workflow has no posts at all', () => {
    expect(shouldAutoCompleteApproval([], [])).toBe(false);
  });
});
