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

import { generateReportDoc, listReportDocs } from '../reportDocs';

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
