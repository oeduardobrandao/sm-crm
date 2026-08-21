import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, fromMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) },
    from: fromMock,
  },
}));

import { generateReportDoc, listReportDocs, updateReportDoc } from '../reportDocs';

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fromMock.mockReset();
});

describe('generateReportDoc', () => {
  it('POSTa clientId e month e devolve o id', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'doc-1' }), { status: 201 }));
    const res = await generateReportDoc(42, '2026-07');
    expect(res.id).toBe('doc-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/functions/v1/report-docs/generate');
    expect(JSON.parse(init.body)).toEqual({ clientId: 42, month: '2026-07' });
  });

  it('erro do servidor vira Error com mensagem amigável', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'feature_disabled' }), { status: 403 }),
    );
    await expect(generateReportDoc(42, '2026-07')).rejects.toThrow();
  });
});

describe('listReportDocs', () => {
  it('consulta report_documents filtrado por cliente', async () => {
    const order = vi.fn().mockResolvedValue({ data: [{ id: 'd1' }], error: null });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    fromMock.mockReturnValue({ select });
    const rows = await listReportDocs(42);
    expect(fromMock).toHaveBeenCalledWith('report_documents');
    expect(rows).toEqual([{ id: 'd1' }]);
  });
});

describe('updateReportDoc', () => {
  it('faz update apenas das colunas passadas, filtrado por id, confirmando a linha', async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ id: 'doc-1' }], error: null });
    const eq = vi.fn().mockReturnValue({ select });
    const update = vi.fn().mockReturnValue({ eq });
    fromMock.mockReturnValue({ update });
    await updateReportDoc('doc-1', { title: 'Novo título' });
    expect(fromMock).toHaveBeenCalledWith('report_documents');
    expect(update).toHaveBeenCalledWith({ title: 'Novo título' });
    expect(eq).toHaveBeenCalledWith('id', 'doc-1');
    expect(select).toHaveBeenCalledWith('id');
  });

  it('erro do PostgREST vira Error', async () => {
    const select = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    const eq = vi.fn().mockReturnValue({ select });
    fromMock.mockReturnValue({ update: vi.fn().mockReturnValue({ eq }) });
    await expect(updateReportDoc('doc-1', { title: 'x' })).rejects.toThrow('boom');
  });

  it('0 linhas afetadas (RLS filtrou, ex.: workspace trocado) vira Error mesmo com error: null', async () => {
    const select = vi.fn().mockResolvedValue({ data: [], error: null });
    const eq = vi.fn().mockReturnValue({ select });
    fromMock.mockReturnValue({ update: vi.fn().mockReturnValue({ eq }) });
    await expect(updateReportDoc('doc-1', { title: 'x' })).rejects.toThrow(
      'report_document não encontrado para atualização',
    );
  });
});
