import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({
  presignBriefingAudio: vi.fn(),
  finalizeBriefingAudio: vi.fn(),
}));

import { finalizeBriefingAudio, presignBriefingAudio } from '../../api';
import {
  describeAudioError,
  normalizeAudioMime,
  uploadBriefingAudio,
  validateBriefingAudio,
} from '../briefingAudio';

class FakeXHR {
  static last: FakeXHR | null = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  status = 200;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  body: unknown;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
    FakeXHR.last = this;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    this.body = body;
    queueMicrotask(() => this.onload?.());
  }
}

describe('briefingAudio service', () => {
  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    vi.mocked(presignBriefingAudio).mockReset();
    vi.mocked(finalizeBriefingAudio).mockReset();
  });

  it('normalizes recorder mime and validates size', () => {
    expect(normalizeAudioMime('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(normalizeAudioMime('audio/mp4')).toBe('audio/mp4');
    expect(normalizeAudioMime('video/mp4')).toBeNull();
    expect(() => validateBriefingAudio(new Blob(['x']), 'video/mp4')).toThrow(
      'Formato de áudio não suportado',
    );
    expect(() => validateBriefingAudio(new Blob([]), 'audio/webm')).toThrow('Gravação vazia');
    expect(validateBriefingAudio(new Blob(['abc']), 'audio/webm;codecs=opus')).toBe('audio/webm');
  });

  it('presigns, PUTs with the normalized content type and finalizes', async () => {
    vi.mocked(presignBriefingAudio).mockResolvedValue({
      upload_url: 'https://r2/put',
      r2_key: 'briefing-audio/c/q/x.webm',
      mime_type: 'audio/webm',
    });
    vi.mocked(finalizeBriefingAudio).mockResolvedValue({
      ok: true,
      answer: 'texto',
      transcript: 'texto',
      audio: null,
    });
    const phases: string[] = [];
    const blob = new Blob(['abc'], { type: 'audio/webm;codecs=opus' });

    const res = await uploadBriefingAudio({
      token: 'tok',
      questionId: 'q1',
      blob,
      mime: 'audio/webm;codecs=opus',
      durationSeconds: 7,
      onPhase: (p) => phases.push(p),
    });

    expect(res.answer).toBe('texto');
    expect(FakeXHR.last?.method).toBe('PUT');
    expect(FakeXHR.last?.url).toBe('https://r2/put');
    expect(FakeXHR.last?.headers['Content-Type']).toBe('audio/webm');
    expect(finalizeBriefingAudio).toHaveBeenCalledWith('tok', 'q1', {
      r2_key: 'briefing-audio/c/q/x.webm',
      mime_type: 'audio/webm',
      size_bytes: 3,
      duration_seconds: 7,
    });
    expect(phases).toEqual(['uploading', 'transcribing']);
  });

  describe('describeAudioError', () => {
    it('maps quota_exceeded to a Portuguese, actionable message', () => {
      expect(describeAudioError(new Error('quota_exceeded'), 'fallback')).toBe(
        'O espaço de armazenamento do plano acabou. Fale com a agência para liberar espaço.',
      );
    });

    it('maps an R2 413 upload failure to the quota message', () => {
      expect(describeAudioError(new Error('Upload falhou: 413'), 'fallback')).toBe(
        'O espaço de armazenamento do plano acabou. Fale com a agência para liberar espaço.',
      );
    });

    it('maps other Upload falhou codes to the generic upload-failure message', () => {
      expect(describeAudioError(new Error('Upload falhou: 500'), 'fallback')).toBe(
        'O envio do áudio falhou. Tente de novo.',
      );
    });

    it('maps HTTP 5xx to a generic "try again later" message', () => {
      expect(describeAudioError(new Error('HTTP 500'), 'fallback')).toBe(
        'Não foi possível concluir agora. Tente de novo em instantes.',
      );
    });

    it('passes through the rate-limit message unchanged', () => {
      const msg = 'Muitas tentativas. Aguarde alguns minutos.';
      expect(describeAudioError(new Error(msg), 'fallback')).toBe(msg);
    });

    it('passes through already-Portuguese messages unchanged', () => {
      const msg = 'Formato de áudio não suportado: video/mp4';
      expect(describeAudioError(new Error(msg), 'fallback')).toBe(msg);
    });

    it('falls back for unrecognized errors', () => {
      expect(describeAudioError(new Error('some_unknown_code'), 'fallback')).toBe('fallback');
      expect(describeAudioError(new Error(''), 'fallback')).toBe('fallback');
      expect(describeAudioError('not an Error instance', 'fallback')).toBe('fallback');
    });
  });
});
