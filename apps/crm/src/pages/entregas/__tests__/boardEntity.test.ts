import { describe, expect, it } from 'vitest';
import {
  entityNumericId,
  isPostEntity,
  sortEntitiesByPosicao,
  sortEntitiesByPrazo,
  stageSignature,
  toPostEntity,
  toWorkflowEntity,
} from '../boardEntity';
import type { BoardCard } from '../hooks/useEntregasData';
import type { PostProcessStep, PostProcessWithPost } from '../../../store';

function makeCard(opts: {
  id: number;
  position?: number;
  ativa?: number;
  data_limite?: string | null;
}): BoardCard {
  const etapas = [
    {
      id: 1,
      workflow_id: opts.id,
      ordem: 0,
      nome: 'Copy',
      tipo: 'padrao' as const,
      prazo_dias: 1,
      tipo_prazo: 'corridos' as const,
      status: 'concluido' as const,
    },
    {
      id: 2,
      workflow_id: opts.id,
      ordem: 1,
      nome: 'Design',
      tipo: 'padrao' as const,
      prazo_dias: 2,
      tipo_prazo: 'corridos' as const,
      status: 'ativo' as const,
      data_limite: opts.data_limite ?? null,
      responsavel_id: 7,
    },
  ];
  const etapa = etapas[opts.ativa ?? 1];
  return {
    workflow: {
      id: opts.id,
      cliente_id: 3,
      titulo: `WF ${opts.id}`,
      status: 'ativo',
      etapa_atual: 1,
      recorrente: false,
      template_id: 5,
      position: opts.position ?? 0,
    },
    etapa,
    cliente: { id: 3, nome: 'Aurora', cor: '#000' } as never,
    membro: { id: 7, nome: 'Ana' } as never,
    deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
    totalEtapas: 2,
    etapaIdx: etapa.ordem,
    allEtapas: etapas,
  } as unknown as BoardCard;
}

function step(p: Partial<PostProcessStep> & { ordem: number; nome: string }): PostProcessStep {
  return {
    id: 100 + p.ordem,
    conta_id: 'c',
    process_id: 9,
    tipo: 'padrao',
    responsavel_id: null,
    prazo_dias: null,
    tipo_prazo: null,
    prazo_efetivo: null,
    estado: 'pendente',
    iniciado_em: null,
    concluido_em: null,
    interrompido_em: null,
    origem_etapa_ordem: null,
    origem_etapa_nome: null,
    ...p,
  };
}

function makeProcess(opts: {
  id?: number;
  board_position?: number;
  steps?: PostProcessStep[];
  etapa_atual?: number;
}): PostProcessWithPost {
  return {
    id: opts.id ?? 9,
    conta_id: 'c',
    post_id: 77,
    template_id: 5,
    template_nome: 'Redes',
    assinatura: '',
    origem_workflow_id: null,
    origem_descricao: null,
    estado: 'ativo',
    motivo_encerramento: null,
    etapa_atual: opts.etapa_atual ?? 1,
    modo_prazo: 'padrao',
    board_position: opts.board_position ?? 0,
    revisao: 1,
    created_by: null,
    created_at: '2026-09-10T00:00:00Z',
    updated_at: '2026-09-10T00:00:00Z',
    concluido_em: null,
    steps: opts.steps ?? [
      step({ ordem: 0, nome: 'Copy', estado: 'ignorado' }),
      step({
        ordem: 1,
        nome: 'Design',
        estado: 'ativo',
        responsavel_id: 7,
        prazo_efetivo: '2026-07-20T15:00:00.000Z',
        iniciado_em: '2026-07-18T10:00:00Z',
      }),
    ],
    post: {
      id: 77,
      workflow_id: null,
      cliente_id: 3,
      cliente_nome: 'Aurora',
      workflow_titulo: null,
      titulo: 'Post X',
      tipo: 'feed',
      status: 'rascunho',
      custom_status_id: null,
      scheduled_at: null,
      published_at: null,
      ig_caption: null,
      instagram_permalink: null,
      publish_error: null,
      publish_error_code: null,
      ordem: 0,
      responsavel_id: null,
      platform: 'instagram',
      tiktok_publish_status: null,
      tiktok_publish_error: null,
      tiktok_post_url: null,
      instagram_media_id: null,
      ig_trial_strategy: null,
      board_ordem: null,
    },
  };
}

const ctx = {
  clientes: [{ id: 3, nome: 'Aurora', cor: '#000' } as never],
  membros: [{ id: 7, nome: 'Ana' } as never],
};

describe('stageSignature', () => {
  it('ordena por ordem e serializa (ordem, nome, tipo)', () => {
    expect(
      stageSignature([
        { ordem: 1, nome: 'Aprovação', tipo: 'aprovacao_cliente' },
        { ordem: 0, nome: 'Copy', tipo: 'padrao' },
      ]),
    ).toBe('0|Copy|padrao;1|Aprovação|aprovacao_cliente');
    expect(stageSignature([])).toBe('');
  });
});

