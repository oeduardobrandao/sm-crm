import { describe, expect, it } from 'vitest';
import { buildApplyPlan } from '../applyProcessDeadlines';
import type { WorkflowTemplate } from '../../../store';

const NOW = new Date(2026, 8, 14, 10, 0); // segunda-feira 14/09/2026 10:00 local

const padrao: WorkflowTemplate = {
  id: 3,
  nome: 'Redes',
  modo_prazo: 'padrao',
  etapas: [
    { nome: 'Copy', prazo_dias: 2, tipo_prazo: 'corridos', tipo: 'padrao', responsavel_id: 9 },
    { nome: 'Design', prazo_dias: 3, tipo_prazo: 'uteis', tipo: 'padrao' },
    { nome: 'Aprovação', prazo_dias: 1, tipo_prazo: 'corridos', tipo: 'aprovacao_cliente' },
  ],
};

describe('buildApplyPlan padrao', () => {
  it('só a etapa inicial recebe prazo (calculado de agora); anteriores ignoradas; responsável do template', () => {
    const plan = buildApplyPlan({
      template: padrao,
      startOrdem: 1,
      now: NOW,
      fixedDates: {},
      deliveryDate: null,
      clienteHasDiaEntrega: true,
      responsaveis: {},
    });
    expect(plan.blockers).toEqual([]);
    expect(plan.steps.map((s) => s.estado)).toEqual(['ignorado', 'ativo', 'pendente']);
    // 3 dias úteis a partir de segunda 14/09 = quinta 17/09
    expect(new Date(plan.steps[1].prazoEfetivo!).getDate()).toBe(17);
    expect(plan.steps[2].prazoEfetivo).toBeNull();
    expect(plan.overrides).toEqual({
      '1': { responsavel_id: null, prazo_efetivo: plan.steps[1].prazoEfetivo },
      '2': { responsavel_id: null, prazo_efetivo: null },
    });
    expect(plan.overrides['0']).toBeUndefined();
  });
  it('responsável do template e override do usuário', () => {
    const plan = buildApplyPlan({
      template: padrao,
      startOrdem: 0,
      now: NOW,
      fixedDates: {},
      deliveryDate: null,
      clienteHasDiaEntrega: true,
      responsaveis: { 1: 4 },
    });
    expect(plan.steps[0].responsavelId).toBe(9);
    expect(plan.steps[1].responsavelId).toBe(4);
    expect(plan.overrides['0'].responsavel_id).toBe(9);
    expect(plan.overrides['1'].responsavel_id).toBe(4);
  });
  it('template vazio e etapa inicial fora do intervalo são bloqueios', () => {
    expect(
      buildApplyPlan({
        template: { ...padrao, etapas: [] },
        startOrdem: 0,
        now: NOW,
        fixedDates: {},
        deliveryDate: null,
        clienteHasDiaEntrega: true,
        responsaveis: {},
      }).blockers,
    ).toContain('Este modelo não tem etapas.');
    expect(
      buildApplyPlan({
        template: padrao,
        startOrdem: 5,
        now: NOW,
        fixedDates: {},
        deliveryDate: null,
        clienteHasDiaEntrega: true,
        responsaveis: {},
      }).blockers,
    ).toContain('Escolha a etapa inicial.');
  });
});

describe('buildApplyPlan data_fixa', () => {
  const tpl: WorkflowTemplate = { ...padrao, modo_prazo: 'data_fixa' };
  it('exige data por etapa a partir da inicial e grava fim do dia local', () => {
    const missing = buildApplyPlan({
      template: tpl,
      startOrdem: 1,
      now: NOW,
      fixedDates: { 1: '2026-09-20' },
      deliveryDate: null,
      clienteHasDiaEntrega: true,
      responsaveis: {},
    });
    expect(missing.blockers).toEqual(['Informe a data da etapa "Aprovação".']);
    const ok = buildApplyPlan({
      template: tpl,
      startOrdem: 1,
      now: NOW,
      fixedDates: { 1: '2026-09-20', 2: '2026-09-22' },
      deliveryDate: null,
      clienteHasDiaEntrega: true,
      responsaveis: {},
    });
    expect(ok.blockers).toEqual([]);
    const d = new Date(ok.steps[1].prazoEfetivo!);
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([20, 23, 59]);
    expect(ok.overrides['2'].prazo_efetivo).toBe(
      new Date(2026, 8, 22, 23, 59, 59, 999).toISOString(),
    );
  });
});

describe('buildApplyPlan data_entrega', () => {
  const tpl: WorkflowTemplate = { ...padrao, modo_prazo: 'data_entrega' };
  it('bloqueia sem dia de entrega, sem mês e sem aprovação a partir da inicial', () => {
    expect(
      buildApplyPlan({
        template: tpl,
        startOrdem: 0,
        now: NOW,
        fixedDates: {},
        deliveryDate: null,
        clienteHasDiaEntrega: false,
        responsaveis: {},
      }).blockers,
    ).toContain('O cliente não tem dia de entrega configurado.');
    expect(
      buildApplyPlan({
        template: tpl,
        startOrdem: 0,
        now: NOW,
        fixedDates: {},
        deliveryDate: null,
        clienteHasDiaEntrega: true,
        responsaveis: {},
      }).blockers,
    ).toContain('Escolha o mês de entrega.');
    const noApproval = buildApplyPlan({
      template: { ...tpl, etapas: tpl.etapas.slice(0, 2) },
      startOrdem: 0,
      now: NOW,
      fixedDates: {},
      deliveryDate: new Date(2026, 9, 10),
      clienteHasDiaEntrega: true,
      responsaveis: {},
    });
    expect(noApproval.needsApprovalStep).toBe(true);
    expect(noApproval.blockers).toContain(
      'O modelo precisa de uma etapa de aprovação do cliente a partir da etapa inicial.',
    );
  });
  it('materializa todas as etapas a partir da inicial ancoradas na data de entrega', () => {
    const plan = buildApplyPlan({
      template: tpl,
      startOrdem: 0,
      now: NOW,
      fixedDates: {},
      deliveryDate: new Date(2026, 9, 10),
      clienteHasDiaEntrega: true,
      responsaveis: {},
    });
    expect(plan.blockers).toEqual([]);
    // Aprovação (ordem 2) = 10/10; Design (ordem 1) = 10/10 - 1 dia corrido da aprovação = 09/10;
    // Copy (ordem 0) = 09/10 - 3 dias úteis do Design = 06/10 (sexta 09 -> qui 08, qua 07, ter 06).
    expect(new Date(plan.steps[2].prazoEfetivo!).getDate()).toBe(10);
    expect(new Date(plan.steps[1].prazoEfetivo!).getDate()).toBe(9);
    expect(new Date(plan.steps[0].prazoEfetivo!).getDate()).toBe(6);
    expect(Object.keys(plan.overrides)).toEqual(['0', '1', '2']);
  });
});
