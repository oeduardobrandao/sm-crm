import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFrom, mockRpc } = vi.hoisted(() => ({ mockFrom: vi.fn(), mockRpc: vi.fn() }));

vi.mock('../core', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
  getContaId: vi.fn(async () => 'conta-1'),
  getUserId: vi.fn(async () => 'user-1'),
  getCurrentProfile: vi.fn(),
  clearProfileCache: vi.fn(),
}));

import {
  addItem,
  converterItens,
  criarLinha,
  deleteItem,
  enviarLinha,
  excluirColuna,
  getOrigemDoPost,
  listLinhasDoMes,
  listPostsDaLinha,
  recolherLinha,
  reorderItens,
  responderComentario,
  updateItem,
} from '../linhaEditorial';

/** Thenable query builder: every method returns itself, awaiting resolves `result`. */
function chain(result: { data: unknown; error: unknown }) {
  const q: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {};
  const self = () => q;
  for (const m of [
    'select',
    'insert',
    'update',
    'delete',
    'eq',
    'in',
    'not',
    'order',
    'limit',
    'single',
    'maybeSingle',
  ])
    q[m] = vi.fn(self);
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return q;
}

beforeEach(() => vi.clearAllMocks());

describe('store/linhaEditorial', () => {
  it('converterItens calls rpc linha_editorial_converter with p_linha_id, p_workflow_id, p_posts', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ item_id: 'i1', post_id: 9 }], error: null });
    const posts = [
      {
        item_id: 'i1',
        conteudo: { type: 'doc', content: [] },
        conteudo_plain: '',
        property_values: [],
      },
    ];

    const out = await converterItens('l1', 42, posts);

    expect(mockRpc).toHaveBeenCalledWith('linha_editorial_converter', {
      p_linha_id: 'l1',
      p_workflow_id: 42,
      p_posts: posts,
    });
    expect(out).toEqual([{ item_id: 'i1', post_id: 9 }]);
  });

  it('converterItens passes a null workflow for avulsos and throws the supabase error', async () => {
    const err = { message: 'plan_limit_exceeded:posts_avulsos' };
    mockRpc.mockResolvedValueOnce({ data: null, error: err });
    await expect(converterItens('l1', null, [])).rejects.toBe(err);
    expect(mockRpc.mock.calls[0][1].p_workflow_id).toBeNull();
  });

  it('converterItens accepts the {posts: [...]} jsonb shape too', async () => {
    mockRpc.mockResolvedValueOnce({ data: { posts: [{ item_id: 'i', post_id: 1 }] }, error: null });
    expect(await converterItens('l', null, [])).toEqual([{ item_id: 'i', post_id: 1 }]);
  });

  it('criarLinha calls the criar RPC and returns the uuid', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'uuid-1', error: null });
    expect(await criarLinha(5, '2026-11-01')).toBe('uuid-1');
    expect(mockRpc).toHaveBeenCalledWith('linha_editorial_criar', {
      p_cliente_id: 5,
      p_periodo: '2026-11-01',
    });
  });

  it('enviar/recolher/excluirColuna call their RPCs', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await enviarLinha('l1');
    await recolherLinha('l1');
    await excluirColuna('c1');
    expect(mockRpc.mock.calls).toEqual([
      ['linha_editorial_enviar', { p_linha_id: 'l1' }],
      ['linha_editorial_recolher', { p_linha_id: 'l1' }],
      ['linha_editorial_coluna_excluir', { p_coluna_id: 'c1' }],
    ]);
  });

  it('listLinhasDoMes embeds the item counts and maps them onto the linha', async () => {
    const q = chain({
      data: [
        {
          id: 'l1',
          periodo: '2026-11-01',
          itens: [{ count: 8 }],
          convertidos: [{ count: 3 }],
          aprovados: [{ count: 5 }],
        },
      ],
      error: null,
    });
    mockFrom.mockReturnValueOnce(q);

    const out = await listLinhasDoMes('2026-11-01');

    expect(mockFrom).toHaveBeenCalledWith('linhas_editoriais');
    expect(q.select.mock.calls[0][0]).toContain('linha_editorial_itens(count)');
    expect(q.eq).toHaveBeenCalledWith('periodo', '2026-11-01');
    expect(q.not).toHaveBeenCalledWith('convertidos.post_id', 'is', null);
    expect(q.select.mock.calls[0][0]).toContain('aprovados:linha_editorial_itens(count)');
    expect(q.eq).toHaveBeenCalledWith('aprovados.aprovacao', 'aprovado');
    expect(out[0]).toMatchObject({
      id: 'l1',
      itens_total: 8,
      itens_convertidos: 3,
      itens_aprovados: 5,
    });
    expect(out[0]).not.toHaveProperty('aprovados');
  });

  it('addItem sends a client id, conta_id, linha_id and never post_id', async () => {
    const q = chain({ data: { id: 'i-new' }, error: null });
    mockFrom.mockReturnValueOnce(q);

    await addItem('l1', { id: 'i-new', tipo: 'reels', ordem: 4, data: '2026-11-02' });

    expect(mockFrom).toHaveBeenCalledWith('linha_editorial_itens');
    const row = q.insert.mock.calls[0][0];
    expect(row).toMatchObject({
      id: 'i-new',
      conta_id: 'conta-1',
      linha_id: 'l1',
      tipo: 'reels',
      ordem: 4,
      data: '2026-11-02',
    });
    expect(row).not.toHaveProperty('post_id');
  });

  it('addItem appends after the last ordem when none is given', async () => {
    const last = chain({ data: [{ ordem: 6 }], error: null });
    const ins = chain({ data: { id: 'x' }, error: null });
    mockFrom.mockReturnValueOnce(last).mockReturnValueOnce(ins);

    await addItem('l1', {});

    expect(ins.insert.mock.calls[0][0]).toMatchObject({ ordem: 7, tipo: 'feed', titulo: '' });
  });

  it('updateItem patches by id and deleteItem deletes by id', async () => {
    const u = chain({ data: null, error: null });
    const d = chain({ data: null, error: null });
    mockFrom.mockReturnValueOnce(u).mockReturnValueOnce(d);

    await updateItem('i1', { titulo: 'Novo' });
    await deleteItem('i1');

    expect(u.update).toHaveBeenCalledWith({ titulo: 'Novo' });
    expect(u.eq).toHaveBeenCalledWith('id', 'i1');
    expect(d.delete).toHaveBeenCalled();
    expect(d.eq).toHaveBeenCalledWith('id', 'i1');
  });

  it('reorderItens writes ordem = position for each id', async () => {
    const qs = [chain({ data: null, error: null }), chain({ data: null, error: null })];
    mockFrom.mockReturnValueOnce(qs[0]).mockReturnValueOnce(qs[1]);

    await reorderItens(['b', 'a']);

    expect(qs[0].update).toHaveBeenCalledWith({ ordem: 0 });
    expect(qs[0].eq).toHaveBeenCalledWith('id', 'b');
    expect(qs[1].update).toHaveBeenCalledWith({ ordem: 1 });
    expect(qs[1].eq).toHaveBeenCalledWith('id', 'a');
  });

  it('responderComentario inserts a team comment without rodada', async () => {
    const q = chain({ data: null, error: null });
    mockFrom.mockReturnValueOnce(q);

    await responderComentario('l1', 'i1', 'Combinado!');

    expect(mockFrom).toHaveBeenCalledWith('linha_editorial_respostas');
    const row = q.insert.mock.calls[0][0];
    expect(row).toEqual({
      conta_id: 'conta-1',
      linha_id: 'l1',
      item_id: 'i1',
      acao: 'comentario',
      comentario: 'Combinado!',
      is_workspace_user: true,
      author_user_id: 'user-1',
    });
    expect(row).not.toHaveProperty('rodada');
  });

  it('getOrigemDoPost returns the linha and item, or null', async () => {
    mockFrom.mockReturnValueOnce(
      chain({ data: { id: 'i1', post_id: 9, linha: { id: 'l1' } }, error: null }),
    );
    const found = await getOrigemDoPost(9);
    expect(found).toEqual({ linha: { id: 'l1' }, item: { id: 'i1', post_id: 9 } });

    mockFrom.mockReturnValueOnce(chain({ data: null, error: null }));
    expect(await getOrigemDoPost(10)).toBeNull();
  });

  it('listPostsDaLinha selects the production fields and flattens the workflow title', async () => {
    const q = chain({
      data: [
        {
          id: 9,
          status: 'rascunho',
          custom_status_id: null,
          titulo: 'P',
          workflow_id: 3,
          workflows: { titulo: 'Reels de novembro' },
        },
        {
          id: 10,
          status: 'rascunho',
          custom_status_id: null,
          titulo: 'Q',
          workflow_id: null,
          workflows: null,
        },
      ],
      error: null,
    });
    mockFrom.mockReturnValueOnce(q);

    const out = await listPostsDaLinha([9, 10]);

    expect(q.select).toHaveBeenCalledWith(
      'id, status, custom_status_id, titulo, workflow_id, workflows(titulo)',
    );
    expect(q.in).toHaveBeenCalledWith('id', [9, 10]);
    expect(out.map((p) => p.workflow_titulo)).toEqual(['Reels de novembro', null]);
    expect(await listPostsDaLinha([])).toEqual([]);
  });
});