describe('toWorkflowEntity', () => {
  it('projeta o card sem inventar nada', () => {
    const e = toWorkflowEntity(makeCard({ id: 4, position: 3, data_limite: '2026-07-15' }));
    expect(e.kind).toBe('workflow');
    expect(e.id).toBe('workflow:4');
    expect(e.templateId).toBe(5);
    expect(e.steps.map((s) => s.nome)).toEqual(['Copy', 'Design']);
    expect(e.etapaOrdem).toBe(1);
    expect(e.etapaNome).toBe('Design');
    expect(e.responsavel?.nome).toBe('Ana');
    expect(e.prazoEfetivo?.getDate()).toBe(15);
    expect(e.posicao).toBe(3);
    expect(e.titulo).toBe('WF 4');
    expect(e.cliente?.nome).toBe('Aurora');
  });
});

describe('toPostEntity', () => {
  it('usa a etapa ativa, resolve cliente/responsável e o prazo congelado', () => {
    const e = toPostEntity(makeProcess({ board_position: 2 }), ctx);
    expect(e).not.toBeNull();
    expect(e!.id).toBe('post:9');
    expect(e!.step.nome).toBe('Design');
    expect(e!.etapaOrdem).toBe(1);
    expect(e!.etapaNome).toBe('Design');
    expect(e!.responsavel?.nome).toBe('Ana');
    expect(e!.cliente?.nome).toBe('Aurora');
    expect(e!.prazoEfetivo?.toISOString()).toBe('2026-07-20T15:00:00.000Z');
    expect(e!.posicao).toBe(2);
    expect(e!.titulo).toBe('Post X');
    expect(e!.templateId).toBe(5);
    expect(e!.steps.map((s) => s.ordem)).toEqual([0, 1]);
  });

  it('cai em etapa_atual quando nenhuma etapa está ativa e devolve null sem nenhuma', () => {
    const e = toPostEntity(
      makeProcess({
        steps: [step({ ordem: 0, nome: 'Copy' }), step({ ordem: 1, nome: 'Design' })],
        etapa_atual: 0,
      }),
      ctx,
    );
    expect(e?.etapaNome).toBe('Copy');
    expect(toPostEntity(makeProcess({ steps: [] }), ctx)).toBeNull();
  });

  it('sem responsável, avatar e capa vêm do contexto', () => {
    const e = toPostEntity(
      makeProcess({ steps: [step({ ordem: 0, nome: 'Copy', estado: 'ativo' })] }),
      {
        ...ctx,
        clienteAvatars: new Map([[3, 'https://x/a.png']]),
        covers: new Map([[77, { id: 1, url: 'u' } as never]]),
      },
    );
    expect(e?.responsavel).toBeUndefined();
    expect(e?.clienteAvatarUrl).toBe('https://x/a.png');
    expect(e?.cover).toMatchObject({ id: 1 });
    expect(e?.deadline).toEqual({
      diasRestantes: 0,
      horasRestantes: 0,
      estourado: false,
      urgente: false,
    });
  });
});

describe('sorts', () => {
  it('sortEntitiesByPrazo: mais cedo primeiro, sem prazo por último, empate por posicao', () => {
    const a = toWorkflowEntity(makeCard({ id: 1, position: 5, data_limite: '2026-07-20' }));
    const b = toPostEntity(makeProcess({ id: 2, board_position: 1 }), ctx)!; // 2026-07-20T15:00Z
    const c = toWorkflowEntity(makeCard({ id: 3, position: 0, data_limite: null })); // sem prazo
    const d = toWorkflowEntity(makeCard({ id: 4, position: 0, data_limite: '2026-07-20' }));
    const out = sortEntitiesByPrazo([c, a, b, d]).map((e) => e.id);
    // a e d têm a mesma data local (00:00 do dia 20); d vem antes por posicao 0 < 5.
    expect(out.slice(-1)).toEqual(['workflow:3']);
    expect(out.indexOf('workflow:4')).toBeLessThan(out.indexOf('workflow:1'));
  });

  it('sortEntitiesByPosicao: posicao crescente, empate por id numérico', () => {
    const w = toWorkflowEntity(makeCard({ id: 10, position: 1 }));
    const p = toPostEntity(makeProcess({ id: 2, board_position: 1 }), ctx)!;
    const q = toPostEntity(makeProcess({ id: 30, board_position: 0 }), ctx)!;
    expect(sortEntitiesByPosicao([w, p, q]).map((e) => e.id)).toEqual([
      'post:30',
      'post:2',
      'workflow:10',
    ]);
    expect(entityNumericId(w)).toBe(10);
    expect(isPostEntity(p)).toBe(true);
  });
});
