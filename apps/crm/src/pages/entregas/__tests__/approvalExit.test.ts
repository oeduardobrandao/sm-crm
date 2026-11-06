import { describe, expect, it } from 'vitest';
import {
  fluxoExitOptions,
  fluxoRascunhoBanner,
  postExitOptions,
  postRascunhoBanner,
} from '../approvalExit';
import type { WorkflowEtapa } from '@/store/workflows';
import type { PostProcessStep } from '@/store/postProcesses';

const base = { isLastEtapa: false, temAprovacaoAdiante: false };

describe('fluxoExitOptions', () => {
  it('sem posts só oferece manter', () => {
    const r = fluxoExitOptions({ counts: {}, ...base });
    expect(r.options).toEqual(['manter']);
    expect(r.recommended).toBe('manter');
  });
  it('mockup esquerdo', () => {
    const r = fluxoExitOptions({
      counts: { aprovado_cliente: 5, enviado_cliente: 2, rascunho: 1, agendado: 1 },
      ...base,
    });
    expect(r.options).toEqual(['manter', 'aprovar', 'voltar_rascunho']);
    expect(r.pendentes).toBe(3);
    expect(r.alteraveisRascunho).toBe(7);
    expect(r.recommended).toBe('manter');
  });
  it('mockup direito recomenda voltar_rascunho', () => {
    const r = fluxoExitOptions({
      counts: { aprovado_cliente: 8, agendado: 1 },
      isLastEtapa: false,
      temAprovacaoAdiante: true,
    });
    expect(r.options).toEqual(['manter', 'voltar_rascunho']);
    expect(r.recommended).toBe('voltar_rascunho');
  });
  it('aprovado_interno inclui enviar_portal', () => {
    const r = fluxoExitOptions({ counts: { aprovado_interno: 2 }, ...base });
    expect(r.options).toEqual(['manter', 'aprovar', 'voltar_rascunho', 'enviar_portal']);
    expect(r.aprovadoInterno).toBe(2);
  });
  it('última etapa remove voltar_rascunho', () => {
    const r = fluxoExitOptions({
      counts: { aprovado_cliente: 2 },
      isLastEtapa: true,
      temAprovacaoAdiante: true,
    });
    expect(r.options).toEqual(['manter']);
    expect(r.recommended).toBe('manter');
  });
});

describe('postExitOptions', () => {
  const p = { command: 'avancar' as const, temAprovacaoAdiante: false };
  it('concluir nunca tem voltar_rascunho', () => {
    const r = postExitOptions({ ...p, status: 'aprovado_cliente', command: 'concluir' });
    expect(r.options).not.toContain('voltar_rascunho');
  });
  it('agendado fica locked', () => {
    const r = postExitOptions({ ...p, status: 'agendado' });
    expect(r).toEqual({ options: ['manter'], recommended: 'manter', locked: true });
  });
  it('avançar com aprovado_cliente e aprovação adiante recomenda voltar_rascunho', () => {
    const r = postExitOptions({ ...p, status: 'aprovado_cliente', temAprovacaoAdiante: true });
    expect(r.options).toEqual(['manter', 'voltar_rascunho']);
    expect(r.recommended).toBe('voltar_rascunho');
  });
  it('status pendente oferece aprovar e enviar_portal, salvo sendDisabledReason', () => {
    expect(postExitOptions({ ...p, status: 'aprovado_interno' }).options).toEqual([
      'manter',
      'aprovar',
      'voltar_rascunho',
      'enviar_portal',
    ]);
    expect(
      postExitOptions({ ...p, status: 'aprovado_interno', sendDisabledReason: 'x' }).options,
    ).not.toContain('enviar_portal');
  });
});

