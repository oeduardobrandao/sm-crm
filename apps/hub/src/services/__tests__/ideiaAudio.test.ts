import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({
  presignIdeiaAudio: vi.fn(),
  finalizeIdeiaAudio: vi.fn(),
}));

import { finalizeIdeiaAudio, presignIdeiaAudio } from '../../api';
import { uploadIdeiaAudio } from '../ideiaAudio';

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

describe('ideiaAudio service (hub)', () => {
  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    vi.mocked(presignIdeiaAudio).mockReset();
    vi.mocked(finalizeIdeiaAudio).mockReset();
  });

  it('presigns, PUTs with the normalized content type and finalizes', async () => {
    vi.mocked(presignIdeiaAudio).mockResolvedValue({
      upload_url: 'https://r2/put',
      r2_key: 'ideia-audio/c/i/x.webm',
      mime_type: 'audio/webm',
    });
    vi.mocked(finalizeIdeiaAudio).mockResolvedValue({ ok: true, transcript: 'texto', audio: null });
    const phases: string[] = [];
    const res = await uploadIdeiaAudio({
      token: 'tok',
      ideiaId: 'i1',
      blob: new Blob(['abc'], { type: 'audio/webm;codecs=opus' }),
      mime: 'audio/webm;codecs=opus',
      durationSeconds: 7.4,
      onPhase: (p) => phases.push(p),
    });
    expect(res.transcript).toBe('texto');
    expect(FakeXHR.last?.headers['Content-Type']).toBe('audio/webm');
    expect(finalizeIdeiaAudio).toHaveBeenCalledWith('tok', 'i1', {
      r2_key: 'ideia-audio/c/i/x.webm',
      mime_type: 'audio/webm',
      size_bytes: 3,
      duration_seconds: 7,
    });
    expect(phases).toEqual(['uploading', 'transcribing']);
  });

  it('rejects unsupported mimes before presigning', async () => {
    await expect(
      uploadIdeiaAudio({
        token: 't',
        ideiaId: 'i',
        blob: new Blob(['a']),
        mime: 'video/mp4',
        durationSeconds: 1,
      }),
    ).rejects.toThrow('Formato de áudio não suportado');
    expect(presignIdeiaAudio).not.toHaveBeenCalled();
  });
});
