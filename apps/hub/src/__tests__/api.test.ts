import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFetchMock } from '../../../../test/shared/fetchMock';
import {
  createIdeia,
  deleteBriefingAudio,
  deleteIdeia,
  deleteIdeiaAudio,
  fetchBootstrap,
  fetchBriefing,
  fetchPostHistory,
  fetchPosts,
  finalizeBriefingAudio,
  finalizeIdeiaAudio,
  presignBriefingAudio,
  presignIdeiaAudio,
  retryBriefingTranscription,
  retryIdeiaTranscription,
  submitApproval,
  submitBriefingAnswer,
  submitEditSuggestion,
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
        feature_mensagens: true,
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

    await expect(submitApproval('token-hub', 12, 'mensagem')).rejects.toThrow(
      'Comentário obrigatório',
    );
  });

  describe('429 retry', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries a rate-limited write with backoff and resolves once the server accepts it', async () => {
      vi.useFakeTimers();
      fetchHarness.queueResponse({ ok: false, status: 429, json: { error: 'Muitas tentativas.' } });
      fetchHarness.queueResponse({ ok: false, status: 429, json: { error: 'Muitas tentativas.' } });
      fetchHarness.queueResponse({ json: { ok: true } });

      const pending = submitBriefingAnswer('token-hub', 'q1', 'resposta');
      await vi.advanceTimersByTimeAsync(60_000);

      await expect(pending).resolves.toEqual({ ok: true });
      expect(fetchHarness.calls).toHaveLength(3);
      for (const call of fetchHarness.calls) {
        expect(JSON.parse(String(call.init?.body))).toEqual({
          token: 'token-hub',
          question_id: 'q1',
          answer: 'resposta',
        });
      }
    });

    it('gives up after the retry budget and surfaces the rate-limit message', async () => {
      vi.useFakeTimers();
      for (let i = 0; i < 10; i++) {
        fetchHarness.queueResponse({
          ok: false,
          status: 429,
          json: { error: 'Muitas tentativas.' },
        });
      }

      const pending = submitBriefingAnswer('token-hub', 'q1', 'resposta');
      const outcome = expect(pending).rejects.toThrow('Muitas tentativas.');
      await vi.advanceTimersByTimeAsync(120_000);
      await outcome;

      expect(fetchHarness.calls).toHaveLength(4);
    });

    it('stops retrying once its abort signal fires (a newer autosave superseded it)', async () => {
      vi.useFakeTimers();
      fetchHarness.queueResponse({ ok: false, status: 429, json: { error: 'Muitas tentativas.' } });
      fetchHarness.queueResponse({ json: { ok: true } });

      const ac = new AbortController();
      const pending = submitBriefingAnswer('token-hub', 'q1', 'versão antiga', ac.signal);
      const outcome = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      await vi.advanceTimersByTimeAsync(500);
      ac.abort();
      await vi.advanceTimersByTimeAsync(60_000);
      await outcome;

      // The stale payload was never replayed.
      expect(fetchHarness.calls).toHaveLength(1);
    });

    it('does not retry non-429 failures', async () => {
      fetchHarness.queueResponse({ ok: false, status: 500, json: { error: 'boom' } });
      await expect(submitBriefingAnswer('token-hub', 'q1', 'x')).rejects.toThrow('boom');
      expect(fetchHarness.calls).toHaveLength(1);
    });
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
    expect(String(fetchHarness.calls[0].input)).toContain(
      '/hub-ideias/7c2f6741-9fe7-40cc-9d58-54aa5e1fb1b9',
    );
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

  it('sends edit suggestion payload to hub-edit-suggestion endpoint', async () => {
    fetchHarness.queueResponse({
      json: {
        ok: true,
        pending_suggestion: {
          id: 5,
          post_id: 42,
          suggested_conteudo: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Texto editado' }] }],
          },
          suggested_conteudo_plain: 'Texto editado',
          suggested_ig_caption: null,
          changed_fields: ['conteudo'],
          status: 'pending',
          updated_at: '2026-05-25T10:00:00Z',
        },
      },
    });

    const result = await submitEditSuggestion(
      'token-hub',
      42,
      {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Texto editado' }] }],
      },
      'Texto editado',
      null,
    );

    expect(result.ok).toBe(true);
    expect(result.pending_suggestion?.post_id).toBe(42);
    expect(fetchHarness.calls).toHaveLength(1);
    expect(String(fetchHarness.calls[0].input)).toContain('/hub-edit-suggestion');
    expect(fetchHarness.calls[0].init?.method).toBe('POST');
    const body = JSON.parse(String(fetchHarness.calls[0].init?.body));
    expect(body).toMatchObject({
      token: 'token-hub',
      post_id: 42,
      suggested_conteudo_plain: 'Texto editado',
      suggested_ig_caption: null,
    });
  });

  it('throws on edit suggestion error', async () => {
    fetchHarness.queueResponse({
      ok: false,
      status: 400,
      json: { error: 'Post não está em revisão' },
    });

    await expect(submitEditSuggestion('token-hub', 99, null, 'texto', null)).rejects.toThrow(
      'Post não está em revisão',
    );
  });

  it('presigns and finalizes briefing audio on the nested hub-briefing routes', async () => {
    fetchHarness.queueResponse({
      json: {
        upload_url: 'https://r2/put',
        r2_key: 'briefing-audio/c/q/x.webm',
        mime_type: 'audio/webm',
      },
    });
    const signed = await presignBriefingAudio('tok', {
      question_id: 'q1',
      mime_type: 'audio/webm;codecs=opus',
      size_bytes: 10,
    });
    expect(signed.mime_type).toBe('audio/webm');
    expect(String(fetchHarness.calls[0].input)).toContain('/functions/v1/hub-briefing/upload-url');
    expect(JSON.parse(String(fetchHarness.calls[0].init?.body))).toEqual({
      token: 'tok',
      question_id: 'q1',
      mime_type: 'audio/webm;codecs=opus',
      size_bytes: 10,
    });

    fetchHarness.queueResponse({ json: { ok: true, answer: 'oi', transcript: 'oi', audio: null } });
    const fin = await finalizeBriefingAudio('tok', 'q1', {
      r2_key: 'k',
      mime_type: 'audio/webm',
      size_bytes: 10,
      duration_seconds: 3,
    });
    expect(fin.answer).toBe('oi');
    expect(String(fetchHarness.calls[1].input)).toContain('/functions/v1/hub-briefing/q1/audio');
  });

  it('retries transcription and deletes audio', async () => {
    fetchHarness.queueResponse({ json: { ok: true, answer: 'a', transcript: 'a', audio: null } });
    await retryBriefingTranscription('tok', 'q1');
    expect(String(fetchHarness.calls[0].input)).toContain('/hub-briefing/q1/audio/transcribe');
    expect(JSON.parse(String(fetchHarness.calls[0].init?.body))).toEqual({ token: 'tok' });

    fetchHarness.queueResponse({ json: { ok: true } });
    await deleteBriefingAudio('tok', 'q1');
    expect(fetchHarness.calls[1].init?.method).toBe('DELETE');
    expect(String(fetchHarness.calls[1].input)).toContain('/hub-briefing/q1/audio?token=tok');
  });

  it('presigns, finalizes, retries and deletes ideia audio on the hub-ideias routes', async () => {
    fetchHarness.queueResponse({
      json: { upload_url: 'u', r2_key: 'k', mime_type: 'audio/webm' },
    });
    await presignIdeiaAudio('tok', { ideia_id: 'i1', mime_type: 'audio/webm', size_bytes: 3 });
    expect(String(fetchHarness.calls[0].input)).toContain(
      '/functions/v1/hub-ideias/audio-upload-url',
    );
    expect(JSON.parse(String(fetchHarness.calls[0].init?.body))).toEqual({
      token: 'tok',
      ideia_id: 'i1',
      mime_type: 'audio/webm',
      size_bytes: 3,
    });

    fetchHarness.queueResponse({ json: { ok: true, transcript: null, audio: null } });
    await finalizeIdeiaAudio('tok', 'i1', {
      r2_key: 'k',
      mime_type: 'audio/webm',
      size_bytes: 3,
      duration_seconds: 2,
    });
    expect(String(fetchHarness.calls[1].input)).toContain('/functions/v1/hub-ideias/i1/audio');

    fetchHarness.queueResponse({ json: { ok: true, transcript: null, audio: null } });
    await retryIdeiaTranscription('tok', 'i1');
    expect(String(fetchHarness.calls[2].input)).toContain(
      '/functions/v1/hub-ideias/i1/audio/transcribe',
    );

    fetchHarness.queueResponse({ json: { ok: true } });
    await deleteIdeiaAudio('tok', 'i1');
    expect(String(fetchHarness.calls[3].input)).toContain('/hub-ideias/i1/audio?token=tok');
    expect(fetchHarness.calls[3].init?.method).toBe('DELETE');
  });

  it('fetches a post history through hub-post-history with token and post_id', async () => {
    fetchHarness.queueResponse({ json: { events: [], approvals: [] } });

    const result = await fetchPostHistory('token-hub', 42);

    expect(result).toEqual({ events: [], approvals: [] });
    const url = new URL(String(fetchHarness.calls[0].input));
    expect(url.pathname).toBe('/functions/v1/hub-post-history');
    expect(url.searchParams.get('token')).toBe('token-hub');
    expect(url.searchParams.get('post_id')).toBe('42');
    expect(fetchHarness.calls[0].init?.method).toBeUndefined();
  });

  it('sends motivo with a correcao and omits it otherwise', async () => {
    fetchHarness.queueResponse({ json: { ok: true } });
    await submitApproval('token-hub', 12, 'correcao', 'Trocar foto', 'midia');
    expect(JSON.parse(String(fetchHarness.calls[0].init?.body))).toEqual({
      token: 'token-hub',
      post_id: 12,
      action: 'correcao',
      comentario: 'Trocar foto',
      motivo: 'midia',
    });

    fetchHarness.queueResponse({ json: { ok: true } });
    await submitApproval('token-hub', 12, 'aprovado');
    expect(JSON.parse(String(fetchHarness.calls[1].init?.body))).toEqual({
      token: 'token-hub',
      post_id: 12,
      action: 'aprovado',
    });
  });
});
