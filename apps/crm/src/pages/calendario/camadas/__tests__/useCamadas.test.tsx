import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cliente, ScheduledPost, Workflow, WorkflowEtapa } from '../../../../store';

vi.mock('../../../../store', async () => {
  const actual = await vi.importActual<typeof import('../../../../store')>('../../../../store');
  return {
    ...actual,
    getScheduledPosts: vi.fn(),
    getClientes: vi.fn(),
    getMembros: vi.fn(),
    getTransacoes: vi.fn(),
    getWorkflows: vi.fn(),
    getWorkflowEtapasByWorkflowIds: vi.fn(),
    getAllClienteDatas: vi.fn(),
  };
});

import * as store from '../../../../store';
import { CAMADAS_PADRAO } from '../camadasStorage';
import type { CamadaItem, CamadasAtivas } from '../tipos';
import { useCamadas } from '../useCamadas';

const PERIODO = { start: new Date(2026, 9, 5), end: new Date(2026, 9, 12) };
const TODAS_DESLIGADAS: CamadasAtivas = {
  posts: false,
  prazos: false,
  recebimentos: false,
  pagamentos: false,
  datas: false,
  comemorativas: false,
};

const CLIENTE = {
  id: 1,
  nome: 'Clínica Sorriso',
  cor: '#123',
  status: 'ativo',
  valor_mensal: 1500,
  data_pagamento: 10,
  data_aniversario: '10-08',
} as Cliente;

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function W({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function arm() {
  vi.mocked(store.getScheduledPosts).mockResolvedValue([
    {
      id: 9,
      workflow_id: 3,
      titulo: 'Carrossel',
      status: 'agendado',
      scheduled_at: new Date(2030, 0, 1).toISOString(),
      platform: 'instagram',
    } as ScheduledPost,
  ]);
  vi.mocked(store.getClientes).mockResolvedValue([CLIENTE]);
  vi.mocked(store.getMembros).mockResolvedValue([
    {
      id: 7,
      nome: 'Bruno',
      cargo: '',
      tipo: 'clt',
      custo_mensal: 3000,
      avatar_url: '',
      data_pagamento: 6,
    },
  ]);
  vi.mocked(store.getTransacoes).mockResolvedValue([]);
  vi.mocked(store.getWorkflows).mockResolvedValue([
    { id: 3, cliente_id: 1, titulo: 'Fluxo', status: 'ativo', etapa_atual: 0, recorrente: false },
    { id: 4, cliente_id: 1, titulo: 'Longe', status: 'ativo', etapa_atual: 0, recorrente: false },
  ] as Workflow[]);
  vi.mocked(store.getWorkflowEtapasByWorkflowIds).mockResolvedValue(
    new Map<number, WorkflowEtapa[]>([
      [
        3,
        [
          {
            workflow_id: 3,
            ordem: 0,
            nome: 'Design',
            prazo_dias: 2,
            tipo_prazo: 'corridos',
            status: 'ativo',
            iniciado_em: new Date(2026, 9, 6, 9).toISOString(),
          },
        ],
      ],
      [
        4,
        [
          {
            workflow_id: 4,
            ordem: 0,
            nome: 'Copy',
            prazo_dias: 40,
            tipo_prazo: 'corridos',
            status: 'ativo',
            iniciado_em: new Date(2026, 9, 6, 9).toISOString(),
          },
        ],
      ],
    ]),
  );
  vi.mocked(store.getAllClienteDatas).mockResolvedValue([
    { id: 2, cliente_id: 1, titulo: 'Inauguração', data: '2026-10-09' },
  ]);
}

const camadasDe = (itens: CamadaItem[]) => itens.map((i) => i.camada);

describe('useCamadas', () => {
  beforeEach(arm);

  it('runs no query while every layer is off', async () => {
    const { result } = renderHook(() => useCamadas(PERIODO, TODAS_DESLIGADAS, true, 'medico'), {
      wrapper: wrapper(),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toEqual([]);
    for (const fn of [
      store.getScheduledPosts,
      store.getClientes,
      store.getMembros,
      store.getTransacoes,
      store.getWorkflows,
      store.getAllClienteDatas,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it.each([false, 'unknown', undefined] as const)(
    'never fetches transactions or members when canSeeFinancials is %s',
    async (fin) => {
      const { result } = renderHook(
        () =>
          useCamadas(
            PERIODO,
            { ...TODAS_DESLIGADAS, recebimentos: true, pagamentos: true, datas: true },
            fin,
            'medico',
          ),
        { wrapper: wrapper() },
      );
      await waitFor(() => expect(result.current.length).toBeGreaterThan(0));
      expect(store.getTransacoes).not.toHaveBeenCalled();
      expect(store.getMembros).not.toHaveBeenCalled();
      expect(camadasDe(result.current)).not.toContain('recebimentos');
      expect(camadasDe(result.current)).not.toContain('pagamentos');
    },
  );

  it('builds receivables and team payments with canSeeFinancials === true', async () => {
    const { result } = renderHook(
      () =>
        useCamadas(
          PERIODO,
          { ...TODAS_DESLIGADAS, recebimentos: true, pagamentos: true },
          true,
          'medico',
        ),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current.map((i) => i.id).sort()).toEqual([
      'pagamentos:2026-10-06',
      'recebimentos:2026-10-10',
    ]);
  });

  it('posts come from getScheduledPosts over the visible range', async () => {
    const { result } = renderHook(
      () => useCamadas(PERIODO, { ...TODAS_DESLIGADAS, posts: true }, true, 'medico'),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(store.getScheduledPosts).toHaveBeenCalledWith(
      PERIODO.start.toISOString(),
      PERIODO.end.toISOString(),
    );
    expect(result.current[0]).toMatchObject({ camada: 'posts', id: 'posts:9', estado: 'agendado' });
    expect(store.getClientes).not.toHaveBeenCalled();
  });

  it('deadlines only inside the range, from the active stages of active workflows', async () => {
    const { result } = renderHook(
      () => useCamadas(PERIODO, { ...TODAS_DESLIGADAS, prazos: true }, true, 'medico'),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(store.getWorkflowEtapasByWorkflowIds).toHaveBeenCalledWith([3, 4]);
    expect(result.current[0]).toMatchObject({
      camada: 'prazos',
      id: 'prazos:3',
      dia: '2026-10-08',
      prazo: { etapaNome: 'Design', clienteNome: 'Clínica Sorriso' },
    });
  });

  it('client dates: birthdays and important dates', async () => {
    const { result } = renderHook(
      () => useCamadas(PERIODO, { ...TODAS_DESLIGADAS, datas: true }, true, 'medico'),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current.map((i) => (i.camada === 'datas' ? `${i.dia} ${i.titulo}` : ''))).toEqual(
      ['2026-10-08 Aniversário', '2026-10-09 Inauguração'],
    );
  });

  it('commemorative dates follow the chosen niche, without any query', () => {
    const { result } = renderHook(
      () =>
        useCamadas(
          { start: new Date(2026, 9, 1), end: new Date(2026, 10, 1) },
          { ...TODAS_DESLIGADAS, comemorativas: true },
          true,
          'varejo',
        ),
      { wrapper: wrapper() },
    );
    const nomes = result.current.map((i) => (i.camada === 'comemorativas' ? i.nome : ''));
    expect(nomes.length).toBeGreaterThan(0);
    expect(nomes.some((n) => /Dia das Crianças/.test(n))).toBe(true);
    expect(store.getClientes).not.toHaveBeenCalled();
  });

  it('defaults keep commemorative dates off', async () => {
    const { result } = renderHook(() => useCamadas(PERIODO, CAMADAS_PADRAO, true, 'medico'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.length).toBeGreaterThan(0));
    expect(camadasDe(result.current)).not.toContain('comemorativas');
  });

  it('returns nothing before the grid reports a period', () => {
    const { result } = renderHook(() => useCamadas(null, CAMADAS_PADRAO, true, 'medico'), {
      wrapper: wrapper(),
    });
    expect(result.current).toEqual([]);
    expect(store.getScheduledPosts).not.toHaveBeenCalled();
  });
});
