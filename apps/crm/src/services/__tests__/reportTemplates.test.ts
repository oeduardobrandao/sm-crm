import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fromMock, rpcMock, getContaIdMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  getContaIdMock: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
  },
}));

vi.mock('../../store/core', () => ({
  getContaId: getContaIdMock,
}));

import {
  createReportTemplate,
  deleteReportTemplate,
  listReportTemplates,
  setDefaultReportTemplate,
} from '../reportTemplates';

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
  getContaIdMock.mockReset();
});

describe('listReportTemplates', () => {
  it('consulta report_templates ordenado por created_at desc', async () => {
    const rows = [
      {
        id: 't1',
        name: 'Padrão',
        layout: { version: 1, blocks: [] },
        is_default: true,
        created_at: '2026-08-01',
      },
    ];
    const order = vi.fn().mockResolvedValue({ data: rows, error: null });
    const select = vi.fn().mockReturnValue({ order });
    fromMock.mockReturnValue({ select });

    const result = await listReportTemplates();

    expect(fromMock).toHaveBeenCalledWith('report_templates');
    expect(select).toHaveBeenCalledWith('id, name, layout, is_default, created_at');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(result).toEqual(rows);
  });

  it('erro do PostgREST vira Error', async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    const select = vi.fn().mockReturnValue({ order });
    fromMock.mockReturnValue({ select });

    await expect(listReportTemplates()).rejects.toThrow('boom');
  });

  it('data null vira lista vazia', async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: null });
    const select = vi.fn().mockReturnValue({ order });
    fromMock.mockReturnValue({ select });

    await expect(listReportTemplates()).resolves.toEqual([]);
  });
});

describe('createReportTemplate', () => {
  it('envia conta_id, name e layout no insert', async () => {
    getContaIdMock.mockResolvedValue('conta-1');
    const layout = { version: 1, blocks: [] };
    const created = { id: 't2', name: 'Novo', layout, is_default: false, created_at: '2026-08-02' };
    const single = vi.fn().mockResolvedValue({ data: created, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    fromMock.mockReturnValue({ insert });

    const result = await createReportTemplate('Novo', layout);

    expect(fromMock).toHaveBeenCalledWith('report_templates');
    expect(insert).toHaveBeenCalledWith({ conta_id: 'conta-1', name: 'Novo', layout });
    expect(select).toHaveBeenCalledWith('id, name, layout, is_default, created_at');
    expect(result).toEqual(created);
  });

  it('erro do PostgREST vira Error', async () => {
    getContaIdMock.mockResolvedValue('conta-1');
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'insert falhou' } });
    const select = vi.fn().mockReturnValue({ single });
    fromMock.mockReturnValue({ insert: vi.fn().mockReturnValue({ select }) });

    await expect(createReportTemplate('Novo', { version: 1, blocks: [] })).rejects.toThrow(
      'insert falhou',
    );
  });
});

describe('deleteReportTemplate', () => {
  it('deleta filtrado por id', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const del = vi.fn().mockReturnValue({ eq });
    fromMock.mockReturnValue({ delete: del });

    await deleteReportTemplate('t1');

    expect(fromMock).toHaveBeenCalledWith('report_templates');
    expect(eq).toHaveBeenCalledWith('id', 't1');
  });

  it('erro do PostgREST vira Error', async () => {
    const eq = vi.fn().mockResolvedValue({ error: { message: 'delete falhou' } });
    fromMock.mockReturnValue({ delete: vi.fn().mockReturnValue({ eq }) });

    await expect(deleteReportTemplate('t1')).rejects.toThrow('delete falhou');
  });
});

describe('setDefaultReportTemplate', () => {
  it('chama a RPC set_default_report_template com p_template_id', async () => {
    rpcMock.mockResolvedValue({ error: null });

    await setDefaultReportTemplate('t1');

    expect(rpcMock).toHaveBeenCalledWith('set_default_report_template', { p_template_id: 't1' });
  });

  it('erro da RPC vira Error', async () => {
    rpcMock.mockResolvedValue({ error: { message: 'NOT_FOUND' } });

    await expect(setDefaultReportTemplate('t1')).rejects.toThrow('NOT_FOUND');
  });
});
