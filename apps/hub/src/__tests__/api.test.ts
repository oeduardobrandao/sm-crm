import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFetchMock } from '../../../../test/shared/fetchMock';
import { HUB_SESSION_STORAGE_KEY } from '../lib/hubSession';
import {
  HubApiError,
  createIdeia,
  deleteBriefingAudio,
  deleteIdeia,
  deleteIdeiaAudio,
  deleteIdeiaImage,
  downloadAgendaIcs,
  fetchConvite,
  fetchReportHtml,
  fetchBootstrap,
  fetchBriefing,
  fetchPostHistory,
  fetchPosts,
  finalizeBriefingAudio,
  finalizeIdeiaAudio,
  presignBriefingAudio,
  hubHeaders,
  isLoginRequired,
  logoutHub,
  presignIdeiaAudio,
  reorderPostSchedules,
  requestLoginCode,
  retryBriefingTranscription,
  retryIdeiaTranscription,
  setLoginRequiredListener,
  submitApproval,
  submitBriefingAnswer,
  submitEditSuggestion,
  submitLinhaAcao,
  updateIdeia,
  verifyLoginCode,
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

  it('keeps the error message and carries the HTTP status and code', async () => {
    fetchHarness.queueResponse({
      ok: false,
      status: 409,
      json: { error: 'Não foi possível concluir. Tente novamente.', code: 'itens_com_ajustes' },
    });

    await expect(
      submitLinhaAcao('token-hub', { linha_id: 'l1', acao: 'aprovado' }),
    ).rejects.toMatchObject({
      name: 'HubApiError',
      message: 'Não foi possível concluir. Tente novamente.',
      status: 409,
      code: 'itens_com_ajustes',
    });
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

    const result = await submitEditSuggestion('token-hub', 42, {
      conteudo: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Texto editado' }] }],
      },
      conteudo_plain: 'Texto editado',
      captions: { ig_caption: null },
      touched_fields: ['texto'],
      bases: { conteudo: null, conteudo_plain: 'Texto original' },
    });

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
      touched_fields: ['texto'],
      // A null base must survive JSON: the RPC tests key presence, not value.
      bases: { conteudo: null, conteudo_plain: 'Texto original' },
    });
    expect(body.bases).toHaveProperty('conteudo', null);
    // Captions not given are not sent at all (absent = untouched).
    expect(body).not.toHaveProperty('suggested_tiktok_caption');
    expect(body).not.toHaveProperty('suggested_geral_caption');
  });

  it('sends the TikTok and Geral captions and their bases, null base kept', async () => {
    fetchHarness.queueResponse({ json: { ok: true, pending_suggestion: null } });
    await submitEditSuggestion('token-hub', 42, {
      conteudo: null,
      conteudo_plain: 'Corpo',
      captions: { ig_caption: 'IG', tiktok_caption: 'TT novo', geral_caption: null },
      touched_fields: ['legenda_tiktok'],
      bases: { tiktok_caption: null },
    });
    const body = JSON.parse(String(fetchHarness.calls[0].init?.body));
    expect(body).toMatchObject({
      suggested_ig_caption: 'IG',
      suggested_tiktok_caption: 'TT novo',
      suggested_geral_caption: null,
      touched_fields: ['legenda_tiktok'],
    });
    expect(body.bases).toHaveProperty('tiktok_caption', null);
  });

  it('keeps the status and code of a 409 target_gone so callers can tell it apart', async () => {
    fetchHarness.queueResponse({
      ok: false,
      status: 409,
      json: { error: 'Destino removido', code: 'target_gone' },
    });
    await expect(
      submitEditSuggestion('token-hub', 42, {
        conteudo: null,
        conteudo_plain: 'x',
        captions: { ig_caption: null, geral_caption: 'g' },
        touched_fields: ['legenda_geral'],
        bases: { geral_caption: '' },
      }),
    ).rejects.toMatchObject({ status: 409, code: 'target_gone' });
  });

  it('throws on edit suggestion error', async () => {
    fetchHarness.queueResponse({
      ok: false,
      status: 400,
      json: { error: 'Post não está em revisão' },
    });

    await expect(
      submitEditSuggestion('token-hub', 99, {
        conteudo: null,
        conteudo_plain: 'texto',
        captions: { ig_caption: null },
        touched_fields: ['legenda'],
        bases: null,
      }),
    ).rejects.toThrow('Post não está em revisão');
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

  it('sends reference_ids with a correcao only when there are some', async () => {
    fetchHarness.queueResponse({ json: { ok: true } });
    await submitApproval('token-hub', 12, 'correcao', 'Trocar', undefined, [3, 4]);
    expect(JSON.parse(String(fetchHarness.calls[0].init?.body))).toEqual({
      token: 'token-hub',
      post_id: 12,
      action: 'correcao',
      comentario: 'Trocar',
      reference_ids: [3, 4],
    });

    fetchHarness.queueResponse({ json: { ok: true } });
    await submitApproval('token-hub', 12, 'correcao', 'Trocar', undefined, []);
    expect(JSON.parse(String(fetchHarness.calls[1].init?.body))).not.toHaveProperty(
      'reference_ids',
    );

    fetchHarness.queueResponse({ json: { ok: true } });
    await submitApproval('token-hub', 12, 'aprovado', undefined, undefined, [3]);
    expect(JSON.parse(String(fetchHarness.calls[2].init?.body))).not.toHaveProperty(
      'reference_ids',
    );
  });
});

