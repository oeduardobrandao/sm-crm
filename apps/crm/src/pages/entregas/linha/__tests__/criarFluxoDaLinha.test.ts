import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow } from '@/store';
import type { LinhaColuna, LinhaItem } from '@/store/linhaEditorial';

const m = vi.hoisted(() => ({
  getPropertyDefinitions: vi.fn(),
  converterItens: vi.fn(),
}));

vi.mock('@/store/posts', () => ({ getPropertyDefinitions: m.getPropertyDefinitions }));
vi.mock('@/store/linhaEditorial', () => ({ converterItens: m.converterItens }));

import { converterParaFluxo } from '../criarFluxoDaLinha';

const ITEM: LinhaItem = {
  id: 'i1',
  linha_id: 'l-1',
  data: '2026-11-03',
  tipo: 'reels',
  titulo: 'Bastidores',
  direcao: 'Mostrar a recepção',
  valores: { c1: 'Dra. Ana' },
  ordem: 0,
  post_id: null,
};

const COLUNA: LinhaColuna = {
  id: 'c1',
  nome: 'Responsável',
  tipo: 'text',
  config: {},
  visivel_cliente: true,
  oculta: false,
  ordem: 0,
} as LinhaColuna;

beforeEach(() => {
  vi.clearAllMocks();
  m.converterItens.mockResolvedValue([{ item_id: 'i1', post_id: 900 }]);
});

describe('converterParaFluxo', () => {
  it('maps columns to the template properties of the new fluxo', async () => {
    m.getPropertyDefinitions.mockResolvedValue([
      { id: 31, template_id: 12, name: 'responsavel', type: 'text', config: {} },
    ]);
    await converterParaFluxo('l-1', { id: 77, template_id: 12 } as Workflow, [ITEM], [COLUNA]);
    expect(m.getPropertyDefinitions).toHaveBeenCalledWith(12);
    const [linhaId, workflowId, posts] = m.converterItens.mock.calls[0];
    expect(linhaId).toBe('l-1');
    expect(workflowId).toBe(77);
    expect(posts).toHaveLength(1);
    expect(posts[0].item_id).toBe('i1');
    expect(posts[0].property_values).toEqual([{ property_definition_id: 31, value: 'Dra. Ana' }]);
  });

  it('without a template, every column goes to the content and no definitions are read', async () => {
    await converterParaFluxo('l-1', { id: 77, template_id: null } as Workflow, [ITEM], [COLUNA]);
    expect(m.getPropertyDefinitions).not.toHaveBeenCalled();
    const posts = m.converterItens.mock.calls[0][2];
    expect(posts[0].property_values).toEqual([]);
    expect(posts[0].conteudo_plain).toContain('Responsável: Dra. Ana');
  });

  it('names the plan limit when the converter refuses it', async () => {
    m.converterItens.mockRejectedValue({ message: 'plan_limit_exceeded:max_posts_per_month' });
    const err = await converterParaFluxo(
      'l-1',
      { id: 77, template_id: null } as Workflow,
      [ITEM],
      [COLUNA],
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/plan_limit_exceeded/);
    expect((err as Error).message).toMatch(/limite|plano/i);
  });

  it('a generic failure says the fluxo was not created and what to do', async () => {
    m.converterItens.mockRejectedValue(new Error('boom'));
    await expect(
      converterParaFluxo('l-1', { id: 77, template_id: null } as Workflow, [ITEM], [COLUNA]),
    ).rejects.toThrow(
      'Não foi possível criar os posts da linha. O fluxo não foi criado. Tente de novo.',
    );
  });
});