const etapa = (
  ordem: number,
  tipo: 'padrao' | 'aprovacao_cliente',
  status: 'pendente' | 'ativo' | 'concluido',
  concluido_em: string | null = null,
): WorkflowEtapa => ({
  workflow_id: 1,
  ordem,
  nome: 'e',
  prazo_dias: 1,
  tipo_prazo: 'uteis',
  tipo,
  status,
  concluido_em,
});
const T1 = '2026-10-20T10:00:00Z';
const T2 = '2026-10-21T10:00:00Z';
const etapas = [
  etapa(0, 'aprovacao_cliente', 'concluido', T1),
  etapa(1, 'padrao', 'ativo'),
  etapa(2, 'aprovacao_cliente', 'pendente'),
];
const fb = (over = {}) =>
  fluxoRascunhoBanner({
    etapas,
    approvedCount: 2,
    dispensadoEm: null,
    workflowStatus: 'ativo',
    ...over,
  });

describe('fluxoRascunhoBanner', () => {
  it('aparece com o ciclo original', () => {
    expect(fb()).toEqual({ show: true, ciclo: T1 });
  });
  it('some com dispensadoEm posterior e volta com ciclo novo', () => {
    expect(fb({ dispensadoEm: T2 })).toEqual({ show: false });
    const novo = [
      etapa(0, 'aprovacao_cliente', 'concluido', T2),
      etapa(1, 'padrao', 'ativo'),
      etapa(2, 'aprovacao_cliente', 'pendente'),
    ];
    expect(fb({ etapas: novo, dispensadoEm: T1 })).toEqual({ show: true, ciclo: T2 });
  });
  it('não aparece com etapa ativa aprovacao_cliente, sem aprovados, sem etapa adiante ou inativo', () => {
    expect(
      fb({
        etapas: [
          etapa(0, 'aprovacao_cliente', 'concluido', T1),
          etapa(1, 'aprovacao_cliente', 'ativo'),
        ],
      }),
    ).toEqual({ show: false });
    expect(fb({ approvedCount: 0 })).toEqual({ show: false });
    expect(fb({ etapas: etapas.slice(0, 2) })).toEqual({ show: false });
    expect(fb({ workflowStatus: 'concluido' })).toEqual({ show: false });
  });
});

describe('postRascunhoBanner', () => {
  const step = (
    ordem: number,
    tipo: 'padrao' | 'aprovacao_cliente',
    estado: string,
    c = null as string | null,
  ) => ({ ordem, tipo, estado, concluido_em: c }) as unknown as PostProcessStep;
  const steps = [
    step(0, 'aprovacao_cliente', 'concluido', T1),
    step(1, 'padrao', 'ativo'),
    step(2, 'aprovacao_cliente', 'pendente'),
  ];
  const pb = (over = {}) =>
    postRascunhoBanner({
      steps,
      estado: 'ativo',
      postStatus: 'aprovado_cliente',
      dispensadoEm: null,
      ...over,
    });
  it('mostra, dispensa e respeita estado e status', () => {
    expect(pb()).toEqual({ show: true, ciclo: T1 });
    expect(pb({ dispensadoEm: T2 })).toEqual({ show: false });
    expect(pb({ estado: 'concluido' })).toEqual({ show: false });
    expect(pb({ postStatus: 'rascunho' })).toEqual({ show: false });
  });

  it('aprovação adiante só conta se estiver pendente (herdado/ignorado não contam)', () => {
    for (const estado of ['herdado', 'ignorado', 'concluido', 'interrompido']) {
      const only = [
        step(0, 'aprovacao_cliente', 'concluido', T1),
        step(1, 'padrao', 'ativo'),
        step(2, 'aprovacao_cliente', estado),
      ];
      expect(pb({ steps: only }), estado).toEqual({ show: false });
    }
  });
  it('devolve o concluido_em cru, sem reserializar (microssegundos)', () => {
    const micro = '2026-10-21T12:00:00.123456+00:00';
    const ss = [
      step(0, 'aprovacao_cliente', 'concluido', micro),
      step(1, 'padrao', 'ativo'),
      step(2, 'aprovacao_cliente', 'pendente'),
    ];
    expect(pb({ steps: ss })).toEqual({ show: true, ciclo: micro });
    expect(
      fb({
        etapas: [
          etapa(0, 'aprovacao_cliente', 'concluido', micro),
          etapa(1, 'padrao', 'ativo'),
          etapa(2, 'aprovacao_cliente', 'pendente'),
        ],
      }),
    ).toEqual({ show: true, ciclo: micro });
  });
});
