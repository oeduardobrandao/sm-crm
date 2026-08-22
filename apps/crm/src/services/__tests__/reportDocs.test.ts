import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, fromMock, getSessionMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  fromMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: getSessionMock },
    from: fromMock,
  },
}));

import {
  deleteReportDoc,
  exportReportPdf,
  generateReportDoc,
  listReportDocs,
  refreshReportDoc,
  updateReportDoc,
} from '../reportDocs';

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fromMock.mockReset();
  // A suíte global (test/vitest.setup.ts) roda vi.restoreAllMocks() em todo
  // afterEach; para um vi.fn() puro (não vi.spyOn) isso zera o
  // mockResolvedValue aplicado acima. Rearmar aqui é o mesmo padrão de
  // RelatorioEditorPage.test.tsx / useLayoutAutosave.test.ts.
  getSessionMock.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
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

  it('com templateId, inclui a chave no body', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'doc-1' }), { status: 201 }));
    await generateReportDoc(42, '2026-07', 'tpl-1');
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ clientId: 42, month: '2026-07', templateId: 'tpl-1' });
  });

  it('erro do servidor vira Error com mensagem amigável', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'feature_disabled' }), { status: 403 }),
    );
    await expect(generateReportDoc(42, '2026-07')).rejects.toThrow();
  });

  it('invalid_template vira mensagem amigável', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_template' }), { status: 400 }),
    );
    await expect(generateReportDoc(42, '2026-07', 'tpl-bad')).rejects.toThrow(
      'Template inválido. Tente outro ou o layout padrão.',
    );
  });
});

describe('exportReportPdf', () => {
  it('POSTa em /:id/pdf e devolve {url}', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ url: 'https://cdn.example.com/doc.pdf' }), { status: 200 }),
    );
    const res = await exportReportPdf('doc-1');
    expect(res).toEqual({ url: 'https://cdn.example.com/doc.pdf' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/functions/v1/report-docs/doc-1/pdf');
    expect(init.method).toBe('POST');
  });

  it('pdf_not_configured vira mensagem amigável', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'pdf_not_configured' }), { status: 503 }),
    );
    await expect(exportReportPdf('doc-1')).rejects.toThrow(
      'Export de PDF não configurado neste ambiente.',
    );
  });

  it('pdf_failed vira mensagem amigável', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'pdf_failed' }), { status: 502 }),
    );
    await expect(exportReportPdf('doc-1')).rejects.toThrow(
      'Não foi possível gerar o PDF. Tente novamente.',
    );
  });
});

describe('refreshReportDoc', () => {
  it('POSTa em /:id/refresh-data e resolve', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(refreshReportDoc('doc-1')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/functions/v1/report-docs/doc-1/refresh-data');
    expect(init.method).toBe('POST');
  });

  it('erro do servidor vira Error', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }),
    );
    await expect(refreshReportDoc('doc-1')).rejects.toThrow();
  });
});

describe('deleteReportDoc', () => {
  it('faz DELETE em /:id', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(deleteReportDoc('doc-1')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/functions/v1/report-docs/doc-1');
    expect(String(url)).not.toContain('/refresh-data');
    expect(init.method).toBe('DELETE');
  });

  it('erro do servidor vira Error', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }),
    );
    await expect(deleteReportDoc('doc-1')).rejects.toThrow();
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
