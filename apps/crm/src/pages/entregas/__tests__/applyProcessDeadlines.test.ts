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
    // Sem override do usuário: a chave responsavel_id fica OMITIDA (não
    // null), para que apply_post_process use o próprio fallback dele — ver
    // teste "membro do template já removido" abaixo.
    expect(plan.overrides).toEqual({
      '1': { prazo_efetivo: plan.steps[1].prazoEfetivo },
      '2': { prazo_efetivo: null },
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
    // steps[].responsavelId é só para exibição no diálogo: mostra o
    // responsável do template pré-selecionado mesmo sem override.
    expect(plan.steps[0].responsavelId).toBe(9);
    expect(plan.steps[1].responsavelId).toBe(4);
    // overrides['0'] não tem override do usuário: não força o responsavel_id
    // bruto do template (achado de review, fase 4 final — ver teste abaixo).
    expect(plan.overrides['0'].responsavel_id).toBeUndefined();
    expect(plan.overrides['1'].responsavel_id).toBe(4);
  });
  it('membro do template já removido da equipe: não força responsavel_id, deixa o fallback do RPC decidir', () => {
    // apply_post_process só valida um responsavel_id EXPLÍCITO contra a
    // tabela membros (membro_not_found se não existir mais); ausente a
    // chave, ele mesmo tenta resolver o responsavel_id do template e cai
    // para null se o membro já saiu da conta. Forçar aqui o id bruto do
    // template (9, possivelmente de um membro removido) bloquearia
    // "Aplicar processo" inteiro por uma etapa que o usuário nem tocou.
    const plan = buildApplyPlan({
      template: padrao,
      startOrdem: 0,
      now: NOW,
      fixedDates: {},
      deliveryDate: null,
      clienteHasDiaEntrega: true,
      responsaveis: {},
    });
    expect(plan.overrides['0']).not.toHaveProperty('responsavel_id');
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
      deliveryDate: new Date(2026, 9, 13),
      clienteHasDiaEntrega: true,
      responsaveis: {},
    });
    expect(plan.blockers).toEqual([]);
    // Aprovação (ordem 2) = 13/10; Design (ordem 1) = 13/10 - 1 dia corrido = 12/10;
    // Copy (ordem 0) = 12/10 - 3 dias úteis = 07/10 (segunda 12 -> sex 09, qui 08, qua 07).
    expect(new Date(plan.steps[2].prazoEfetivo!).getDate()).toBe(13);
    expect(new Date(plan.steps[1].prazoEfetivo!).getDate()).toBe(12);
    expect(new Date(plan.steps[0].prazoEfetivo!).getDate()).toBe(7);
    expect(Object.keys(plan.overrides)).toEqual(['0', '1', '2']);
  });
});