const LOGIN_BODY = {
  error: 'Login necessário.',
  code: 'login_required',
  login: {
    workspace: { name: 'Agência Aurora', logo_url: null, brand_color: '#123456' },
    hub_theme: undefined,
  },
};

describe('hub client login', () => {
  beforeEach(() => {
    fetchHarness.reset();
    window.localStorage.clear();
    vi.stubGlobal('fetch', fetchHarness.fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  const headersOf = (i = 0) => fetchHarness.calls[i].init?.headers as Record<string, string>;

  it('sends the stored session as x-hub-session on hub-* calls, and omits it without one', async () => {
    fetchHarness.queueResponse({ json: { posts: [] } });
    await fetchPosts('tk');
    expect(headersOf()).toEqual({ apikey: 'anon-key-for-tests' });

    window.localStorage.setItem(HUB_SESSION_STORAGE_KEY, 'sess-1');
    fetchHarness.queueResponse({ json: { posts: [] } });
    await fetchPosts('tk');
    expect(headersOf(1)).toEqual({ apikey: 'anon-key-for-tests', 'x-hub-session': 'sess-1' });

    fetchHarness.queueResponse({ json: { ok: true } });
    await submitApproval('tk', 1, 'aprovado');
    expect(headersOf(2)).toMatchObject({
      'Content-Type': 'application/json',
      'x-hub-session': 'sess-1',
    });
    expect(hubHeaders({ A: 'b' })).toEqual({
      apikey: 'anon-key-for-tests',
      A: 'b',
      'x-hub-session': 'sess-1',
    });
  });

  it('agenda-convite never carries the session', async () => {
    fetchHarness.queueResponse({ json: {} });
    await fetchConvite('tk');
    expect(headersOf()).toEqual({ apikey: 'anon-key-for-tests' });

    window.localStorage.setItem(HUB_SESSION_STORAGE_KEY, 'sess-1');
    fetchHarness.queueResponse({ json: {} });
    await fetchConvite('tk');
    expect(headersOf(1)).toEqual({ apikey: 'anon-key-for-tests' });
  });

  it('keeps the parsed 401 body on the error', async () => {
    fetchHarness.queueResponse({ ok: false, status: 401, json: LOGIN_BODY });

    const err = await fetchBootstrap('mesaas', 'tk').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HubApiError);
    expect(isLoginRequired(err)).toBe(true);
    expect(isLoginRequired(new Error('x'))).toBe(false);
    const login = (err as HubApiError).body?.login as { workspace: { name: string } };
    expect(login.workspace.name).toBe('Agência Aurora');
  });

  it('reorderPostSchedules, deleteIdeiaImage and fetchReportHtml throw HubApiError with the code', async () => {
    window.localStorage.setItem(HUB_SESSION_STORAGE_KEY, 'sess-1');
    const calls = [
      () => reorderPostSchedules('tk', []),
      () => deleteIdeiaImage('tk', 'i1', 3),
      () => fetchReportHtml('tk', '2026-10'),
    ];
    for (const run of calls) {
      fetchHarness.queueResponse({ ok: false, status: 401, json: LOGIN_BODY });
      await expect(run()).rejects.toMatchObject({
        name: 'HubApiError',
        status: 401,
        code: 'login_required',
      });
    }
    for (let i = 0; i < 3; i++) expect(headersOf(i)['x-hub-session']).toBe('sess-1');
    expect(fetchHarness.calls[0].init?.method).toBe('PATCH');
    expect(fetchHarness.calls[1].init?.method).toBe('DELETE');
  });

  it('fetchReportHtml still resolves the HTML text on success', async () => {
    fetchHarness.queueResponse({ text: '<html>ok</html>' });
    await expect(fetchReportHtml('tk', '2026-10')).resolves.toBe('<html>ok</html>');
  });

  it('verifyLoginCode posts the code to hub-auth', async () => {
    fetchHarness.queueResponse({ json: { session_token: 's' } });

    await expect(verifyLoginCode('mesaas', 'tk', 'a@b.co', '123456')).resolves.toEqual({
      session_token: 's',
    });

    expect(String(fetchHarness.calls[0].input)).toContain('/functions/v1/hub-auth');
    expect(JSON.parse(String(fetchHarness.calls[0].init?.body))).toEqual({
      action: 'verify_code',
      workspace: 'mesaas',
      token: 'tk',
      email: 'a@b.co',
      code: '123456',
    });
  });

  it('requestLoginCode and logoutHub post their actions; logout sends the session', async () => {
    window.localStorage.setItem(HUB_SESSION_STORAGE_KEY, 'sess-1');
    fetchHarness.queueResponse({ json: { ok: true } });
    fetchHarness.queueResponse({ json: { ok: true } });

    await requestLoginCode('mesaas', 'tk', 'a@b.co');
    await logoutHub();

    expect(JSON.parse(String(fetchHarness.calls[0].init?.body))).toEqual({
      action: 'request_code',
      workspace: 'mesaas',
      token: 'tk',
      email: 'a@b.co',
    });
    expect(JSON.parse(String(fetchHarness.calls[1].init?.body))).toEqual({ action: 'logout' });
    expect(headersOf(1)['x-hub-session']).toBe('sess-1');
  });

  it('surfaces invalid_code with its message', async () => {
    fetchHarness.queueResponse({
      ok: false,
      status: 400,
      json: { error: 'Código inválido ou expirado.', code: 'invalid_code' },
    });
    await expect(verifyLoginCode('w', 'tk', 'a@b.co', '000000')).rejects.toMatchObject({
      status: 400,
      code: 'invalid_code',
      message: 'Código inválido ou expirado.',
    });
  });

  it('never replays a 429 on login calls', async () => {
    fetchHarness.queueResponse({
      ok: false,
      status: 429,
      json: { error: 'Muitas tentativas. Aguarde alguns minutos.' },
    });
    fetchHarness.queueResponse({ ok: false, status: 429, json: { error: 'x' } });
    fetchHarness.queueResponse({ ok: false, status: 429, json: { error: 'x' } });

    await expect(requestLoginCode('w', 'tk', 'a@b.co')).rejects.toMatchObject({
      status: 429,
      message: 'Muitas tentativas. Aguarde alguns minutos.',
    });
    await expect(verifyLoginCode('w', 'tk', 'a@b.co', '123456')).rejects.toMatchObject({
      status: 429,
    });
    await expect(logoutHub()).rejects.toMatchObject({ status: 429 });
    expect(fetchHarness.calls).toHaveLength(3);
  });

  describe('login_required listener', () => {
    afterEach(() => setLoginRequiredListener(null));

    it('is told once, with the HubApiError, when a plain get or post gets a 401 login_required', async () => {
      const listener = vi.fn();
      setLoginRequiredListener(listener);
      fetchHarness.queueResponse({ ok: false, status: 401, json: LOGIN_BODY });
      const err = await submitApproval('tk', 1, 'aprovado').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HubApiError);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(err);

      fetchHarness.queueResponse({ ok: false, status: 401, json: LOGIN_BODY });
      await expect(fetchPosts('tk')).rejects.toBeInstanceOf(HubApiError);
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('is not told for other failures or for hub-auth calls', async () => {
      const listener = vi.fn();
      setLoginRequiredListener(listener);
      fetchHarness.queueResponse({ ok: false, status: 500, json: { error: 'boom' } });
      await expect(fetchPosts('tk')).rejects.toBeInstanceOf(HubApiError);
      for (const call of [
        () => verifyLoginCode('mesaas', 'tk', 'a@b.co', '123456'),
        () => requestLoginCode('mesaas', 'tk', 'a@b.co'),
        () => logoutHub(),
      ]) {
        fetchHarness.queueResponse({ ok: false, status: 401, json: LOGIN_BODY });
        await expect(call()).rejects.toMatchObject({ code: 'login_required' });
      }
      expect(listener).not.toHaveBeenCalled();
    });

    it('throws just the HubApiError when no listener is set', async () => {
      fetchHarness.queueResponse({ ok: false, status: 401, json: LOGIN_BODY });
      await expect(fetchPosts('tk')).rejects.toMatchObject({ code: 'login_required' });
    });
  });

  describe('downloadAgendaIcs', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('fetches with the session and saves the blob from a temporary link', async () => {
      window.localStorage.setItem(HUB_SESSION_STORAGE_KEY, 'sess-1');
      const blob = new Blob(['BEGIN:VCALENDAR'], { type: 'text/calendar' });
      const fetchMock = vi.fn(async () => ({ ok: true, status: 200, blob: async () => blob }));
      vi.stubGlobal('fetch', fetchMock);
      // jsdom has no createObjectURL/revokeObjectURL: define them for the spies, delete after.
      const urlApi = URL as unknown as Record<string, unknown>;
      const hadCreate = 'createObjectURL' in URL;
      if (!hadCreate) {
        urlApi.createObjectURL = () => '';
        urlApi.revokeObjectURL = () => undefined;
      }
      try {
        const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ics');
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        vi.useFakeTimers();
        await downloadAgendaIcs('tk', 10);

        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toContain('/functions/v1/hub-agenda/ocorrencia/10.ics');
        expect(url).toContain('token=tk');
        expect(init.headers).toEqual({ apikey: 'anon-key-for-tests', 'x-hub-session': 'sess-1' });
        expect(create).toHaveBeenCalledWith(blob);
        expect(click).toHaveBeenCalledTimes(1);
        // Not revoked in the click's own tick, but soon after.
        expect(revoke).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1000);
        expect(revoke).toHaveBeenCalledWith('blob:ics');
        expect(document.querySelector('a[download]')).toBeNull();
      } finally {
        // Restore the spies first: restoring after the delete would put the dummies back.
        vi.restoreAllMocks();
        vi.useRealTimers();
        if (!hadCreate) {
          delete urlApi.createObjectURL;
          delete urlApi.revokeObjectURL;
        }
      }
    });

    it('does not replay a 429: the click answers at once', async () => {
      fetchHarness.queueResponse({ ok: false, status: 429, json: { error: 'Muitas tentativas.' } });
      await expect(downloadAgendaIcs('tk', 10)).rejects.toMatchObject({ status: 429 });
      expect(fetchHarness.calls).toHaveLength(1);
    });
  });

  it('downloadAgendaIcs rejects with a HubApiError on a 401', async () => {
    fetchHarness.queueResponse({ ok: false, status: 401, json: LOGIN_BODY });
    await expect(downloadAgendaIcs('tk', 10)).rejects.toMatchObject({
      name: 'HubApiError',
      code: 'login_required',
    });
  });
});
