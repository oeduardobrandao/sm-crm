import { describe, expect, it } from 'vitest';
import {
  decideApprovalAdvance,
  hasLaterPendingApprovalStep,
  isClientCleared,
} from '../approvalAdvance';

describe('decideApprovalAdvance', () => {
  it('etapa padrão sempre avança, sem re-arm', () => {
    expect(
      decideApprovalAdvance({ tipo: 'padrao', total: 3, cleared: 0, temAprovacaoAdiante: true }),
    ).toEqual({ kind: 'advance', willRearm: false });
    expect(
      decideApprovalAdvance({ tipo: null, total: 0, cleared: 0, temAprovacaoAdiante: false }),
    ).toEqual({ kind: 'advance', willRearm: false });
  });
  it('aprovação com todos liberados avança e informa o re-arm', () => {
    expect(
      decideApprovalAdvance({
        tipo: 'aprovacao_cliente',
        total: 2,
        cleared: 2,
        temAprovacaoAdiante: true,
      }),
    ).toEqual({ kind: 'advance', willRearm: true });
  });
  it('aprovação com pendência (ou sem posts) abre a escolha', () => {
    expect(
      decideApprovalAdvance({
        tipo: 'aprovacao_cliente',
        total: 2,
        cleared: 1,
        temAprovacaoAdiante: false,
      }),
    ).toEqual({ kind: 'choose', willRearm: false });
    // total 0: a regra `total > 0 && cleared === total` dos fluxos fica igual.
    expect(
      decideApprovalAdvance({
        tipo: 'aprovacao_cliente',
        total: 0,
        cleared: 0,
        temAprovacaoAdiante: true,
      }),
    ).toEqual({ kind: 'choose', willRearm: true });
  });
  it('post individual: total 1, cleared 0/1', () => {
    expect(
      decideApprovalAdvance({
        tipo: 'aprovacao_cliente',
        total: 1,
        cleared: 1,
        temAprovacaoAdiante: false,
      }).kind,
    ).toBe('advance');
    expect(
      decideApprovalAdvance({
        tipo: 'aprovacao_cliente',
        total: 1,
        cleared: 0,
        temAprovacaoAdiante: false,
      }).kind,
    ).toBe('choose');
  });
});

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
