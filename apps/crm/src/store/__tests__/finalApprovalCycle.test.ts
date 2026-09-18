import { describe, expect, it } from 'vitest';
import { isFinalClientApprovalCycle, cardAutoScheduleGates } from '../workflows';
import type { WorkflowEtapa } from '../workflows';

// Only `tipo` and `status` matter to the rule; the rest is filler so the
// fixtures are real WorkflowEtapa values instead of casts. `prazo_dias` and
// `tipo_prazo` are NOT optional on the interface (store/workflows.ts:246-247),
// so they have to be here or tsc fails.
const etapa = (
  ordem: number,
  tipo: WorkflowEtapa['tipo'],
  status: WorkflowEtapa['status'],
): WorkflowEtapa => ({
  id: ordem * 10,
  workflow_id: 7,
  nome: `Etapa ${ordem}`,
  ordem,
  prazo_dias: 3,
  tipo_prazo: 'uteis',
  tipo,
  status,
});

describe('isFinalClientApprovalCycle', () => {
  it('is true for a fluxo with no client-approval etapa at all (express, legacy)', () => {
    expect(
      isFinalClientApprovalCycle([etapa(1, 'padrao', 'concluido'), etapa(2, 'padrao', 'ativo')]),
    ).toBe(true);
  });

  it('is true with exactly one open client-approval etapa (the single-approval fluxo)', () => {
    expect(
      isFinalClientApprovalCycle([
        etapa(1, 'padrao', 'concluido'),
        etapa(2, 'aprovacao_cliente', 'ativo'),
      ]),
    ).toBe(true);
  });

  // Mirror of hub-functions_test.ts:851-855: the first approval cycle is done,
  // so the remaining open one IS the final cycle.
  it('is true when an earlier approval etapa is concluido and one remains open', () => {
    expect(
      isFinalClientApprovalCycle([
        etapa(1, 'aprovacao_cliente', 'concluido'),
        etapa(2, 'padrao', 'concluido'),
        etapa(3, 'aprovacao_cliente', 'ativo'),
      ]),
    ).toBe(true);
  });

  // Mirror of hub-functions_test.ts:801-806: TWO open approval etapas means this
  // approval belongs to an earlier cycle. Offering to schedule here is the PR
  // #400 bug (publishes before the second client approval).
  it('is false with two open client-approval etapas (dual approval, first cycle)', () => {
    expect(
      isFinalClientApprovalCycle([
        etapa(1, 'aprovacao_cliente', 'ativo'),
        etapa(2, 'padrao', 'pendente'),
        etapa(3, 'aprovacao_cliente', 'pendente'),
      ]),
    ).toBe(false);
  });

  it('is false with three open client-approval etapas', () => {
    expect(
      isFinalClientApprovalCycle([
        etapa(1, 'aprovacao_cliente', 'ativo'),
        etapa(2, 'aprovacao_cliente', 'pendente'),
        etapa(3, 'aprovacao_cliente', 'pendente'),
      ]),
    ).toBe(false);
  });

  // Fail closed, same as the server: no etapa picture means a later cycle
  // cannot be ruled out. An empty list reaches this helper for a post with no
  // BoardCard (post avulso), which is out of scope for this feature.
  it('is false for an empty etapa list', () => {
    expect(isFinalClientApprovalCycle([])).toBe(false);
  });
});

// Fix F (revisão final): extrai a dupla {autoPublishOnApproval, isFinalApprovalCycle}
// que PostsKanbanView.tsx (x2) e WorkflowDrawer.tsx (x1) montavam à mão de forma
// idêntica a partir do card.
describe('cardAutoScheduleGates', () => {
  const oneOpenApproval = [etapa(1, 'aprovacao_cliente', 'ativo')];
  const twoOpenApprovals = [
    etapa(1, 'aprovacao_cliente', 'ativo'),
    etapa(2, 'aprovacao_cliente', 'pendente'),
  ];

  it('returns both false for a nullish card -- fail closed, same posture as an empty etapa list', () => {
    expect(cardAutoScheduleGates(null)).toEqual({
      autoPublishOnApproval: false,
      isFinalApprovalCycle: false,
    });
    expect(cardAutoScheduleGates(undefined)).toEqual({
      autoPublishOnApproval: false,
      isFinalApprovalCycle: false,
    });
  });

  it('reads auto_publish_on_approval from card.cliente and delegates isFinalApprovalCycle to isFinalClientApprovalCycle', () => {
    expect(
      cardAutoScheduleGates({
        cliente: { auto_publish_on_approval: true },
        allEtapas: oneOpenApproval,
      }),
    ).toEqual({ autoPublishOnApproval: true, isFinalApprovalCycle: true });
  });

  it('is false for autoPublishOnApproval when the client does not auto-publish, independent of the etapas', () => {
    expect(
      cardAutoScheduleGates({
        cliente: { auto_publish_on_approval: false },
        allEtapas: oneOpenApproval,
      }),
    ).toEqual({ autoPublishOnApproval: false, isFinalApprovalCycle: true });
  });

  it('is false for isFinalApprovalCycle in the first cycle of a dual-approval fluxo (PR#400)', () => {
    expect(
      cardAutoScheduleGates({
        cliente: { auto_publish_on_approval: true },
        allEtapas: twoOpenApprovals,
      }),
    ).toEqual({ autoPublishOnApproval: true, isFinalApprovalCycle: false });
  });

  it('treats a missing or null cliente as auto_publish_on_approval false', () => {
    expect(cardAutoScheduleGates({ cliente: undefined, allEtapas: oneOpenApproval })).toEqual({
      autoPublishOnApproval: false,
      isFinalApprovalCycle: true,
    });
    expect(cardAutoScheduleGates({ cliente: null, allEtapas: oneOpenApproval })).toEqual({
      autoPublishOnApproval: false,
      isFinalApprovalCycle: true,
    });
  });
});
