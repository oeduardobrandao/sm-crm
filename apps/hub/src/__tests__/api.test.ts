import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFetchMock } from '../../../../test/shared/fetchMock';
import {
  createIdeia,
  deleteIdeia,
  fetchBootstrap,
  fetchBriefing,
  fetchPosts,
  submitApproval,
  submitBriefingAnswer,
  updateIdeia,
} from '../api';

const fetchHarness = createFetchMock();

describe('hub api client', () => {
  beforeEach(() => {
    fetchHarness.reset();
    vi.stubGlobal('fetch', fetchHarness.fetchMock);
  });

  it('builds GET requests with the public anon key and query params', async () => {
    fetchHarness.queueResponse({
      json: {
        workspace: { name: 'Mesaas', logo_url: null, brand_color: '#123456' },
        cliente_nome: 'Clínica Aurora',
        is_active: true,
        cliente_id: 9,
      },
    });

    const data = await fetchBootstrap('mesaas', 'token-publico');

    expect(data.cliente_nome).toBe('Clínica Aurora');
    expect(fetchHarness.calls).toHaveLength(1);
    expect(String(fetchHarness.calls[0].input)).toContain('/functions/v1/hub-bootstrap');
    expect(String(fetchHarness.calls[0].input)).toContain('workspace=mesaas');
    expect(String(fetchHarness.calls[0].input)).toContain('token=token-publico');
    expect(fetchHarness.calls[0].init?.headers).toEqual({ apikey: 'anon-key-for-tests' });
  });

  it('surfaces API error payloads for POST requests', async () => {
    fetchHarness.queueResponse({
      ok: false,
      status: 400,
      json: { error: 'Comentário obrigatório' },
    });

    await expect(
      submitApproval('token-hub', 12, 'mensagem'),
    ).rejects.toThrow('Comentário obrigatório');
  });

  it('falls back to HTTP status when error bodies are not valid JSON', async () => {
    fetchHarness.queueResponse({
      ok: false,
      status: 502,
      json: new Error('invalid json'),
    });

    await expect(fetchPosts('token-hub')).rejects.toThrow('HTTP 502');
  });

  it('sends PATCH and DELETE requests with tokenized resource URLs', async () => {
    fetchHarness.queueResponse({
      json: {
        ideia: {
          id: '7c2f6741-9fe7-40cc-9d58-54aa5e1fb1b9',
          titulo: 'Calendário de Maio',
        },
      },
    });
    fetchHarness.queueResponse({ json: { ok: true } });

    await updateIdeia('token-hub', '7c2f6741-9fe7-40cc-9d58-54aa5e1fb1b9', {
      titulo: 'Calendário de Junho',
      links: ['https://www.notion.so/calendario'],
    });
    await deleteIdeia('token-hub', '7c2f6741-9fe7-40cc-9d58-54aa5e1fb1b9');

    expect(fetchHarness.calls).toHaveLength(2);
    expect(String(fetchHarness.calls[0].input)).toContain('/hub-ideias/7c2f6741-9fe7-40cc-9d58-54aa5e1fb1b9');
    expect(String(fetchHarness.calls[0].input)).toContain('token=token-hub');
    expect(fetchHarness.calls[0].init?.method).toBe('PATCH');
    expect(fetchHarness.calls[1].init?.method).toBe('DELETE');
    expect(String(fetchHarness.calls[1].input)).toContain('token=token-hub');
  });

  it('serializes create and briefing payloads with realistic Portuguese content', async () => {
    fetchHarness.queueResponse({
      json: {
        ideia: {
          id: '312f2342-2db4-45fb-a887-5206e2b81a9c',
          titulo: 'Campanha Dia das Mães',
        },
      },
    });
    fetchHarness.queueResponse({ json: { ok: true } });
    fetchHarness.queueResponse({
      json: {
        questions: [{ id: 'q1', question: 'Qual é o principal objetivo?', answer: 'Gerar leads' }],
      },
    });

    await createIdeia('token-hub', {
      titulo: 'Campanha Dia das Mães',
      descricao: 'Sequência de posts com depoimentos reais de clientes.',
      links: ['https://www.canva.com/design/campanha-maes'],
    });
    await submitBriefingAnswer('token-hub', 'q1', 'Queremos mais agendamentos pelo WhatsApp.');
    const briefing = await fetchBriefing('token-hub');

    expect(JSON.parse(String(fetchHarness.calls[0].init?.body))).toMatchObject({
      token: 'token-hub',
      titulo: 'Campanha Dia das Mães',
    });
    expect(JSON.parse(String(fetchHarness.calls[1].init?.body))).toEqual({
      token: 'token-hub',
      question_id: 'q1',
      answer: 'Queremos mais agendamentos pelo WhatsApp.',
    });
    expect(briefing.questions).toHaveLength(1);
  });
});
