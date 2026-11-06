import { describe, expect, it } from 'vitest';
import { hasLaterPendingApprovalStep, isClientCleared } from '../approvalAdvance';

describe('isClientCleared', () => {
  it('é a mesma lista de CLIENT_CLEARED_STATUSES', () => {
    for (const s of ['aprovado_cliente', 'agendado', 'postado', 'falha_publicacao'])
      expect(isClientCleared(s)).toBe(true);
    for (const s of [
      'rascunho',
      'aprovado_interno',
      'enviado_cliente',
      'correcao_cliente',
      null,
      undefined,
    ])
      expect(isClientCleared(s)).toBe(false);
  });
});

describe('hasLaterPendingApprovalStep', () => {
  const steps = [
    { ordem: 0, tipo: 'padrao', estado: 'concluido' },
    { ordem: 1, tipo: 'aprovacao_cliente', estado: 'ativo' },
    { ordem: 2, tipo: 'aprovacao_cliente', estado: 'herdado' },
    { ordem: 3, tipo: 'aprovacao_cliente', estado: 'pendente' },
  ];
  it('só conta aprovações PENDENTES com ordem maior', () => {
    expect(hasLaterPendingApprovalStep(steps, 1)).toBe(true);
    expect(
      hasLaterPendingApprovalStep(
        steps.filter((s) => s.ordem !== 3),
        1,
      ),
    ).toBe(false);
    expect(hasLaterPendingApprovalStep(steps, 3)).toBe(false);
  });
});
